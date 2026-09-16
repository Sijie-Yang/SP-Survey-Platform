import { createToolRegistry } from './tools.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { createPlatformTools } from './platformTools.mjs';
import { runToolLoop } from './loop.mjs';
import { createEvent, eventsToUiMessages, redactSecrets } from './events.mjs';
import {
  appendEvent,
  claimSessionInput,
  createRun,
  createRunCancellationCheck,
  createSession,
  finishRun,
  getSession,
  listEvents,
  markRunRunning,
  nextSessionSelection,
  updateSessionAssistantMode,
  updateSessionSelection,
  updateRunCheckpoint,
} from './sessions.mjs';
import {
  listProviderCredentials,
  listProviderProfiles,
  loadProviderCredential,
  loadUserAiSettings,
  saveUserAiSettings,
} from '../credentials.mjs';
import { availableModelId, resolveModel } from './registry.mjs';
import { assertRoute } from './validators.mjs';
import {
  applyAssistantModeToTools,
  getAssistantModePolicy,
  normalizeAssistantMode,
  requestsExplicitRedesign,
} from './modes.mjs';
import { dispatchAgentRun } from './runDispatcher.mjs';
import { requestRunApproval } from './approvals.mjs';
import { verifySavedDraft } from './draftVerify.mjs';

export const DESIGNER_SYSTEM = `You are the SP-Survey in-browser Assistant (designer mode).
You design visual-perception surveys using tools — never invent credentials or image URLs.

Workflow:
1. Always call survey_capabilities before designing or editing.
2. Always call survey_get_draft before any edit and retain draftUpdatedAt.
3. You must finish a design/edit request by successfully calling survey_apply_operations. For a new survey or complete redesign, use one replaceConfig operation. For a small edit, use incremental operations.
4. Call survey_validate after substantial edits.
5. Never AI-generate images to upload. Use project / template / preview media.
6. image*/media*/skillquestion: imageSelectionMode huggingface_random, empty choices (except imagecheckbox tags), preset_* skillId only.
7. Do not put skillHtml on questions. Do not include API keys.
8. When asked to create, design, or change the survey, never stop after describing it. If a write fails, read the fresh draft again, correct the operation, and retry.
9. survey_capabilities accepts a domain. Load exact question/media/skill/operation schema lazily when needed.
10. In Agent mode you may inspect projects, templates, media, Skills, and results. Publishing, deletion, and Skill/source upload pause for explicit user approval.
11. After saving, verify the authoritative draft before reporting completion.

If the user only asks a question, answer without tools.`;

export function requestsDraftChange(message) {
  const text = String(message || '').trim();
  if (!text || /^(?:(?:how|what|why|explain)\b|(?:怎么|如何|为什么))/i.test(text)) return false;
  return /\b(?:create|make|build|design|generate|draft|add|remove|delete|change|modify|update|revise|reorder)\b[\s\S]{0,80}\b(?:survey|questionnaire|question|page|choice|title)\b/i.test(text)
    || /(?:设计|创建|生成|制作|编写|构建|修改|添加|删除|调整|更新|重做|做一?个?)[\s\S]{0,40}(?:问卷|调查|题目|问题|页面|选项)/.test(text)
    || /(?:问卷|调查|题目|问题|页面|选项)[\s\S]{0,40}(?:设计|创建|生成|制作|编写|构建|修改|添加|删除|调整|更新|重做)/.test(text);
}

