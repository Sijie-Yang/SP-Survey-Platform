import { createToolRegistry } from './tools.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { runToolLoop } from './loop.mjs';
import { createEvent, eventsToUiMessages, redactSecrets } from './events.mjs';
import {
  appendEvent,
  createRun,
  createSession,
  finishRun,
  getSession,
  listEvents,
  nextSessionSelection,
  updateSessionSelection,
} from './sessions.mjs';
import {
  listProviderCredentials,
  listProviderProfiles,
  loadProviderCredential,
  loadUserAiSettings,
  saveUserAiSettings,
} from '../credentials.mjs';
import { resolveModel, resolveProvider } from './registry.mjs';
import { assertRoute } from './validators.mjs';

export const DESIGNER_SYSTEM = `You are the SP-Survey in-browser Assistant (designer mode).
You design visual-perception surveys using tools — never invent credentials or image URLs.

Workflow:
1. Always call survey_capabilities before designing or editing.
2. Always call survey_get_draft before any edit and retain draftUpdatedAt.
3. Prefer survey_apply_operations over rewriting the whole config.
4. Call survey_validate after substantial edits.
5. Never AI-generate images to upload. Use project / template / preview media.
6. image*/media*/skillquestion: imageSelectionMode huggingface_random, empty choices (except imagecheckbox tags), preset_* skillId only.
7. Do not put skillHtml on questions. Do not include API keys.

If the user only asks a question, answer without tools.`;

export async function runDesignerChat(env, userId, body, request) {
  const projectId = body?.projectId || null;
  const message = String(body?.message || '').trim();
  if (!message) throw Object.assign(new Error('message is required'), { status: 400 });

  const settings = await loadUserAiSettings(env, userId);
  const permission = body?.permission || settings.permission || 'edit_draft';
  const profiles = await listProviderProfiles(env, userId);
  const credentials = await listProviderCredentials(env, userId);
  const defaultProvider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const defaultModel = settings.assistant_model || resolveProvider(defaultProvider).defaultModels.assistant;
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
  assertRoute({
    provider,
    model,
    profile,
    effort,
    requireConfigured: true,
    credential: credentials.find((row) => row.provider === provider),
  });
  const resolved = resolveProvider(provider, profile);
  const modelRecord = resolveModel(provider, model, profile);
  const cred = await loadProviderCredential(env, userId, provider);
  const temperature = body?.temperature ?? settings.temperature ?? 0.4;
  const maxTokens = body?.max_tokens ?? settings.max_tokens ?? modelRecord?.maxTokens ?? 4096;

  if (!session) {
    session = await createSession(env, {
      userId,
      projectId,
      mode: 'designer',
      title: message.slice(0, 72),
      provider,
      model,
      reasoningEffort: effort,
    });
    await appendEvent(env, {
      sessionId: session.id,
      type: 'session.start',
      payload: { runtime: 'sp-agent-runtime/0.1', provider, model, reasoningEffort: effort },
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

  if (body?.provider && body?.model && (body.provider !== defaultProvider || body.model !== defaultModel)) {
    saveUserAiSettings(env, userId, {
      default_provider: body.provider,
      assistant_provider: body.provider,
      assistant_model: body.model,
      assistant_reasoning_effort: body.reasoningEffort || body.reasoning_effort || effort,
      expectedRevision: settings.settings_revision,
    }).catch(() => null);
  }

  const run = await createRun(env, {
    sessionId: session.id,
    userId,
    projectId,
    provider,
    model,
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
  await emit(createEvent('user.message', { content: message }));
  await emit(createEvent('run.status', { status: 'running' }));

  const registry = createToolRegistry(createDesignerTools({
    env,
    accessToken: body?.accessToken,
    projectId,
    request,
    writerSource: 'assistant',
  }));

  const history = eventsToUiMessages(priorEvents)
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const research = body?.researchContext || {};
  const researchBlock = research.topic || research.requirements
    ? `\nResearch context:\n- topic: ${research.topic || ''}\n- requirements: ${research.requirements || ''}\n- scenario: ${research.scenario || ''}`
    : '';

  try {
    const result = await runToolLoop({
      apiKey: cred.apiKey,
      provider: cred.provider,
      baseUrl: cred.baseUrl || resolved.baseUrl,
      model,
      protocol: resolved.protocol,
      compat: { ...resolved.compat, ...(modelRecord?.compat || {}) },
      retryPolicy: resolved.retryPolicy,
      effort,
      efforts: modelRecord?.reasoningEfforts || false,
      messages: [
        { role: 'system', content: DESIGNER_SYSTEM + researchBlock },
        ...history.filter((m) => m.content),
        { role: 'user', content: message },
      ],
      registry,
      ctx: { permission, userId, projectId },
      temperature,
      maxTokens,
      onEvent: emit,
    });

    await finishRun(env, run.id, {
      status: 'completed',
      prompt_tokens: result.usage.prompt_tokens || 0,
      completion_tokens: result.usage.completion_tokens || 0,
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
      intent: latestDraft?.surveyConfig ? 'adjust' : 'question',
      message: result.content || 'Done.',
      surveyConfig: latestDraft?.surveyConfig || null,
      draftUpdatedAt: latestDraft?.draftUpdatedAt || null,
      usage: result.usage,
      events: events.slice(-40),
      messages: eventsToUiMessages(events),
    };
  } catch (error) {
    await finishRun(env, run.id, {
      status: error.code === 'CANCELLED' ? 'cancelled' : 'failed',
      error_summary: String(error.message || 'failed').slice(0, 400),
    });
    await emit(createEvent('error', redactSecrets({ message: error.message, code: error.code })));
    throw error;
  }
}
