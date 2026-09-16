/**
 * Restricted tool-calling loop.
 */

import {
  compactModelMessages,
  createEvent,
  eventsToModelMessages,
  redactSecrets,
} from './events.mjs';
import { chatCompletions, toOpenAiTools } from './providers.mjs';
import { summarizeToolResult } from './tools.mjs';

const MAX_STEPS = 12;
const DEFAULT_STAGNATION_LIMIT = 3;

export function forcedToolChoice(protocol, name) {
  if (!name) return 'auto';
  if (protocol === 'anthropic-messages') return { type: 'tool', name };
  if (protocol === 'google-generative-ai') return 'any';
  if (protocol === 'openai-responses') return { type: 'function', name };
  return { type: 'function', function: { name } };
}

export function toolRequestPolicy({
  protocol,
  requiredTool,
  tools,
  compat,
  effort,
}) {
  const thinkingEnabled = Boolean(effort && effort !== 'off');
  const qwenThinking = protocol === 'openai-completions'
    && compat?.thinkingFormat === 'qwen'
    && thinkingEnabled;
  if (!qwenThinking) {
    return {
      tools,
      toolChoice: forcedToolChoice(protocol, requiredTool),
    };
  }
  return {
    // DashScope thinking mode rejects required/object tool_choice. Restricting
    // the advertised registry preserves the required-tool sequence without
    // sending the unsupported parameter.
    tools: requiredTool
      ? tools.filter((tool) => tool?.function?.name === requiredTool)
      : tools,
    toolChoice: undefined,
  };
}

