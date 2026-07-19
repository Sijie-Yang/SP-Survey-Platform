/**
 * Client helpers for Urban Perception Deep Search API (Semantic Scholar + Crossref).
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

export async function getResearchProviderStatus() {
  const res = await fetch(`${SERVER_URL}/api/research/status`);
  return readJson(res);
}

export async function listResearchPresets() {
  const res = await fetch(`${SERVER_URL}/api/research/presets`);
  const json = await readJson(res);
  if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load presets');
  return json.presets || [];
}

export async function searchResearchPapers({
  query,
  limit = 20,
  yearFrom = null,
  yearTo = null,
} = {}) {
  const res = await fetch(`${SERVER_URL}/api/research/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, yearFrom, yearTo }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Research search failed');
  }
  return json;
}

export async function scanResearchPapers({
  preset = 'streetscape_perception',
  query = null,
  limit = 15,
  yearFrom = null,
  yearTo = null,
  mode = 'latest',
} = {}) {
  const res = await fetch(`${SERVER_URL}/api/research/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset, query, limit, yearFrom, yearTo, mode }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Research scan failed');
  }
  return json;
}

export async function draftTemplateFromPaper(paper, apiKey = '') {
  const res = await fetch(`${SERVER_URL}/api/research/draft-template`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    // apiKey optional — Worker uses encrypted server-stored BYOK when Authorization is present.
    body: JSON.stringify({ paper, ...(apiKey ? { apiKey } : {}) }),
  });
  const json = await readJson(res);
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Draft template generation failed');
  }
  return json;
}
