/**
 * Browser client for Platform Agent API (credentials, chat, connections).
 */

import { supabase } from './supabase';

// Keep browser requests same-origin in local development. CRA's setupProxy
// forwards /api to Express on :3001, avoiding Safari-specific CORS/preflight
// failures. Production also defaults to the deployed Worker origin.
const API_BASE = process.env.NODE_ENV === 'production'
  ? (process.env.REACT_APP_SERVER_URL || process.env.REACT_APP_API_URL || '')
  : '';

async function getAccessToken() {
  if (!supabase) return null;
  const result = await supabase.auth.getSession();
  return result?.data?.session?.access_token || null;
}

async function agentFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data.error || res.statusText,
      code: data.code,
      status: res.status,
      ...data,
    };
  }
  return data;
}

const DEFAULT_PUBLIC_APP_URL = 'https://sp-survey.org';

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

export function getAgentApiBase() {
  // Prefer same-origin so CRA setupProxy can forward to Express in local dev.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return API_BASE || '';
}

/** Public site origin used in Codex / MCP setup (not localhost). */
export function getPublicAppOrigin() {
  const fromEnv = process.env.REACT_APP_APP_URL || process.env.REACT_APP_PUBLIC_APP_URL;
  if (fromEnv) return stripTrailingSlash(fromEnv);

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return DEFAULT_PUBLIC_APP_URL;
    }
    return stripTrailingSlash(origin);
  }

  return DEFAULT_PUBLIC_APP_URL;
}

/** Codex-facing MCP URL (e.g. https://sp-survey.org/mcp). */
export function getMcpEndpoint() {
  return `${getPublicAppOrigin()}/mcp`;
}

/** Same-origin MCP for local Worker/Express testing. */
export function getSameOriginMcpEndpoint() {
  return `${stripTrailingSlash(getAgentApiBase())}/mcp`;
}

export async function getCredentialStatus() {
  return agentFetch('/api/agent/credentials/status');
}

export async function storeOpenAiCredential(apiKey) {
  return agentFetch('/api/agent/credentials/openai', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function validateOpenAiCredential(apiKey, extras = {}) {
  return agentFetch('/api/agent/credentials/openai', {
    method: 'POST',
    body: JSON.stringify({
      apiKey,
      validateOnly: true,
      provider: extras.provider,
      baseUrl: extras.baseUrl,
    }),
  });
}

export async function deleteOpenAiCredential() {
  return agentFetch('/api/agent/credentials/openai', { method: 'DELETE' });
}

export async function listMcpConnections() {
  return agentFetch('/api/agent/connections');
}

export async function revokeMcpConnection(tokenHash) {
  return agentFetch(`/api/agent/connections/${encodeURIComponent(tokenHash)}`, {
    method: 'DELETE',
  });
}

export async function sendAgentChat({
  message,
  currentConfig,
  conversationHistory,
  researchContext,
  customPrompts,
  enableMultiAgentReview = false,
  reviewMode = '1v1',
  projectId,
  sessionId,
  provider,
  model,
  reasoningEffort,
  permission,
  assistantMode = 'agent',
  onStarted,
  onSnapshot,
  editorContext = null,
}) {
  const started = await agentFetch('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      currentConfig,
      conversationHistory,
      researchContext,
      customPrompts,
      enableMultiAgentReview,
      reviewMode,
      projectId,
      sessionId,
      provider,
      model,
      reasoningEffort,
      permission,
      assistantMode,
      editorContext,
    }),
  });
  if (!started?.success || !started?.queued || !started?.sessionId || !started?.runId) {
    return started;
  }
  onStarted?.(started);
  return waitForAgentRun(started.sessionId, started.runId, { started, onSnapshot });
}

export async function listAiSessions(projectId, mode = 'designer') {
  const q = new URLSearchParams({ projectId: projectId || '', mode });
  return agentFetch(`/api/agent/sessions?${q}`);
}

export async function getAiSession(sessionId, after = 0) {
  const query = after > 0 ? `?after=${encodeURIComponent(after)}` : '';
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}${query}`);
}

export async function archiveAiSession(sessionId) {
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function getAiRun(runId) {
  return agentFetch(`/api/agent/runs/${encodeURIComponent(runId)}`);
}

export async function cancelAiRun(runId) {
  return agentFetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export async function steerAiSession(sessionId, content, target = 'next-step') {
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: 'POST',
    body: JSON.stringify({ content, kind: 'steer', target }),
  });
}

export async function listAiRunApprovals(runId) {
  return agentFetch(`/api/agent/runs/${encodeURIComponent(runId)}/approvals`);
}

export async function answerAiRunApproval(approvalId, approved) {
  return agentFetch(`/api/agent/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'POST',
    body: JSON.stringify({ approved: Boolean(approved) }),
  });
}

function runStatusFromEvents(events = [], runId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (runId && event.run_id && event.run_id !== runId) continue;
    if (event.type === 'run.status' && event.payload?.status) return event.payload.status;
  }
  return '';
}

function runChangedDraft(events = [], runId) {
  return events.some((event) => (
    (!runId || !event.run_id || event.run_id === runId)
    && event.type === 'tool.result'
    && event.payload?.name === 'survey_apply_operations'
    && event.payload?.ok !== false
  ));
}