export async function runToolLoop({
  apiKey,
  provider,
  baseUrl,
  model,
  modelRecord,
  messages,
  registry,
  ctx,
  temperature,
  maxTokens,
  protocol,
  compat,
  retryPolicy,
  effort,
  efforts,
  extra,
  onEvent,
  signal,
  maxSteps = MAX_STEPS,
  requireDraftChange = false,
  events,
  checkCancelled,
  readInbox,
  contextOptions = {},
  stagnationLimit = DEFAULT_STAGNATION_LIMIT,
  toolExecutionMode,
  turnId: requestedTurnId,
  checkpoint,
  stepBudget = Number.POSITIVE_INFINITY,
}) {
  const tools = toOpenAiTools(registry.list());
  let step = Number(checkpoint?.step || 0);
  let last = checkpoint?.last || { content: '', toolCalls: [], usage: {} };
  let latestDraft = checkpoint?.latestDraft || null;
  let editNudgeCount = Number(checkpoint?.editNudgeCount || 0);
  let attemptedDraftWrite = Boolean(checkpoint?.attemptedDraftWrite);
  let lastDraftWriteError = checkpoint?.lastDraftWriteError || '';
  let loadedCapabilities = Boolean(checkpoint?.loadedCapabilities);
  let loadedDraft = Boolean(checkpoint?.loadedDraft);
  const usage = checkpoint?.usage || { prompt_tokens: 0, completion_tokens: 0 };
  let working = Array.isArray(checkpoint?.working)
    ? [...checkpoint.working]
    : (Array.isArray(messages) && messages.length
      ? [...messages]
      : eventsToModelMessages(events || []));
  const turnId = checkpoint?.turnId || requestedTurnId || makeId('turn');
  let turnEnded = false;
  let activeStep = null;
  let repeatedFingerprint = Number(checkpoint?.repeatedFingerprint || 0);
  let previousFingerprint = checkpoint?.previousFingerprint || '';
  let overflowRecoveries = Number(checkpoint?.overflowRecoveries || 0);
  let terminalReason = 'max_steps';
  let terminal = false;
  let workSteps = 0;

  const emit = async (type, payload = {}) => {
    await onEvent?.(createEvent(type, { turnId, ...payload }));
  };

  if (!checkpoint) await emit('turn.start', { maxSteps });
  try {
    if (checkpoint?.pendingToolCall && checkpoint?.approvedToolCalls?.includes(checkpoint.pendingToolCall.id)) {
      await assertNotCancelled(signal, checkCancelled);
      const call = checkpoint.pendingToolCall;
      const resumed = await executeToolCall(call, 'exclusive', registry, ctx, signal, checkCancelled);
      if (resumed.cancelled) {
        throw Object.assign(new Error(resumed.result?.error || 'Cancelled before approved tool dispatch.'), {
          code: 'CANCELLED',
        });
      }
      if (!resumed.ok) {
        throw Object.assign(new Error(resumed.result?.error || 'Approved tool failed.'), {
          code: resumed.result?.code || 'APPROVED_TOOL_FAILED',
        });
      }
      updateDraftState(resumed);
      await emit('tool.result', redactSecrets({
        step,
        id: resumed.id,
        name: resumed.name,
        ok: true,
        outcome: resumed.outcome,
        summary: summarizeToolResult(resumed.name, resumed.result),
        result: compactResult(resumed.result),
        resumedAfterApproval: true,
      }));
      working.push({
        role: 'toolResult',
        toolCallId: resumed.id,
        toolName: resumed.name,
        content: [{
          type: 'text',
          text: JSON.stringify(redactSecrets(resumed.result)).slice(0, 12000),
        }],
        isError: false,
        timestamp: Date.now(),
      });
    }
    while (step < maxSteps && workSteps < stepBudget) {
      await assertNotCancelled(signal, checkCancelled);
      if (typeof readInbox === 'function') {
        const inbox = await readInbox();
        for (const item of inbox || []) {
          const content = String(item?.content || '').trim();
          if (!content) continue;
          working.push({ role: 'user', content: `[Steering update]\n${content}` });
          await emit('steering.message', {
            step,
            id: item.id,
            kind: item.kind || 'steer',
            content,
          });
        }
      }
      activeStep = step;
      await emit('step.start', { step });

      const prepared = compactModelMessages(working, {
        contextWindow: modelRecord?.contextWindow,
        maxOutputTokens: maxTokens,
        ...contextOptions,
      });
      if (prepared.changed) {
        working = prepared.messages;
        if (prepared.pruned) {
          await emit('context.prune', {
            step,
            prunedToolResults: prepared.pruned,
            toolCallIds: prepared.prunedToolCallIds,
            estimatedTokensBefore: prepared.originalTokens,
            estimatedTokensAfter: prepared.estimatedTokens,
          });
        }
        if (prepared.compacted) {
          await emit('context.compact', {
            step,
            reason: 'pressure',
            replacedMessages: prepared.compacted,
            estimatedTokensBefore: prepared.originalTokens,
            estimatedTokensAfter: prepared.estimatedTokens,
            replacement: redactSecrets(contextSummary(working)),
          });
        }
      }

      const requiredTool = requireDraftChange && !latestDraft
        ? (!loadedCapabilities
          ? 'survey_capabilities'
          : (!loadedDraft ? 'survey_get_draft' : 'survey_apply_operations'))
        : '';
      const toolPolicy = toolRequestPolicy({
        protocol,
        requiredTool,
        tools,
        compat,
        effort,
      });
      try {
        last = await withCooperativeCancellation((executionSignal) => chatCompletions({
          apiKey,
          provider,
          baseUrl,
          model,
          modelRecord,
          messages: working,
          temperature,
          maxTokens,
          tools: toolPolicy.tools,
          protocol,
          compat,
          retryPolicy,
          effort,
          efforts,
          extra,
          toolChoice: toolPolicy.toolChoice,
          signal: executionSignal,
          onRetry: async (info) => {
            await onEvent?.(createEvent('llm.retry', { turnId, step, ...info }));
          },
        }), { signal, checkCancelled });
      } catch (error) {
        if (isContextOverflow(error) && overflowRecoveries < 2) {
          const recovered = compactModelMessages(working, {
            contextWindow: modelRecord?.contextWindow,
            maxOutputTokens: maxTokens,
            ...contextOptions,
            targetRatio: 0.45,
            keepRecentMessages: 4,
            force: true,
          });
          if (recovered.changed) {
            overflowRecoveries += 1;
            working = recovered.messages;
            await emit('context.compact', {
              step,
              reason: 'provider_overflow',
              replacedMessages: recovered.compacted,
              prunedToolResults: recovered.pruned,
              toolCallIds: recovered.prunedToolCallIds,
              estimatedTokensBefore: recovered.originalTokens,
              estimatedTokensAfter: recovered.estimatedTokens,
              replacement: redactSecrets(contextSummary(working)),
            });
            await emit('step.end', { step, status: 'retrying', reason: 'context_overflow' });
            activeStep = null;
            step += 1;
            workSteps += 1;
            continue;
          }
        }
        throw error;
      }

      usage.prompt_tokens += Number(last.usage.prompt_tokens || 0);
      usage.completion_tokens += Number(last.usage.completion_tokens || 0);

      const calls = normalizeToolCalls(last.toolCalls, step);
      if (!calls.length && requireDraftChange && !latestDraft && editNudgeCount < 3 && step < maxSteps - 1) {
        working.push(last.raw || { role: 'assistant', content: last.content || '' });
        working.push({
          role: 'user',
          content: lastDraftWriteError
            ? `The survey was not saved. The last survey_apply_operations call failed: ${lastDraftWriteError}. Call survey_get_draft again for a fresh draftUpdatedAt, correct the operation, and retry survey_apply_operations. For a new survey or complete redesign, use one replaceConfig operation.`
            : 'The survey is not saved yet. Apply the requested change now with survey_apply_operations. For a new survey or complete redesign, use one replaceConfig operation. Do not only describe it.',
        });
        editNudgeCount += 1;
        await emit('step.end', { step, status: 'continuing', reason: 'draft_change_required' });
        activeStep = null;
        step += 1;
        workSteps += 1;
        continue;
      }
      if (last.content) {
        await emit('assistant.delta', { step, content: last.content });
      }
      if (!calls.length) {
        terminalReason = 'assistant';
        if (last.content) {
          await emit('assistant.message', { step, content: last.content });
        }
        await emit('step.end', { step, status: 'completed', reason: terminalReason });
        activeStep = null;
        step += 1;
        workSteps += 1;
        terminal = true;
        break;
      }

      working.push(last.raw || {
        role: 'assistant',
        content: last.content || null,
        tool_calls: Array.isArray(last.toolCalls) ? last.toolCalls : [],
      });
      for (const call of calls) {
        await emit('tool.call', redactSecrets({ step, id: call.id, name: call.name, args: call.args }));
        if (call.name === 'survey_apply_operations') attemptedDraftWrite = true;
      }

      const outcomes = await executeToolCalls({
        calls,
        registry,
        ctx,
        signal,
        checkCancelled,
        toolExecutionMode,
      });
      const approvalOutcome = outcomes.find((outcome) => (
        outcome?.result?.code === 'APPROVAL_REQUIRED'
      ));
      for (const outcome of outcomes) {
        if (outcome === approvalOutcome) continue;
        updateDraftState(outcome);
        const summary = outcome.outcome === 'unknown'
          ? `${outcome.name}: outcome unknown; verify state before retrying`
          : summarizeToolResult(outcome.name, outcome.result);
        await emit('tool.result', redactSecrets({
          step,
          id: outcome.id,
          name: outcome.name,
          ok: outcome.ok,
          outcome: outcome.outcome,
          retrySafe: outcome.outcome !== 'unknown',
          summary,
          result: compactResult(outcome.result),
        }));
        working.push({
          role: 'toolResult',
          toolCallId: outcome.id,
          toolName: outcome.name,
          content: [{
            type: 'text',
            text: JSON.stringify(redactSecrets(outcome.result)).slice(0, 12000),
          }],
          isError: !outcome.ok,
          outcome: outcome.outcome,
          timestamp: Date.now(),
        });
      }
      if (approvalOutcome) {
        await emit('step.end', {
          step,
          status: 'awaiting_approval',
          toolCalls: calls.length,
          toolCallId: approvalOutcome.id,
        });
        activeStep = null;
        step += 1;
        workSteps += 1;
        return {
          content: last.content || '',
          usage,
          steps: step,
          latestDraft,
          attemptedDraftWrite,
          lastDraftWriteError,
          awaitingApproval: true,
          checkpoint: {
            turnId,
            step,
            last,
            latestDraft,
            editNudgeCount,
            attemptedDraftWrite,
            lastDraftWriteError,
            loadedCapabilities,
            loadedDraft,
            usage,
            working,
            repeatedFingerprint,
            previousFingerprint,
            overflowRecoveries,
            pendingToolCall: {
              id: approvalOutcome.id,
              name: approvalOutcome.name,
              args: approvalOutcome.args,
            },
          },
        };
      }

      const fingerprint = stepFingerprint(calls, outcomes);
      repeatedFingerprint = fingerprint === previousFingerprint ? repeatedFingerprint + 1 : 1;
      previousFingerprint = fingerprint;
      const cancelled = outcomes.some((outcome) => outcome.cancelled);
      const stagnated = stagnationLimit > 0 && repeatedFingerprint >= stagnationLimit;
      await emit('step.end', {
        step,
        status: cancelled ? 'cancelled' : (stagnated ? 'stagnated' : 'completed'),
        toolCalls: calls.length,
        repeatedFingerprint,
      });
      activeStep = null;
      step += 1;
      workSteps += 1;

      if (cancelled) throw cancelledError();
      if (stagnated) {
        throw Object.assign(
          new Error(`Agent stopped after ${repeatedFingerprint} identical tool steps without progress.`),
          { status: 422, code: 'AGENT_STAGNATED', retryable: false },
        );
      }
    }

    if (!terminal && step < maxSteps && workSteps >= stepBudget) {
      const nextCheckpoint = {
        turnId,
        step,
        last,
        latestDraft,
        editNudgeCount,
        attemptedDraftWrite,
        lastDraftWriteError,
        loadedCapabilities,
        loadedDraft,
        usage,
        working,
        repeatedFingerprint,
        previousFingerprint,
        overflowRecoveries,
      };
      await emit('run.status', {
        status: 'running',
        reason: 'checkpoint',
        step,
      });
      return {
        content: last.content || '',
        usage,
        steps: step,
        latestDraft,
        attemptedDraftWrite,
        lastDraftWriteError,
        continuation: true,
        checkpoint: nextCheckpoint,
      };
    }

    await emit('usage', usage);
    await emit('turn.end', {
      status: 'completed',
      reason: terminalReason,
      steps: step,
    });
    turnEnded = true;
    return {
      content: last.content || '',
      usage,
      steps: step,
      latestDraft,
      attemptedDraftWrite,
      lastDraftWriteError,
    };
  } catch (error) {
    if (activeStep != null) {
      await emit('step.end', {
        step: activeStep,
        status: isCancellation(error) ? 'cancelled' : 'failed',
        reason: error.code || 'error',
      });
    }
    if (!turnEnded) {
      await emit('turn.end', {
        status: isCancellation(error) ? 'cancelled' : 'failed',
        reason: error.code || 'error',
        steps: step,
      });
    }
    throw error;
  }

  function updateDraftState(outcome) {
    const { name, ok, result } = outcome;
    if (ok && name === 'survey_capabilities') loadedCapabilities = true;
    if (ok && name === 'survey_get_draft') loadedDraft = true;
    if (ok && name === 'survey_apply_operations' && result?.surveyConfig) {
      lastDraftWriteError = '';
      latestDraft = {
        surveyConfig: result.surveyConfig,
        draftUpdatedAt: result.draftUpdatedAt || null,
      };
    } else if (!ok && name === 'survey_apply_operations') {
      if (outcome.outcome === 'unknown') {
        lastDraftWriteError = 'The save request was interrupted and its outcome is unknown. Re-read the draft before retrying.';
      } else {
        lastDraftWriteError = String(result?.error || 'Unknown write error').slice(0, 500);
      }
      loadedDraft = false;
    }
  }
}

