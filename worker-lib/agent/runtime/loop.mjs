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
import { compactJsonForModel } from './toolArgs.mjs';

const MAX_STEPS = 16;
const DEFAULT_STAGNATION_LIMIT = 3;
const MAX_FAMILY_REPAIRS = 2;
const DEFAULT_WRITE_TOOLS = Object.freeze([
  'survey_apply_operations',
  'survey_submit_generated_draft',
]);

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
  stopReasonOverride = '',
  writeTools = DEFAULT_WRITE_TOOLS,
}) {
  const writeToolNames = new Set(writeTools?.length ? writeTools : DEFAULT_WRITE_TOOLS);
  const defaultWriteTool = [...writeToolNames][0];
  const isWriteTool = (name) => writeToolNames.has(name);
  const tools = toOpenAiTools(registry.list());
  let step = Number(checkpoint?.step || 0);
  let last = checkpoint?.last || { content: '', toolCalls: [], usage: {} };
  let latestDraft = checkpoint?.latestDraft || null;
  let editNudgeCount = Number(checkpoint?.editNudgeCount || 0);
  let attemptedDraftWrite = Boolean(checkpoint?.attemptedDraftWrite);
  const successfulTools = Array.isArray(checkpoint?.successfulTools) ? [...checkpoint.successfulTools] : [];
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
  let lastRetryAction = checkpoint?.lastRetryAction || '';
  const repairFamilies = {
    ...(checkpoint?.repairFamilies && typeof checkpoint.repairFamilies === 'object'
      ? checkpoint.repairFamilies
      : {}),
  };
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
          text: compactJsonForModel(redactSecrets(resumed.result)),
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
            target: item.target || 'next-step',
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

      const requiredTool = nextRequiredTool({
        requireDraftChange,
        latestDraft,
        loadedCapabilities,
        loadedDraft,
        lastRetryAction,
        writeTool: defaultWriteTool,
      });
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

      const calls = normalizeToolCalls(
        last.toolCalls,
        step,
        stopReasonOverride || last.stopReason || last.rawStopReason,
      );
      if (!calls.length && requireDraftChange && !latestDraft && editNudgeCount < 3 && step < maxSteps - 1) {
        working.push(last.raw || { role: 'assistant', content: last.content || '' });
        working.push({
          role: 'user',
          content: lastDraftWriteError
            ? repairNudge(lastDraftWriteError, lastRetryAction)
            : `The survey is not saved yet. Submit it now with ${defaultWriteTool}. Do not only describe it.`,
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
        if (requireDraftChange && !latestDraft) {
          throw writeFailedError(lastDraftWriteError, attemptedDraftWrite);
        }
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
        await emit('tool.call', redactSecrets({
          step,
          id: call.id,
          name: call.name,
          args: call.args,
          receivedShape: call.receivedShape,
          rawArgsComplete: call.rawArgsComplete,
          argumentOrigin: call.argumentOrigin,
          byteLength: call.byteLength,
          parseError: call.argsParseError,
          stopReason: call.stopReason,
        }));
        if (isWriteTool(call.name)) attemptedDraftWrite = true;
      }

      const outcomes = await executeToolCalls({
        calls,
        registry,
        ctx,
        signal,
        checkCancelled,
        toolExecutionMode,
        isWriteTool,
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
          stage: outcome.result?.stage || stageForTool(outcome),
          summary,
          result: compactResult(outcome.result),
        }));
        working.push({
          role: 'toolResult',
          toolCallId: outcome.id,
          toolName: outcome.name,
          content: [{
            type: 'text',
            text: compactJsonForModel(redactSecrets(outcome.result)),
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
          successfulTools,
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
            lastRetryAction,
            repairFamilies,
            successfulTools,
            pendingToolCall: {
              id: approvalOutcome.id,
              name: approvalOutcome.name,
              args: approvalOutcome.args,
            },
          },
        };
      }

      const latestStage = outcomes.map((outcome) => outcome.result?.stage || stageForTool(outcome)).find(Boolean);
      if (latestStage) {
        const family = outcomes.map((outcome) => repairFamilyKey(outcome.name, outcome.result)).find(Boolean);
        await emit('run.stage', {
          stage: latestStage,
          repairAttempt: family ? Number(repairFamilies[family] || 0) : 0,
          repairLimit: MAX_FAMILY_REPAIRS,
        });
      }
      const exhausted = outcomes.some((outcome) => outcome.result?.code === 'GENERATE_REPAIR_EXHAUSTED');
      if (exhausted) {
        throw Object.assign(
          new Error('Questionnaire was not generated successfully. The original draft is unchanged.'),
          { status: 422, code: 'GENERATE_REPAIR_EXHAUSTED', retryable: false },
        );
      }
      const conflictStopped = outcomes.some((outcome) => outcome.result?.code === 'DRAFT_WRITE_CONFLICT');
      if (conflictStopped) {
        throw Object.assign(
          new Error('Draft changed while saving. The original draft is unchanged.'),
          { status: 409, code: 'DRAFT_WRITE_CONFLICT', retryable: false },
        );
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

    if (!terminal && step >= maxSteps && requireDraftChange && !latestDraft) {
      throw writeFailedError(lastDraftWriteError, attemptedDraftWrite);
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
        lastRetryAction,
        repairFamilies,
        successfulTools,
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
        successfulTools,
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
      successfulTools,
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
    if (ok && name) successfulTools.push(name);
    if (ok && isWriteTool(name) && result?.surveyConfig) {
      lastDraftWriteError = '';
      lastRetryAction = '';
      latestDraft = {
        surveyConfig: result.surveyConfig,
        draftUpdatedAt: result.draftUpdatedAt || null,
      };
      return;
    }
    if (ok || !isWriteTool(name)) return;
    lastRetryAction = retryActionForWriteFailure(result, outcome.outcome);
    lastDraftWriteError = String(result?.error || 'Unknown write error').slice(0, 500);
    if (isDraftConflict(result)) {
      lastRetryAction = 'reload_draft';
      repairFamilies.conflict = Number(repairFamilies.conflict || 0) + 1;
      if (repairFamilies.conflict >= 2) {
        lastRetryAction = 'stop_conflict';
        outcome.result = {
          ...result,
          code: 'DRAFT_WRITE_CONFLICT',
          error: 'Draft changed while saving. The original draft is unchanged.',
        };
      }
    }
    if (lastRetryAction === 'reload_draft' || lastRetryAction === 'verify_draft') {
      loadedDraft = false;
    }
    const family = repairFamilyKey(name, result);
    if (family && outcome.outcome !== 'not_run') {
      repairFamilies[family] = Number(repairFamilies[family] || 0) + 1;
      if (repairFamilies[family] >= 1 + MAX_FAMILY_REPAIRS) {
        outcome.result = {
          ...result,
          code: 'GENERATE_REPAIR_EXHAUSTED',
          error: 'Questionnaire was not generated successfully. The original draft is unchanged.',
        };
      }
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
  isWriteTool = (name) => DEFAULT_WRITE_TOOLS.includes(name),
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
    } else if (completed.some((outcome) => (
      isWriteTool(outcome.name) && !outcome.ok && outcome.outcome !== 'unknown'
    ))) {
      stopReason = 'repair';
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
              : stopReason === 'repair'
                ? 'Not dispatched because an earlier write failed and needs repair.'
                : 'Not dispatched because an earlier exclusive tool has an unknown outcome.',
            code: stopReason === 'cancelled'
              ? 'ABORTED_BEFORE_DISPATCH'
              : stopReason === 'repair'
                ? 'BLOCKED_BY_REPAIR'
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
  if (shouldBlockIncompleteArgs(call)) {
    const truncated = isLengthStopReason(call.stopReason);
    const writeTool = DEFAULT_WRITE_TOOLS.includes(call.name);
    const result = {
      error: truncated
        ? (writeTool
          ? 'Write arguments were truncated. Do not save a partial survey.'
          : 'Tool arguments were truncated. This call was not executed.')
        : (writeTool
          ? 'Write arguments were not valid JSON. Do not save a guessed survey.'
          : 'Tool arguments were not valid JSON. This call was not executed.'),
      code: truncated ? 'INCOMPLETE_TOOL_ARGS' : 'INVALID_TOOL_ARGUMENTS',
      path: 'arguments',
      retryAction: truncated ? 'stop_truncated' : 'repair_args',
      repairHint: truncated
        ? 'Retry with complete JSON. Raise this turn’s max output tokens or split the request.'
        : 'Resend a single complete JSON object. Incomplete arguments are never treated as empty.',
      receivedShape: {
        ...(call.receivedShape || {}),
        stopReason: call.stopReason || null,
        argsParseError: call.argsParseError || call.parseError || null,
        argumentOrigin: call.argumentOrigin || null,
        rawArgsComplete: call.rawArgsComplete,
        byteLength: call.byteLength,
      },
      stage: 'build_survey',
    };
    if (mode === 'exclusive') {
      await ctx?.recordToolExecution?.({
        id: call.id,
        name: call.name,
        status: 'failed',
        result,
      });
    }
    return { ...call, ok: false, outcome: 'failure', result };
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
        ...(error?.path ? { path: error.path } : {}),
        ...(error?.expected ? { expected: redactSecrets(error.expected) } : {}),
        ...(error?.receivedShape ? { receivedShape: redactSecrets(error.receivedShape) } : {}),
        ...(error?.repairHint ? { repairHint: String(error.repairHint) } : {}),
        ...(error?.retryAction ? { retryAction: error.retryAction } : {}),
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

export function isLengthStopReason(reason) {
  return /^(length|max_tokens|max_output_tokens|maxTokens)$/i.test(String(reason || ''));
}

export function shouldBlockIncompleteArgs(call = {}) {
  if (call.rawArgsComplete === false || call.argsComplete === false) return true;
  return DEFAULT_WRITE_TOOLS.includes(call.name) && isLengthStopReason(call.stopReason);
}

export function shouldBlockWrite(call = {}) {
  return DEFAULT_WRITE_TOOLS.includes(call.name) && shouldBlockIncompleteArgs(call);
}

export function repairFamilyKey(name, result = {}) {
  if (!DEFAULT_WRITE_TOOLS.includes(name)) return '';
  return `${name}:${result.code || 'WRITE_FAILED'}:${result.path || ''}`;
}

export function normalizeToolCalls(rawCalls, step, stopReason = null) {
  return (Array.isArray(rawCalls) ? rawCalls : []).map((call, index) => {
    const name = call?.function?.name || call?.name || 'unknown_tool';
    const raw = call?.function?.arguments ?? call?.arguments ?? '{}';
    const hasAdapterFlag = call?.rawArgsComplete === false || call?.rawArgsComplete === true;
    const adapterArgs = call?.args && typeof call.args === 'object' && !Array.isArray(call.args)
      && Object.keys(call.args).length
      ? call.args
      : null;
    const preParsed = hasAdapterFlag
      ? {
        args: adapterArgs,
        rawArgsComplete: call.rawArgsComplete,
        parseError: call.parseError || null,
        receivedShape: call.receivedShape || null,
        argumentOrigin: call.argumentOrigin || 'adapter',
        byteLength: call.byteLength,
      }
      : null;
    let args = preParsed?.args || {};
    let argsComplete = preParsed ? preParsed.rawArgsComplete : true;
    let argsParseError = preParsed?.parseError || null;
    if (!preParsed || (preParsed.rawArgsComplete && !preParsed.args)) {
      try {
        args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          args = {};
          argsComplete = false;
          argsParseError = 'Root value must be a JSON object';
        }
      } catch (error) {
        args = {};
        argsComplete = false;
        argsParseError = String(error?.message || 'invalid json');
      }
    }
    return {
      raw: call,
      id: call?.id || `call_${step}_${index}_${name}`,
      name,
      args,
      argsComplete,
      argsParseError,
      rawArgsComplete: preParsed ? preParsed.rawArgsComplete : argsComplete,
      argumentOrigin: call.argumentOrigin || preParsed?.argumentOrigin || null,
      receivedShape: call.receivedShape || preParsed?.receivedShape || null,
      byteLength: call.byteLength || preParsed?.byteLength || (typeof raw === 'string' ? raw.length : 0),
      stopReason,
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

export function nextRequiredTool({
  requireDraftChange,
  latestDraft,
  loadedCapabilities,
  loadedDraft,
  lastRetryAction,
  writeTool = 'survey_apply_operations',
}) {
  if (!requireDraftChange || latestDraft) return '';
  if (!loadedCapabilities) return 'survey_capabilities';
  if (lastRetryAction === 'stop_conflict') return '';
  if (!loadedDraft || lastRetryAction === 'reload_draft' || lastRetryAction === 'verify_draft') {
    return 'survey_get_draft';
  }
  if (lastRetryAction === 'repair_args') return writeTool;
  return '';
}

function isDraftConflict(result) {
  const code = String(result?.code || '');
  const error = String(result?.error || result?.message || '');
  return code === 'CONFLICT' || code === '40001' || /draft changed|40001/i.test(error);
}

function retryActionForWriteFailure(result, outcome) {
  if (outcome === 'unknown') return 'verify_draft';
  if (isDraftConflict(result)) return 'reload_draft';
  if (result?.retryAction) return result.retryAction;
  if (result?.code === 'INCOMPLETE_TOOL_ARGS' || result?.code === 'OUTPUT_TRUNCATED') {
    return 'stop_truncated';
  }
  if (
    result?.code === 'GENERATE_CONTRACT'
    || result?.code === 'GENERATE_GOAL'
    || result?.code === 'ASSISTANT_MODE_TOOL_REJECTED'
    || result?.code === 'ADJUST_CONTRACT'
    || result?.code === 'INVALID_TOOL_ARGUMENTS'
  ) {
    return 'repair_args';
  }
  return 'reload_draft';
}

function writeFailedError(lastDraftWriteError, attemptedDraftWrite) {
  const unchanged = ' Questionnaire was not generated successfully. The original draft is unchanged.';
  return Object.assign(
    new Error(lastDraftWriteError
      ? `${lastDraftWriteError}${unchanged}`
      : `The survey was not saved.${unchanged}`),
    {
      status: 422,
      code: attemptedDraftWrite ? 'DRAFT_WRITE_FAILED' : 'DRAFT_NOT_CHANGED',
      retryable: false,
    },
  );
}

function repairNudge(lastDraftWriteError, lastRetryAction) {
  if (lastRetryAction === 'repair_args') {
    return `The survey was not saved. ${lastDraftWriteError} Keep the current expectedDraftUpdatedAt and resubmit a complete surveyConfig through the generate submit tool.`;
  }
  if (lastRetryAction === 'verify_draft') {
    return `The last save outcome is unknown. Call survey_get_draft and verify the current draft before writing again. Last error: ${lastDraftWriteError}`;
  }
  if (lastRetryAction === 'stop_truncated') {
    return `The previous write was blocked because the model output was truncated. Do not save a partial survey. ${lastDraftWriteError}`;
  }
  return `The survey was not saved. The last draft write failed: ${lastDraftWriteError}. Call survey_get_draft again for a fresh draftUpdatedAt, then retry the write tool.`;
}

function stageForTool(outcome) {
  if (outcome?.name === 'survey_capabilities' || outcome?.name === 'survey_get_draft') {
    return 'read_requirements';
  }
  if (DEFAULT_WRITE_TOOLS.includes(outcome?.name) && !outcome.ok) return 'repair_config';
  if (DEFAULT_WRITE_TOOLS.includes(outcome?.name)) return 'save';
  if (outcome?.name === 'survey_validate') return 'build_survey';
  return '';
}
