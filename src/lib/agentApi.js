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

export function getAgentApiBase() {
  // Prefer same-origin so CRA setupProxy can forward to Express in local dev.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return API_BASE || '';
}

export function getMcpEndpoint() {
  // Same-origin MCP URL (e.g. http://localhost:3000/mcp) — CRA proxies to :3001.
  // In production, Worker serves /mcp on the same host as the SPA.
  const origin = getAgentApiBase();
  return `${String(origin).replace(/\/$/, '')}/mcp`;
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

export async function validateOpenAiCredential(apiKey) {
  return agentFetch('/api/agent/credentials/openai', {
    method: 'POST',
    body: JSON.stringify({ apiKey, validateOnly: true }),
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
    }),
  });
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