export function classifyToolExecution(name, registry, override) {
  const explicit = typeof override === 'function' ? override(name, registry?.get?.(name)) : override?.[name];
  if (explicit === 'parallel' || explicit === false) return 'parallel';
  if (explicit === 'exclusive' || explicit === true) return 'exclusive';
  const tool = registry?.get?.(name);
  if (tool?.executionMode === 'parallel' || tool?.executionMode === 'exclusive') {
    return tool.executionMode;
  }
  const readOnlyName = /^(?:survey_(?:capabilities|get_|list_|validate|preview_)|media_list|skill_(?:list|get)|credentials_status)/.test(String(name || ''));
  return tool?.minPermission === 'ask' && readOnlyName ? 'parallel' : 'exclusive';
}

async function executeToolCalls({
  calls,
  registry,
  ctx,
  signal,
  checkCancelled,
  toolExecutionMode,
}) {
  const outcomes = new Map();
  const groups = executionGroups(calls, registry, toolExecutionMode);
  let stopReason = '';

  for (const group of groups) {
    if (stopReason) break;
    try {
      await assertNotCancelled(signal, checkCancelled);
    } catch {
      stopReason = 'cancelled';
      break;
    }
    const completed = await Promise.all(group.calls.map((call) => executeToolCall(
      call,
      group.mode,
      registry,
      ctx,
      signal,
      checkCancelled,
    )));
    for (const outcome of completed) outcomes.set(outcome.id, outcome);
    if (completed.some((outcome) => outcome.cancelled)) {
      stopReason = 'cancelled';
    } else if (completed.some((outcome) => outcome.outcome === 'unknown')) {
      stopReason = 'unknown';
    }
    if (!stopReason) {
      try {
        await assertNotCancelled(signal, checkCancelled);
      } catch {
        stopReason = 'cancelled';
      }
    }
  }

  if (stopReason) {
    for (const call of calls) {
      if (!outcomes.has(call.id)) {
        outcomes.set(call.id, {
          ...call,
          ok: false,
          outcome: 'not_run',
          cancelled: stopReason === 'cancelled',
          result: {
            error: stopReason === 'cancelled'
              ? 'Cancelled before tool dispatch.'
              : 'Not dispatched because an earlier exclusive tool has an unknown outcome.',
            code: stopReason === 'cancelled'
              ? 'ABORTED_BEFORE_DISPATCH'
              : 'BLOCKED_BY_UNKNOWN_OUTCOME',
          },
        });
      }
    }
  }
  return calls.map((call) => outcomes.get(call.id)).filter(Boolean);
}

