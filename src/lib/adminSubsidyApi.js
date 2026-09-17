import { supabase } from './supabase';

const API_BASE = process.env.NODE_ENV === 'production'
  ? (process.env.REACT_APP_SERVER_URL || process.env.REACT_APP_API_URL || '')
  : '';

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (supabase) {
    const result = await supabase.auth.getSession();
    const token = result?.data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    cache: 'no-store',
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const error = new Error(data.error || res.statusText || 'Request failed');
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function getAssistantSubsidy() {
  return request('/api/admin/assistant-subsidy');
}

export function saveAssistantSubsidy(patch) {
  return request('/api/admin/assistant-subsidy', { method: 'PATCH', body: patch });
}
