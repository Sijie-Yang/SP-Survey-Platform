export const AI_SESSION_PREFIX = 'ai_session_';
export const AI_UNDO_PREFIX = 'ai_undo_';
export const AI_ROUTE_PREFIX = 'ai_route_';
export const AI_PENDING_RUN_PREFIX = 'ai_pending_run_';
export const AI_SIDEBAR_OPEN_KEY = 'sp-ai-sidebar-open';
export const AI_SIDEBAR_WIDTH = 420;
export const PROJECT_SIDEBAR_WIDTH = 400;
export const AI_SIDEBAR_ID = 'admin-ai-sidebar';

export function isPlatformMode() {
  return Boolean(process.env.REACT_APP_SUPABASE_URL);
}

export function routeKey(provider, model) {
  if (!provider || !model) return '';
  return `${provider}::${model}`;
}

export function parseRoute(value) {
  const [provider, model] = String(value || '').split('::');
  return { provider: provider || '', model: model || '' };
}

function firstEffort(model) {
  if (!model?.reasoningEfforts) return '';
  if (typeof model.reasoningEfforts !== 'object') return '';
  return Object.keys(model.reasoningEfforts)[0] || '';
}

function validEffort(model, ...candidates) {
  const allowed = model?.reasoningEfforts && typeof model.reasoningEfforts === 'object'
    ? Object.keys(model.reasoningEfforts)
    : [];
  if (!allowed.length) return '';
  return candidates.find((effort) => effort && allowed.includes(effort))
    || firstEffort(model);
}

export function buildAssistantModelOptions(directory = []) {
  const options = [];
  (directory || []).forEach((provider) => {
    if (!provider.configured || provider.authUnsupported) return;
    (provider.models || []).forEach((model) => {
      if (!model.id) return;
      options.push({
        value: routeKey(provider.id, model.id),
        provider: provider.id,
        model: model.id,
        label: `${provider.displayName || provider.id} / ${model.label || model.name || model.id}`,
        reasoningEfforts: model.reasoningEfforts || false,
        defaultEffort: model.defaultEffort || '',
      });
    });
  });
  return options;
}

export function resolveAssistantRoute({
  directory,
  status,
  storedRoute = '',
  storedEffort = '',
} = {}) {
  const options = buildAssistantModelOptions(directory || status?.directory || []);
  if (storedRoute && options.some((item) => item.value === storedRoute)) {
    const hit = options.find((item) => item.value === storedRoute);
    return {
      route: storedRoute,
      effort: validEffort(hit, storedEffort, hit?.defaultEffort),
      options,
    };
  }
  const route = status?.defaultRoute;
  if (route?.provider && route?.model) {
    const value = routeKey(route.provider, route.model);
    if (options.some((item) => item.value === value)) {
      const hit = options.find((item) => item.value === value);
      return {
        route: value,
        effort: validEffort(hit, storedEffort, route.reasoningEffort, hit?.defaultEffort),
        options,
      };
    }
  }
  const first = options[0];
  return {
    route: first?.value || '',
    effort: first?.defaultEffort || firstEffort(first) || '',
    options,
  };
}

export function readStoredRoute(storage, projectId) {
  if (!projectId || !storage) return { route: '', effort: '' };
  try {
    const raw = storage.getItem(`${AI_ROUTE_PREFIX}${projectId}`);
    if (!raw) return { route: '', effort: '' };
    const parsed = JSON.parse(raw);
    return { route: parsed.route || '', effort: parsed.effort || '' };
  } catch {
    return { route: '', effort: '' };
  }
}

export function writeStoredRoute(storage, projectId, route, effort) {
  if (!projectId || !storage) return;
  storage.setItem(`${AI_ROUTE_PREFIX}${projectId}`, JSON.stringify({
    route: route || '',
    effort: effort || '',
  }));
}

export function readSessionId(storage, projectId) {
  if (!projectId || !storage) return '';
  return storage.getItem(`${AI_SESSION_PREFIX}${projectId}`) || '';
}

export function writeSessionId(storage, projectId, sessionId) {
  if (!projectId || !storage || !sessionId) return;
  storage.setItem(`${AI_SESSION_PREFIX}${projectId}`, sessionId);
}