async function executeToolCall(call, mode, registry, ctx, signal, checkCancelled) {
  if (mode === 'exclusive') {
    try {
      await assertNotCancelled(signal, checkCancelled);
    } catch (error) {
      if (isCancellation(error)) {
        return {
          ...call,
          ok: false,
          outcome: 'not_run',
          cancelled: true,
          result: { error: 'Cancelled before tool dispatch.', code: 'CANCELLED' },
        };
      }
      throw error;
    }
    const existing = await ctx?.lookupToolExecution?.(call.id);
    if (existing?.status === 'succeeded') {
      return {
        ...call,
        ok: true,
        outcome: 'success',
        replayed: true,
        result: existing.result,
      };
    }
    await ctx?.recordToolExecution?.({
      id: call.id,
      name: call.name,
      status: 'started',
      result: null,
    });
  }
  try {
    const result = await registry.execute(call.name, call.args, {
      ...ctx,
      signal,
      toolCallId: call.id,
    });
    if (mode === 'exclusive') {
      await ctx?.recordToolExecution?.({
        id: call.id,
        name: call.name,
        status: 'succeeded',
        result,
      });
    }
    return { ...call, ok: true, outcome: 'success', result };
  } catch (error) {
    const cancelled = isCancellation(error) || signal?.aborted;
    const unknown = mode === 'exclusive' && isUncertainOutcome(error, cancelled);
    if (mode === 'exclusive') {
      await ctx?.recordToolExecution?.({
        id: call.id,
        name: call.name,
        status: unknown ? 'unknown' : 'failed',
        result: { error: String(error?.message || 'Tool failed') },
      });
    }
    return {
      ...call,
      ok: false,
      outcome: unknown ? 'unknown' : 'failure',
      cancelled,
      result: {
        error: unknown
          ? 'Tool execution was interrupted after dispatch; the side effect may have completed. Verify state before retrying.'
          : String(error?.message || 'Tool failed'),
        code: unknown ? 'UNKNOWN_TOOL_OUTCOME' : (error?.code || (cancelled ? 'CANCELLED' : undefined)),
        ...(error?.validation ? { validation: redactSecrets(error.validation) } : {}),
        ...(error?.details ? { details: redactSecrets(error.details) } : {}),
        ...(error?.hint ? { hint: String(error.hint) } : {}),
        ...(unknown && error?.message ? { cause: String(error.message).slice(0, 300) } : {}),
      },
    };
  }
}