export async function runDesignerChat(env, userId, body, request) {
  const projectId = body?.projectId || null;
  const message = String(body?.message || '').trim();
  if (!message) throw Object.assign(new Error('message is required'), { status: 400 });
  const assistantMode = normalizeAssistantMode(body?.assistantMode);
  const draftRequestedByGoal = requestsDraftChange(message);
  const modePolicy = getAssistantModePolicy(assistantMode, {
    goalRequiresDraftChange: draftRequestedByGoal,
    explicitRedesign: requestsExplicitRedesign(message),
  });

  const settings = await loadUserAiSettings(env, userId);
  const permission = body?.permission || settings.permission || 'edit_draft';
  const profiles = await listProviderProfiles(env, userId);
  const credentials = await listProviderCredentials(env, userId);
  const defaultProvider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const defaultProfile = profiles.find((row) => row.provider === defaultProvider);
  const defaultModel = availableModelId(defaultProvider, settings.assistant_model, {
    profile: defaultProfile,
  });
  const defaultEffort = settings.assistant_reasoning_effort || settings.reasoning_effort || null;

  let session = body?.sessionId
    ? await getSession(env, userId, body.sessionId)
    : null;
  if (body?.sessionId && !session) {
    throw Object.assign(new Error('Assistant session not found'), {
      status: 404,
      code: 'SESSION_NOT_FOUND',
    });
  }
  if (session && session.project_id !== projectId) {
    throw Object.assign(new Error('Assistant sessions cannot be reused across projects'), {
      status: 409,
      code: 'SESSION_PROJECT_MISMATCH',
    });
  }

  const requested = {
    provider: body?.provider || (!session ? defaultProvider : null),
    model: body?.model || (!session ? defaultModel : null),
    effort: body?.reasoningEffort || body?.reasoning_effort || (!session ? defaultEffort : null),
  };
  const selection = nextSessionSelection(session, requested);
  const provider = selection.provider || defaultProvider;
  const model = selection.model || defaultModel;
  const effort = selection.effort || null;
  const profile = profiles.find((row) => row.provider === provider);
  const checkedRoute = assertRoute({
    provider,
    model,
    profile,
    effort,
    requireConfigured: true,
    credential: credentials.find((row) => row.provider === provider),
  });
  const resolved = checkedRoute.provider;
  const modelRecord = resolveModel(provider, model, profile);
  const route = checkedRoute.route;
  const temperature = body?.temperature ?? settings.temperature ?? 0.4;
  const maxTokens = body?.max_tokens ?? settings.max_tokens ?? modelRecord?.maxTokens ?? 4096;

  if (!session) {
    session = await createSession(env, {
      userId,
      projectId,
      mode: 'designer',
      assistantMode,
      title: message.slice(0, 72),
      provider,
      model,
      reasoningEffort: effort,
    });
    await appendEvent(env, {
      sessionId: session.id,
      type: 'session.start',
      payload: {
        runtime: 'sp-agent-runtime/0.1',
        provider,
        model,
        reasoningEffort: effort,
        assistantMode,
      },
    });
    await updateSessionSelection(env, session.id, { provider, model, effort });
  } else if (selection.pin) {
    await updateSessionSelection(env, session.id, { provider, model, effort });
    if (selection.changed && selection.reason === 'switch') {
      await appendEvent(env, {
        sessionId: session.id,
        type: 'model.selection',
        payload: { provider, model, reasoningEffort: effort },
      });
    }
  }
  await updateSessionAssistantMode(env, session.id, assistantMode);

  if (body?.provider && body?.model && (body.provider !== defaultProvider || body.model !== defaultModel)) {
    saveUserAiSettings(env, userId, {
      default_provider: body.provider,
      assistant_provider: body.provider,
      assistant_model: body.model,
      assistant_reasoning_effort: body.reasoningEffort || body.reasoning_effort || effort,
      expectedRevision: settings.settings_revision,
    }).catch(() => null);
  }

  const run = body?._runId
    ? { id: body._runId }
    : await createRun(env, {
      sessionId: session.id,
      userId,
      projectId,
      provider,
      model,
      status: body?._prepareOnly ? 'queued' : 'running',
      assistantMode,
      requestPayload: queuedBody(body),
    });

  const emit = async (event) => {
    await appendEvent(env, {
      sessionId: session.id,
      runId: run.id,
      type: event.type,
      payload: event.payload,
    });
    return event;
  };

  const priorEvents = await listEvents(env, session.id);
  if (!body?._sessionPrepared) {
    await emit(createEvent('user.message', { content: message, assistantMode }));
    await emit(createEvent('run.status', {
      status: body?._prepareOnly ? 'queued' : 'running',
      assistantMode,
    }));
  } else {
    await markRunRunning(env, run.id);
    await emit(createEvent('run.status', { status: 'running', assistantMode }));
  }

  if (body?._prepareOnly) {
    return {
      success: true,
      runtime: 'sp-agent-runtime/0.2',
      queued: true,
      status: 'queued',
      sessionId: session.id,
      runId: run.id,
      provider,
      model,
      reasoningEffort: effort,
      assistantMode,
    };
  }

  const cred = await loadProviderCredential(env, userId, provider);

  const coreTools = createDesignerTools({
      env,
      accessToken: body?.accessToken,
      projectId,
      request,
      writerSource: 'assistant',
      ownerUserId: body?._sessionPrepared ? userId : null,
    });
  const domainTools = (assistantMode === 'agent' || assistantMode === 'question')
    ? createPlatformTools({
      env,
      userId,
      accessToken: body?._sessionPrepared ? null : body?.accessToken,
      projectId,
      request,
    })
    : [];
  const registry = createToolRegistry(applyAssistantModeToTools(
    [...coreTools, ...domainTools],
    modePolicy,
  ));

  const history = eventsToUiMessages(
    body?._sessionPrepared
      ? priorEvents.filter((event) => event.run_id !== run.id)
      : priorEvents,
  )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const research = body?.researchContext || {};
  const researchBlock = research.topic || research.requirements
    ? `\nResearch context:\n- topic: ${research.topic || ''}\n- requirements: ${research.requirements || ''}\n- scenario: ${research.scenario || ''}`
    : '';
  const draftRequested = modePolicy.requireDraftChange;

  try {
    const result = await runToolLoop({
      apiKey: cred.apiKey,
      provider: cred.provider,
      baseUrl: route.baseUrl,
      model,
      modelRecord,
      protocol: route.protocol,
      compat: resolved.catalog
        ? (modelRecord?.compat || {})
        : { ...resolved.compat, ...(modelRecord?.compat || {}) },
      extra: route.headers,
      retryPolicy: resolved.retryPolicy,
      effort,
      efforts: modelRecord?.reasoningEfforts || false,
      messages: [
        {
          role: 'system',
          content: `${DESIGNER_SYSTEM}\n\n${modePolicy.systemPrompt}${researchBlock}`,
        },
        ...history.filter((m) => m.content),
        { role: 'user', content: message },
      ],
      registry,
      ctx: {
        permission: modePolicy.readOnly ? 'ask' : (assistantMode === 'agent' ? 'media' : permission),
        userId,
        projectId,
        assistantMode,
        approvedToolCalls: new Set(body?._checkpoint?.approvedToolCalls || []),
        approvalGate: async ({ toolCallId, name, risk, args }) => {
          const approval = await requestRunApproval(env, {
            runId: run.id,
            sessionId: session.id,
            userId,
            toolCallId,
            toolName: name,
            risk,
            argumentsPreview: redactSecrets(args),
          });
          throw Object.assign(new Error(`Approval required for ${name}.`), {
            status: 409,
            code: 'APPROVAL_REQUIRED',
            approvalId: approval?.id,
            retryable: false,
          });
        },
      },
      temperature,
      maxTokens,
      onEvent: emit,
      requireDraftChange: draftRequested,
      checkCancelled: createRunCancellationCheck(env, run.id, {
        signal: request?.signal,
      }),
      readInbox: () => claimSessionInput(env, session.id).catch(() => []),
      checkpoint: body?._checkpoint || null,
      stepBudget: body?._sessionPrepared ? 3 : Number.POSITIVE_INFINITY,
    });
    if (result.awaitingApproval) {
      await updateRunCheckpoint(env, run.id, result.checkpoint, 'awaiting_approval');
      return {
        success: true,
        queued: true,
        status: 'awaiting_approval',
        sessionId: session.id,
        runId: run.id,
        assistantMode,
      };
    }
    if (result.continuation) {
      await updateRunCheckpoint(env, run.id, result.checkpoint, 'running').catch(() => null);
      await dispatchAgentRun(env, null, {
        kind: 'designer',
        userId,
        sessionId: session.id,
        runId: run.id,
        body: queuedBody(body),
        checkpoint: result.checkpoint,
      });
      return {
        success: true,
        queued: true,
        status: 'running',
        sessionId: session.id,
        runId: run.id,
        assistantMode,
      };
    }
    if (result.latestDraft?.surveyConfig) {
      const verificationId = `verify_${crypto.randomUUID()}`;
      await emit(createEvent('tool.call', {
        id: verificationId,
        name: 'survey_get_draft',
        args: {},
        verification: true,
      }));
      const verification = await verifySavedDraft({
        intended: result.latestDraft,
        readDraft: () => registry.execute('survey_get_draft', {}, {
          permission: 'ask',
          userId,
          projectId,
          assistantMode,
        }),
      });
      const verified = verification.draft;
      await emit(createEvent('tool.result', {
        id: verificationId,
        name: 'survey_get_draft',
        ok: verification.ok,
        verification: true,
        summary: verification.ok
          ? 'Saved draft verified'
          : 'Saved draft does not match the intended result',
        result: {
          draftUpdatedAt: verified?.draftUpdatedAt || null,
          reason: verification.reason,
        },
      }));
      if (!verification.ok) {
        throw Object.assign(new Error(
          'The saved draft could not be verified against the intended survey configuration.',
        ), {
          status: 409,
          code: 'DRAFT_VERIFICATION_FAILED',
          retryable: true,
        });
      }
      result.latestDraft = {
        surveyConfig: verified?.surveyConfig || result.latestDraft.surveyConfig,
        draftUpdatedAt: verified?.draftUpdatedAt || result.latestDraft.draftUpdatedAt,
      };
    }
    if (draftRequested && !result.latestDraft?.surveyConfig) {
      const writeFailure = result.lastDraftWriteError
        ? String(redactSecrets(result.lastDraftWriteError)).slice(0, 500)
        : '';
      throw Object.assign(
        new Error(writeFailure
          ? `Survey save failed: ${writeFailure}`
          : 'The model did not call the survey save tool after three attempts. Please retry or choose a model with tool support.'),
        {
          status: 422,
          code: result.attemptedDraftWrite ? 'DRAFT_WRITE_FAILED' : 'DRAFT_NOT_CHANGED',
        },
      );
    }

    await finishRun(env, run.id, {
      status: 'completed',
      prompt_tokens: result.usage.prompt_tokens || 0,
      completion_tokens: result.usage.completion_tokens || 0,
      result: {
        assistantMode,
        intent: modePolicy.responseIntent
          || (result.latestDraft?.surveyConfig ? 'adjust' : 'agent'),
        message: result.content || 'Done.',
        draftUpdatedAt: result.latestDraft?.draftUpdatedAt || null,
        draftMutated: Boolean(result.latestDraft?.surveyConfig),
        persisted: Boolean(result.latestDraft?.draftUpdatedAt),
      },
    });
    await emit(createEvent('run.status', { status: 'completed' }));

    const events = await listEvents(env, session.id);
    const latestDraft = result.latestDraft;

    return {
      success: true,
      runtime: 'sp-agent-runtime/0.1',
      sessionId: session.id,
      runId: run.id,
      provider,
      model,
      reasoningEffort: effort,
      assistantMode,
      intent: modePolicy.responseIntent
        || (latestDraft?.surveyConfig ? 'adjust' : 'agent'),
      message: result.content || 'Done.',
      surveyConfig: latestDraft?.surveyConfig || null,
      draftUpdatedAt: latestDraft?.draftUpdatedAt || null,
      draftMutated: Boolean(latestDraft?.surveyConfig),
      persisted: Boolean(latestDraft?.draftUpdatedAt),
      usage: result.usage,
      events: events.slice(-40),
      messages: eventsToUiMessages(events),
    };
  } catch (error) {
    const terminalStatus = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
    await finishRun(env, run.id, {
      status: terminalStatus,
      error_summary: String(error.message || 'failed').slice(0, 400),
    });
    await emit(createEvent('error', redactSecrets({ message: error.message, code: error.code })));
    await emit(createEvent('run.status', { status: terminalStatus }));
    throw error;
  }
}

