/**
 * Browser client for Platform Agent API (credentials, chat, connections).
 */

import { supabase } from './supabase';

const API_BASE =
  process.env.REACT_APP_SERVER_URL
  || process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

async function getAccessToken() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function agentFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
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
}) {
  return agentFetch('/api/agent/chat', {
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
    }),
  });
}

export async function listAiSessions(projectId, mode = 'designer') {
  const q = new URLSearchParams({ projectId: projectId || '', mode });
  return agentFetch(`/api/agent/sessions?${q}`);
}

export async function getAiSession(sessionId) {
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
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