function executionGroups(calls, registry, override) {
  const groups = [];
  let parallel = [];
  const flush = () => {
    if (parallel.length) groups.push({ mode: 'parallel', calls: parallel });
    parallel = [];
  };
  for (const call of calls) {
    const mode = classifyToolExecution(call.name, registry, override);
    if (mode === 'parallel') {
      parallel.push(call);
    } else {
      flush();
      groups.push({ mode: 'exclusive', calls: [call] });
    }
  }
  flush();
  return groups;
}

function normalizeToolCalls(rawCalls, step) {
  return (Array.isArray(rawCalls) ? rawCalls : []).map((call, index) => {
    const name = call?.function?.name || call?.name || 'unknown_tool';
    let args = {};
    try {
      const raw = call?.function?.arguments ?? call?.arguments ?? '{}';
      args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    } catch {
      args = {};
    }
    return {
      raw: call,
      id: call?.id || `call_${step}_${index}_${name}`,
      name,
      args,
    };
  });
}

async function assertNotCancelled(signal, checkCancelled) {
  if (signal?.aborted) throw cancelledError(signal.reason);
  if (typeof checkCancelled === 'function') {
    const requested = await checkCancelled();
    if (requested) throw cancelledError();
  }
  if (signal?.aborted) throw cancelledError(signal.reason);
}

