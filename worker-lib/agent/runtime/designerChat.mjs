import { createToolRegistry } from './tools.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { createPlatformTools } from './platformTools.mjs';
import { runToolLoop } from './loop.mjs';
import { createEvent, eventsToUiMessages, redactSecrets } from './events.mjs';
import {
  appendEvent,
  claimRun,
  claimAfterRunInput,
  claimSessionInput,
  expireStaleAiRuns,
  markInboxFailed,
  createRun,
  createRunCancellationCheck,
  createSession,
  finishRun,
  getRunStatus,
  getSession,
  listEvents,
  markRunRunning,
  nextSessionSelection,
  TERMINAL_RUN_STATUSES,
  updateSessionAssistantMode,
  updateSessionSelection,
  updateRunCheckpoint,
} from './sessions.mjs';
import { createToolExecutionHooks } from './executions.mjs';
import {
  listProviderCredentials,
  listProviderProfiles,
  resolveAssistantBinding,
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
import { parseGenerateGoals } from './generateGoals.mjs';
import { dispatchAgentRun } from './runDispatcher.mjs';
import { requestRunApproval } from './approvals.mjs';
import { verifySavedDraft } from './draftVerify.mjs';
import {
  annotateHistoryForModel,
  classifyUserIntent,
  currentTaskMessage,
  QUESTION_MODE_WRITE_REFUSED,
  requestsContinuePriorTask,
  summarizeWorkingCopy,
} from './taskIntent.mjs';

export {
  classifyUserIntent,
  currentTaskMessage,
  QUESTION_MODE_WRITE_REFUSED,
  requestsDraftChange,
  requestsContinuePriorTask,
} from './taskIntent.mjs';

export const DESIGNER_SYSTEM = `You are the SP-Survey in-browser Assistant (designer mode).
You design street-scene / urban visual-perception surveys using tools — never invent credentials or image URLs.

Default topic: 街景与步行环境的视觉感知（安全感、步行适宜性、绿化、热闹程度、界面品质）. If the user does not name another topic, continue the current draft's title/media when they already describe a visual/street-scene study; if the draft is empty, generic, or only a placeholder such as "Five-Page Survey", design a street-scene image survey. Mix several visual families (image rating, image slider groups, ranking/picker, checkbox tags, comparison Skills) that use project / template / preview media. Do not invent a text-only demographics or generic comfort form unless the user asks for that. slidergroup / imageslidergroup / mediaslidergroup MUST include a non-empty dimensions array of {id, label, left, right}; label is the name shown in settings. Never submit dimensions: [].

Workflow:
1. Always call survey_capabilities before designing or editing.
2. Always call survey_get_draft before any edit and retain draftUpdatedAt.
3. You must finish a design/edit request by successfully calling survey_apply_operations. For a new survey, regenerate, or complete redesign, use one replaceConfig operation: operations must be a JSON array, e.g. [{"op":"replaceConfig","surveyConfig":{title,pages}}]. For a small edit, use incremental operations. Query survey_capabilities as needed (overview, then questionType / fieldGroup / skillId). Same-version repeats are cached. Use skill_list, not survey_skill_list. Prefer preset_* skillId values. setTheme merges unless replace=true.
4. Call survey_validate after substantial edits.
5. Never AI-generate images to upload. Use project / template / preview media.
6. Respect the project's existing media selection (fixed urls, folders, or random) and Skill ids. Do not force huggingface_random or rewrite custom skillId values.
7. Do not put skillHtml on questions. Do not include API keys.
8. When asked to create, design, or change the survey, never stop after describing it. Never paste the questionnaire as a markdown/JSON code block and claim it is saved. If a write fails, read the fresh draft again, correct the operation, and retry.
9. survey_capabilities accepts domain plus questionType, fieldGroup, or skillId. Load exact contracts lazily. Read survey_get_draft view=catalog/page/question/workingCopy instead of dumping a huge draft.
10. In Agent mode you may inspect projects, templates, media, Skills, and results. Publishing, deletion, and Skill/source upload pause for explicit user approval.
11. After saving, verify the authoritative draft before reporting completion.
12. If the user only asks what a setting means, answer without calling survey_apply_operations.

If the user only asks a question, answer without tools.
History is background. Do not execute a prior rejected, cancelled, or finished write unless the current message explicitly continues that task. Page-count questions never publish or rewrite.`;

const GENERATE_DESIGNER_SYSTEM = `You are the SP-Survey in-browser Assistant in Generate mode.
You design street-scene / urban visual-perception surveys using tools — never invent credentials or image URLs.

Default topic: 街景与步行环境的视觉感知. If the user does not name another topic, continue the current draft when it is already a visual/street-scene study; if the draft is empty or a generic placeholder, generate a street-scene image survey. Mix several visual families (image rating, image slider groups, ranking/picker, checkbox tags, comparison Skills) that use project / template / preview media. Do not invent a text-only demographics or generic comfort form unless asked. slidergroup / imageslidergroup / mediaslidergroup MUST include a non-empty dimensions array of {id, label, left, right}; label is the name shown in settings. Never submit dimensions: [].

Workflow:
1. Call survey_capabilities first. The overview is the generate submit contract, not the incremental operations catalog.
2. Call survey_get_draft and retain draftUpdatedAt as expectedDraftUpdatedAt.
3. Plan pages and distinct complete question families from the research goal first, then fill each question from its generation contract. Finish by successfully calling survey_submit_generated_draft with expectedDraftUpdatedAt and a complete surveyConfig { title, pages }. The server wraps that as one replaceConfig. Do not send operations, addPage, or replaceConfig yourself. Do not paste the questionnaire as a markdown/JSON code block. Incomplete sliders/matrices/rankings do not count as coverage.
4. Call survey_validate after a substantial candidate if needed. Do not claim success until the submit tool succeeds.
5. Never AI-generate images to upload. Use project / template / preview media.
6. Do not put skillHtml on questions. Do not include API keys.
7. If a submit fails, keep the current expectedDraftUpdatedAt unless told to reload the draft, then resubmit a complete surveyConfig.
8. After saving, the runtime verifies the authoritative draft before reporting completion.

If the current task is only a question about the existing survey, answer with read-only tools. Do not generate or submit.
History is background. Do not execute a prior request unless the current message explicitly continues it.`;

export async function runDesignerChat(env, userId, body, request, ctx) {
  const projectId = body?.projectId || null;
  const message = String(body?.message || '').trim();
  if (!message) throw Object.assign(new Error('message is required'), { status: 400 });
  const assistantMode = normalizeAssistantMode(body?.assistantMode);
  const intent = classifyUserIntent(message, assistantMode);
  const draftRequestedByGoal = intent.draftWrite || requestsContinuePriorTask(message);
  const modePolicy = getAssistantModePolicy(assistantMode, {
    goalRequiresDraftChange: draftRequestedByGoal,
    explicitRedesign: requestsExplicitRedesign(message),
    denyPublish: !intent.publish,
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
  const binding = await resolveAssistantBinding(env, userId, provider, model, { receiverProfiles: profiles });
  const cred = binding.credential;
  const profile = binding.profile;
  const checkedRoute = assertRoute({
    provider,
    model,
    profile,
    effort,
    requireConfigured: true,
    credential: cred,
  });
  const resolved = checkedRoute.provider;
  const modelRecord = resolveModel(provider, model, profile);
  const route = checkedRoute.route;
  const temperature = body?.temperature ?? settings.temperature ?? 0.4;
  const catalogMax = Number(modelRecord?.maxTokens) || 8192;
  const requestedTokens = body?.max_tokens != null ? Number(body.max_tokens) : null;
  const pageHint = Number((String(message).match(/(?:至少|at\s+least)?\s*(\d+)\s*(?:页|pages?)/i) || [])[1] || 0);
  const generateBudget = assistantMode === 'generate'
    ? Math.min(catalogMax, Math.max(8192, (pageHint || 3) * 1800))
    : Math.min(catalogMax, 8192);
  const maxTokens = Math.min(catalogMax, requestedTokens || generateBudget);

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
        maxTokens,
        outputBudget: maxTokens,
        catalogMaxTokens: catalogMax,
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
      parentRunId: body?._parentRunId || null,
      inboxId: body?._inboxId || null,
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
    await emit(createEvent('user.message', {
      content: message,
      assistantMode,
      taskId: run.id,
      intent: intent.goal,
      goals: intent.goals,
    }));
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

  if (!body?._claimedBy) {
    body._claimedBy = `inline:${run.id}`;
    await claimRun(env, run.id, body._claimedBy).catch(() => null);
  }

  if (assistantMode === 'question' && (intent.draftWrite || intent.publishOrDelete || intent.projectMeta)) {
    await emit(createEvent('assistant.message', {
      content: QUESTION_MODE_WRITE_REFUSED,
      questionModeWriteRefused: true,
      pendingWrite: message,
      runId: run.id,
    }));
    await finishRun(env, run.id, {
      status: 'completed',
      result: {
        assistantMode,
        intent: 'question',
        message: QUESTION_MODE_WRITE_REFUSED,
        questionModeWriteRefused: true,
        pendingWrite: message,
        draftMutated: false,
        persisted: false,
        taskStatus: 'rejected',
      },
    });
    await emit(createEvent('run.status', { status: 'completed', assistantMode, taskStatus: 'rejected' }));
    return {
      success: true,
      runtime: 'sp-agent-runtime/0.2',
      sessionId: session.id,
      runId: run.id,
      assistantMode,
      intent: 'question',
      message: QUESTION_MODE_WRITE_REFUSED,
      questionModeWriteRefused: true,
      pendingWrite: message,
      events: await listEvents(env, session.id),
    };
  }

  let boundProjectId = projectId;
  const coreTools = createDesignerTools({
      env,
      accessToken: body?.accessToken,
      projectId,
      getProjectId: () => boundProjectId,
      request,
      writerSource: 'assistant',
      ownerUserId: body?._sessionPrepared ? userId : null,
      assistantMode,
      generateGoal: assistantMode === 'generate' && intent.write ? parseGenerateGoals(message) : null,
      editorContext: body?.editorContext || null,
    });
  const domainTools = (assistantMode === 'agent' || assistantMode === 'question')
    ? createPlatformTools({
      env,
      userId,
      accessToken: body?._sessionPrepared ? null : body?.accessToken,
      projectId,
      request,
    }).map((tool) => {
      if (tool.name !== 'survey_create_project' && tool.name !== 'survey_create_from_template') {
        return tool;
      }
      return {
        ...tool,
        async execute(args, ctx) {
          const created = await tool.execute(args, ctx);
          const nextId = created?.projectId || created?.project?.id || created?.id;
          if (nextId) boundProjectId = nextId;
          return created;
        },
      };
    })
    : [];
  const registry = createToolRegistry(applyAssistantModeToTools(
    [...coreTools, ...domainTools],
    modePolicy,
  ));

  const history = annotateHistoryForModel(
    eventsToUiMessages(
      body?._sessionPrepared
        ? priorEvents.filter((event) => event.run_id !== run.id)
        : priorEvents,
    ).slice(-12),
  );

  const research = body?.researchContext || {};
  const researchBlock = research.topic || research.requirements
    ? `\nResearch context:\n- topic: ${research.topic || ''}\n- requirements: ${research.requirements || ''}\n- scenario: ${research.scenario || ''}`
    : '';
  const focus = body?.editorContext || {};
  const workingCopyBlock = summarizeWorkingCopy(focus);
  const editorBlock = focus.pageName || focus.questionName || focus.panel || focus.draftUpdatedAt || workingCopyBlock || focus.resultsScope
    ? `\nEditor focus:\n- projectId: ${boundProjectId || ''}\n- pageName: ${focus.pageName || ''}\n- questionName: ${focus.questionName || ''}\n- panel: ${focus.panel || ''}\n- baselineDraftUpdatedAt: ${focus.draftUpdatedAt || ''}\n- hasUnsavedChanges: ${focus.hasUnsavedChanges || focus.dirty ? 'yes' : 'no'}\nIf the user says "this question" or "this page", use those stable names. Do not invent DOM labels as IDs.${workingCopyBlock}`
    : '';
  const resultsScope = focus.resultsScope || null;
  const resultsBlock = resultsScope
    ? `\nResults analysisScope (authoritative; do not silently change it):\n${JSON.stringify(resultsScope)}\nCall survey_results_summary with this scope. Platform computes statistics including TrueSkill. Explain numbers; never invent methods, significance, or causal claims. Results tasks are read-only: do not save, publish, or delete. survey_export_responses returns a downloadable file, not CSV text to quote.`
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
          content: `${assistantMode === 'generate' ? GENERATE_DESIGNER_SYSTEM : DESIGNER_SYSTEM}\n\n${modePolicy.systemPrompt}${researchBlock}${editorBlock}${resultsBlock}`,
        },
        ...history,
        { role: 'user', content: currentTaskMessage(message, intent) },
      ],
      registry,
      ctx: {
        permission: (modePolicy.readOnly || resultsScope) ? 'ask' : (assistantMode === 'agent' ? 'media' : permission),
        userId,
        projectId,
        assistantMode,
        ...createToolExecutionHooks(env, run.id),
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
      writeTools: assistantMode === 'generate'
        ? ['survey_submit_generated_draft']
        : ['survey_apply_operations'],
      checkCancelled: createRunCancellationCheck(env, run.id, {
        signal: request?.signal,
        claimedBy: body?._claimedBy || `inline:${run.id}`,
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
      await updateRunCheckpoint(env, run.id, result.checkpoint, 'running');
      await dispatchAgentRun(env, null, {
        kind: 'designer',
        userId,
        sessionId: session.id,
        runId: run.id,
        claimedBy: body?._claimedBy,
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
      result.draftVerified = verification.ok === true;
      result.draftVerificationReason = verification.reason;
      await emit(createEvent('tool.result', {
        id: verificationId,
        name: 'survey_get_draft',
        ok: verification.ok,
        verification: true,
        summary: verification.ok
          ? 'Saved draft verified'
          : (verification.reason === 'unverified'
            ? 'Save submitted; verification did not complete'
            : 'Saved draft does not match the intended result'),
        result: {
          draftUpdatedAt: verified?.draftUpdatedAt || null,
          reason: verification.reason,
          verified: verification.ok === true,
          pageCount: result.latestDraft?.surveyConfig?.pages?.length || 0,
          questionCount: (result.latestDraft?.surveyConfig?.pages || [])
            .reduce((count, page) => count + (page.elements || []).length, 0),
          types: [...new Set((result.latestDraft?.surveyConfig?.pages || [])
            .flatMap((page) => (page.elements || []).map((element) => element.type))
            .filter(Boolean))],
          urls: verified?.urls || null,
        },
      }));
      if (verification.reason === 'mismatch' || (verification.reason !== 'unverified' && !verification.ok)) {
        throw Object.assign(new Error(
          'The saved draft could not be verified against the intended survey configuration.',
        ), {
          status: 409,
          code: 'DRAFT_VERIFICATION_FAILED',
          retryable: true,
        });
      }
      if (verification.ok) {
        result.latestDraft = {
          surveyConfig: verified?.surveyConfig || result.latestDraft.surveyConfig,
          draftUpdatedAt: verified?.draftUpdatedAt || result.latestDraft.draftUpdatedAt,
        };
      }
    }
    const succeededTools = new Set(result.successfulTools || []);
    const projectWriteDone = succeededTools.has('survey_update_project');
    const publishDone = succeededTools.has('survey_publish');
    if (draftRequested && !result.latestDraft?.surveyConfig && !projectWriteDone && !publishDone) {
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
        intent: intent.goal || modePolicy.responseIntent
          || (result.latestDraft?.surveyConfig ? 'adjust' : 'agent'),
        message: result.content || 'Done.',
        draftUpdatedAt: result.latestDraft?.draftUpdatedAt || null,
        draftMutated: Boolean(result.latestDraft?.surveyConfig),
        persisted: Boolean(result.latestDraft?.draftUpdatedAt),
        verified: result.draftVerified === true,
        verificationReason: result.draftVerificationReason || null,
        projectUpdated: projectWriteDone,
        published: publishDone,
        taskStatus: 'completed',
      },
    });
    await emit(createEvent('run.status', {
      status: 'completed',
      taskStatus: 'completed',
      persisted: Boolean(result.latestDraft?.draftUpdatedAt),
      verified: result.draftVerified === true,
      verifyFailed: Boolean(result.latestDraft?.draftUpdatedAt) && result.draftVerified !== true,
      draftUpdatedAt: result.latestDraft?.draftUpdatedAt || null,
      draftMutated: Boolean(result.latestDraft?.surveyConfig),
    }));

    const events = await listEvents(env, session.id);
    const latestDraft = result.latestDraft;
    const afterRun = await claimAfterRunInput(env, session.id).catch(() => []);
    const nextFollowup = afterRun?.[0];
    if (nextFollowup?.content) {
      const payload = nextFollowup.payload && typeof nextFollowup.payload === 'object'
        ? nextFollowup.payload
        : {};
      const childMode = payload.assistantMode || body.assistantMode;
      try {
        await startDesignerRun(env, userId, {
          ...queuedBody({
            ...body,
            assistantMode: childMode,
            projectId: payload.projectId || body.projectId,
            editorContext: payload.editorContext || body.editorContext,
          }),
          sessionId: session.id,
          message: nextFollowup.content,
          assistantMode: childMode,
          _parentRunId: run.id,
          _inboxId: nextFollowup.id,
        }, request, ctx);
      } catch (error) {
        await markInboxFailed(env, nextFollowup.id, error.message, payload);
      }
    }

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
      verified: result.draftVerified === true,
      verificationReason: result.draftVerificationReason || null,
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
    editorContext: body.editorContext || null,
  };
}

export async function startDesignerRun(env, userId, body, request, ctx) {
  await expireStaleAiRuns(env, { userId }).catch(() => null);
  const prepared = await runDesignerChat(env, userId, {
    ...queuedBody(body),
    sessionId: body?.sessionId || null,
    accessToken: body?.accessToken,
    _prepareOnly: true,
    _parentRunId: body?._parentRunId || null,
    _inboxId: body?._inboxId || null,
  }, request, ctx);
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

export async function executeQueuedDesignerRun(env, job, ctx) {
  if (!job?.userId || !job?.runId || !job?.sessionId) {
    throw Object.assign(new Error('Malformed queued Agent run.'), {
      code: 'INVALID_QUEUED_RUN',
      retryable: false,
    });
  }
  const authoritative = await getRunStatus(env, job.runId);
  if (!authoritative) {
    throw Object.assign(new Error('Queued Agent run was not found.'), {
      code: 'RUN_NOT_FOUND',
      retryable: false,
    });
  }
  if (TERMINAL_RUN_STATUSES.has(authoritative.status)) {
    return {
      success: true,
      skipped: true,
      reason: 'terminal',
      sessionId: job.sessionId,
      runId: job.runId,
    };
  }
  await expireStaleAiRuns(env, { userId: job.userId }).catch(() => null);
  const claimed = await claimRun(env, job.runId, job.claimedBy || `queue:${job.runId}`);
  if (!claimed) {
    return {
      success: true,
      skipped: true,
      reason: 'not-claimable',
      sessionId: job.sessionId,
      runId: job.runId,
    };
  }
  const checkpoint = claimed.checkpoint && Object.keys(claimed.checkpoint).length
    ? claimed.checkpoint
    : (job.checkpoint || null);
  const request = new Request(`${env.APP_URL || 'https://sp-survey.org'}/api/agent/chat`, {
    method: 'POST',
  });
  try {
    return await runDesignerChat(env, job.userId, {
      ...queuedBody(job.body),
      sessionId: job.sessionId,
      _runId: job.runId,
      _sessionPrepared: true,
      _checkpoint: checkpoint,
      _claimedBy: job.claimedBy || claimed.claimed_by || `queue:${job.runId}`,
    }, request, ctx);
  } catch (error) {
    // Provider retries and self-repair happen inside the durable loop. Once it
    // records a terminal failure, Queue-level replay would duplicate events.
    error.retryable = false;
    throw error;
  }
}
