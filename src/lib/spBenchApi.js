/**
 * Client helpers for SP-Bench admin + public APIs.
 */

import { supabase } from './supabase';

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (!supabase) return headers;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch {
    // ignore
  }
  return headers;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { success: false, error: text.slice(0, 300) || res.statusText };
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = auth
    ? await authHeaders(body != null ? { 'Content-Type': 'application/json' } : {})
    : (body != null ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(res);
  if (!res.ok || json.success === false) {
    const err = new Error(json.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.details = json.details;
    throw err;
  }
  return json;
}

// ── Public ───────────────────────────────────────────────────────────────────

export async function getBenchPublicStatus() {
  return request('/api/bench/public/status', { auth: false });
}

export async function getBenchPublic() {
  return request('/api/bench/public', { auth: false });
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function getBenchSettings() {
  return request('/api/bench/settings');
}

export async function patchBenchSettings(patch) {
  return request('/api/bench/settings', { method: 'PATCH', body: patch });
}

export async function listBenchProviders() {
  return request('/api/bench/providers');
}

export async function putBenchProviderKey(providerId, apiKey) {
  return request('/api/bench/providers', {
    method: 'PUT',
    body: { providerId, apiKey },
  });
}

export async function deleteBenchProviderKey(providerId) {
  return request(`/api/bench/providers?id=${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  });
}

export async function listBenchModels() {
  return request('/api/bench/models');
}

export async function createBenchModel(row) {
  return request('/api/bench/models', { method: 'POST', body: row });
}

export async function patchBenchModel(patch) {
  return request('/api/bench/models', { method: 'PATCH', body: patch });
}

export async function listBenchDimensions() {
  return request('/api/bench/dimensions');
}

export async function saveBenchDimensions(dimensions) {
  return request('/api/bench/dimensions', { method: 'PUT', body: { dimensions } });
}

export async function listBenchMethods() {
  return request('/api/bench/methods');
}

export async function freezeBenchMethod({ version, title, notes }) {
  return request('/api/bench/methods/freeze', {
    method: 'POST',
    body: { version, title, notes },
  });
}

export async function listBenchDatasets() {
  return request('/api/bench/datasets');
}

export async function createBenchDataset({ version, title, method_id, notes }) {
  return request('/api/bench/datasets', {
    method: 'POST',
    body: { version, title, method_id, notes },
  });
}

export async function importBenchItems(datasetId, items) {
  return request('/api/bench/datasets/items', {
    method: 'POST',
    body: { datasetId, items },
  });
}

export async function listBenchItems(datasetId) {
  return request(`/api/bench/datasets/items?datasetId=${encodeURIComponent(datasetId)}`);
}

export async function freezeBenchDataset(datasetId, methodId) {
  return request('/api/bench/datasets/freeze', {
    method: 'POST',
    body: { datasetId, method_id: methodId || undefined },
  });
}

export async function listBenchRuns() {
  return request('/api/bench/runs');
}

export async function createBenchRuns({ modelIds, unevaluatedOnly, datasetId, methodId } = {}) {
  return request('/api/bench/runs', {
    method: 'POST',
    body: { modelIds, unevaluatedOnly, datasetId, methodId },
  });
}

export async function processBenchRun(runId) {
  return request(`/api/bench/runs/${encodeURIComponent(runId)}/process`, {
    method: 'POST',
    body: {},
  });
}

export async function reviewBenchRun(runId, action, notes, publish) {
  return request(`/api/bench/runs/${encodeURIComponent(runId)}/review`, {
    method: 'POST',
    body: { action, notes, publish },
  });
}

export async function getBenchRunResults(runId) {
  return request(`/api/bench/runs/${encodeURIComponent(runId)}/results`);
}