function queuedBody(body = {}) {
  return {
    message: String(body.message || ''),
    projectId: body.projectId || null,
    provider: body.provider || null,
    model: body.model || null,
    reasoningEffort: body.reasoningEffort || body.reasoning_effort || null,
    assistantMode: body.assistantMode || 'agent',
    permission: body.permission || null,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    researchContext: body.researchContext || {},
  };
}

export async function startDesignerRun(env, userId, body, request, ctx) {
  const prepared = await runDesignerChat(env, userId, {
    ...queuedBody(body),
    sessionId: body?.sessionId || null,
    accessToken: body?.accessToken,
    _prepareOnly: true,
  }, request);
  const job = {
    kind: 'designer',
    userId,
    sessionId: prepared.sessionId,
    runId: prepared.runId,
    body: queuedBody(body),
  };
  try {
    const dispatched = await dispatchAgentRun(env, ctx, job);
    return { ...prepared, ...dispatched };
  } catch (error) {
    await finishRun(env, prepared.runId, {
      status: 'failed',
      error_summary: 'Agent run dispatch failed.',
    }).catch(() => null);
    await appendEvent(env, {
      sessionId: prepared.sessionId,
      runId: prepared.runId,
      type: 'error',
      payload: redactSecrets({
        code: 'AGENT_DISPATCH_FAILED',
        message: error.message,
      }),
    }).catch(() => null);
    throw Object.assign(new Error('The Agent run could not be queued. Please retry.'), {
      status: 503,
      code: 'AGENT_DISPATCH_FAILED',
    });
  }
}

export async function executeQueuedDesignerRun(env, job) {
  if (!job?.userId || !job?.runId || !job?.sessionId) {
    throw Object.assign(new Error('Malformed queued Agent run.'), {
      code: 'INVALID_QUEUED_RUN',
      retryable: false,
    });
  }
  const request = new Request(`${env.APP_URL || 'https://sp-survey.org'}/api/agent/chat`, {
    method: 'POST',
  });
  try {
    return await runDesignerChat(env, job.userId, {
      ...queuedBody(job.body),
      sessionId: job.sessionId,
      _runId: job.runId,
      _sessionPrepared: true,
      _checkpoint: job.checkpoint || null,
    }, request);
  } catch (error) {
    // Provider retries and self-repair happen inside the durable loop. Once it
    // records a terminal failure, Queue-level replay would duplicate events.
    error.retryable = false;
    throw error;
  }
}