export function readPendingRun(storage, projectId) {
  if (!projectId || !storage) return null;
  try {
    const raw = storage.getItem(`${AI_PENDING_RUN_PREFIX}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writePendingRun(storage, projectId, value = {}) {
  if (!projectId || !storage) return;
  storage.setItem(`${AI_PENDING_RUN_PREFIX}${projectId}`, JSON.stringify({
    status: value.status || 'running',
    startedAt: value.startedAt || Date.now(),
    sessionId: value.sessionId || '',
    ...(value.runId ? { runId: value.runId } : {}),
  }));
}

export function clearPendingRun(storage, projectId) {
  if (!projectId || !storage) return;
  storage.removeItem(`${AI_PENDING_RUN_PREFIX}${projectId}`);
}

export function latestRunStatus(events = []) {
  return [...events]
    .reverse()
    .find((event) => event?.type === 'run.status')
    ?.payload?.status || '';
}

export function hasAppliedSurveyChange(events = []) {
  return events.some((event) => (
    event?.type === 'tool.result'
    && event?.payload?.name === 'survey_apply_operations'
    && event?.payload?.ok !== false
  ));
}

export function loadingStatusFromEvents(events = []) {
  const recent = [...events].reverse();
  const status = latestRunStatus(events);
  if (status === 'awaiting_approval' || recent.some((event) => event?.type === 'approval.ask')) {
    return 'Waiting for your approval…';
  }
  const activeCall = recent.find((event) => event?.type === 'tool.call' && !events.some((candidate) => (
    candidate?.type === 'tool.result'
    && candidate?.payload?.id
    && candidate.payload.id === event.payload?.id
  )));
  if (activeCall?.payload?.verification) return 'Verifying saved draft…';
  if (activeCall?.payload?.name) return `Using ${activeCall.payload.name}…`;
  if (recent.some((event) => event?.type === 'llm.retry')) return 'Retrying model request…';
  if (recent.some((event) => event?.type === 'context.compact')) return 'Compacting context and continuing…';
  const step = recent.find((event) => event?.type === 'step.start')?.payload?.step;
  if (Number.isFinite(step)) return `Working on step ${step + 1}…`;
  if (status === 'queued') return 'Queued…';
  if (status === 'running') return 'Continuing survey generation…';
  return 'Thinking…';
}

export function readUndoSnapshot(storage, projectId) {
  if (!projectId || !storage) return null;
  try {
    const raw = storage.getItem(`${AI_UNDO_PREFIX}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeUndoSnapshot(storage, projectId, config) {
  if (!projectId || !storage || !config) return;
  storage.setItem(`${AI_UNDO_PREFIX}${projectId}`, JSON.stringify(config));
}

export function clearUndoSnapshot(storage, projectId) {
  if (!projectId || !storage) return;
  storage.removeItem(`${AI_UNDO_PREFIX}${projectId}`);
}

export function isStaleAssistantRequest(request, current) {
  return !request?.projectId
    || !current?.projectId
    || request.projectId !== current.projectId
    || request.generation !== current.generation;
}

export function credentialConfigured(status) {
  return Boolean(
    status?.openai?.configured
    || (status?.configuredProviders || []).length
    || (status?.providers || []).some((row) => row.key_hint)
  );
}

export function sendBlockReason({
  hasProject,
  apiKeyValid,
  platformMode,
  routeUnavailable,
  openaiApiKey,
}) {
  if (!hasProject) return 'no-project';
  if (platformMode && !apiKeyValid) return 'no-key';
  if (!platformMode && !apiKeyValid && !openaiApiKey) return 'no-key';
  if (routeUnavailable) return 'no-model';
  return '';
}

export function readSidebarOpen(storage) {
  if (!storage) return false;
  return storage.getItem(AI_SIDEBAR_OPEN_KEY) === 'true';
}

export function writeSidebarOpen(storage, open) {
  if (!storage) return;
  storage.setItem(AI_SIDEBAR_OPEN_KEY, open ? 'true' : 'false');
}

export function workspaceChromeWidths({ projectOpen, aiOpen, isDesktop }) {
  return {
    left: projectOpen ? PROJECT_SIDEBAR_WIDTH : 0,
    right: isDesktop && aiOpen ? AI_SIDEBAR_WIDTH : 0,
  };
}

export function exclusiveSidebarOpen({ isDesktop, otherIsOpen }) {
  return {
    otherOpen: isDesktop ? otherIsOpen : false,
  };
}