async function withCooperativeCancellation(run, {
  signal,
  checkCancelled,
  pollMs = 500,
}) {
  if (typeof checkCancelled !== 'function') return run(signal);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener?.('abort', abortFromParent, { once: true });
  let settled = false;
  const polling = (async () => {
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (settled) return;
      if (signal?.aborted || await checkCancelled()) {
        controller.abort(signal?.reason);
        throw cancelledError(signal?.reason);
      }
    }
  })();
  try {
    return await Promise.race([run(controller.signal), polling]);
  } finally {
    settled = true;
    signal?.removeEventListener?.('abort', abortFromParent);
  }
}

function cancelledError(reason) {
  const message = reason instanceof Error ? reason.message : 'Cancelled';
  return Object.assign(new Error(message), { status: 499, code: 'CANCELLED' });
}

function isCancellation(error) {
  return error?.code === 'CANCELLED'
    || error?.name === 'AbortError'
    || error?.status === 499;
}

function isUncertainOutcome(error, cancelled) {
  if (cancelled) return true;
  return /(?:timeout|timed out|network|connection|econnreset|fetch failed|worker terminated)/i.test(
    `${error?.code || ''} ${error?.message || ''}`,
  );
}

function isContextOverflow(error) {
  return error?.code === 'CONTEXT_OVERFLOW'
    || error?.code === 'CONTEXT_LENGTH_EXCEEDED'
    || /(?:context window|context length|maximum context|too many tokens)/i.test(String(error?.message || ''));
}

function stepFingerprint(calls, outcomes) {
  return hashString(stableStringify({
    calls: calls.map(({ name, args }) => ({ name, args })),
    outcomes: outcomes.map(({ name, outcome, result }) => ({
      name,
      outcome,
      result: compactResult(redactSecrets(result)),
    })),
  }));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function contextSummary(messages) {
  return messages.find((message) => (
    message?.role === 'user' && String(message.content || '').includes('<context_summary>')
  ))?.content || '';
}

function compactResult(result) {
  if (!result || typeof result !== 'object') return result;
  const { surveyConfig, ...rest } = result;
  if (surveyConfig) {
    rest.surveyConfigPreview = {
      title: surveyConfig.title,
      pages: (surveyConfig.pages || []).length,
      questions: (surveyConfig.pages || []).reduce((n, p) => n + (p.elements || []).length, 0),
    };
  }
  return rest;
}