export async function waitForAgentRun(sessionId, runId, {
  started = {},
  intervalMs = 750,
  timeoutMs = 20 * 60 * 1000,
  onSnapshot,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let after = 0;
  let events = [];
  while (Date.now() < deadline) {
    const snapshot = await getAiSession(sessionId, after);
    if (!snapshot?.success) return snapshot;
    if (Array.isArray(snapshot.events) && snapshot.events.length) {
      events = events.concat(snapshot.events);
      after = Number(snapshot.nextCursor || snapshot.events.at(-1)?.seq || after);
    }
    onSnapshot?.({ ...snapshot, events });
    const run = snapshot.run?.id === runId
      ? snapshot.run
      : snapshot.runs?.find?.((item) => item.id === runId);
    const status = run?.status || runStatusFromEvents(events, runId);
    if (status === 'completed') {
      const result = run?.result || {};
      const draftMutated = result.draftMutated ?? runChangedDraft(snapshot.events, runId);
      return {
        success: true,
        runtime: started.runtime,
        sessionId,
        runId,
        provider: started.provider,
        model: started.model,
        reasoningEffort: started.reasoningEffort,
        assistantMode: result.assistantMode || started.assistantMode,
        intent: result.intent
          || (draftMutated ? 'adjust' : (started.assistantMode === 'agent' ? 'agent' : 'question')),
        message: result.message
          || [...(snapshot.messages || [])].reverse().find((item) => item.role === 'assistant')?.content
          || 'Done.',
        draftUpdatedAt: result.draftUpdatedAt || null,
        surveyConfig: result.surveyConfig || null,
        draftMutated,
        persisted: result.persisted ?? draftMutated,
        verified: result.verified === true,
        events: events.length ? events : (snapshot.events || []),
        messages: snapshot.messages || [],
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      const errorEvent = [...events].reverse().find((event) => (
        (!event.run_id || event.run_id === runId) && event.type === 'error'
      ));
      return {
        success: false,
        sessionId,
        runId,
        status,
        code: errorEvent?.payload?.code || (status === 'cancelled' ? 'CANCELLED' : 'AGENT_RUN_FAILED'),
        error: errorEvent?.payload?.message || run?.error_summary || `Agent run ${status}.`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    success: false,
    sessionId,
    runId,
    code: 'AGENT_RUN_TIMEOUT',
    error: 'The Agent is still running. Reopen this project to reconnect.',
  };
}

export async function storeProviderCredential({
  apiKey,
  provider,
  baseUrl,
  displayName,
  protocol,
  models,
  defaultInput,
  compat,
  retryPolicy,
  custom,
}) {
  return agentFetch('/api/agent/credentials/providers', {
    method: 'POST',
    body: JSON.stringify({
      apiKey,
      provider,
      baseUrl,
      displayName,
      protocol,
      models,
      defaultInput,
      compat,
      retryPolicy,
      custom,
    }),
  });
}

export async function saveProviderProfile(profile) {
  return agentFetch('/api/agent/credentials/profiles', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
}

export async function deleteProviderCredential(provider) {
  return agentFetch(`/api/agent/credentials/providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export async function saveAiSettings(settings) {
  return agentFetch('/api/agent/credentials/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function listProviderCatalog() {
  return agentFetch('/api/agent/credentials/providers');
}

export async function listProviderModels(provider) {
  return agentFetch(`/api/agent/credentials/models?provider=${encodeURIComponent(provider)}`);
}

export async function fetchProviderModels({ provider, baseUrl, apiKey, protocol } = {}) {
  return agentFetch('/api/agent/credentials/models', {
    method: 'POST',
    body: JSON.stringify({ provider, baseUrl, apiKey, protocol }),
  });
}

export async function listSiliconPersonas(projectId) {
  return agentFetch(`/api/agent/silicon/personas?projectId=${encodeURIComponent(projectId)}`);
}

export async function saveSiliconPersona(body) {
  return agentFetch('/api/agent/silicon/personas', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteSiliconPersona(id) {
  return agentFetch(`/api/agent/silicon/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listSiliconRuns(projectId) {
  return agentFetch(`/api/agent/silicon/runs?projectId=${encodeURIComponent(projectId)}`);
}

export async function createSiliconRun(body) {
  return agentFetch('/api/agent/silicon/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function processSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/process`, { method: 'POST' });
}

export async function cancelSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export async function getSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}`);
}

export async function listSiliconResponses(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/responses`);
}

export async function getSiliconCompare(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/compare`);
}

export async function exportSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/export`);
}

export async function approveMcpOAuth({
  client_id,
  redirect_uri,
  code_challenge,
  code_challenge_method = 'S256',
  scopes,
  resource,
  state,
}) {
  return agentFetch('/oauth/approve', {
    method: 'POST',
    body: JSON.stringify({
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scopes,
      resource,
      state,
    }),
  });
}

export async function publishProjectViaApi(projectId, summary) {
  return agentFetch(`/api/agent/projects/${encodeURIComponent(projectId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
}
