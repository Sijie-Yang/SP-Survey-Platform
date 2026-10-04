import { supabase } from './supabase';
import { restoreResponseContracts } from './slimResponses';
import { loadSurveyResponsePage } from './responsePageLoader';

const API_BASE = process.env.REACT_APP_SERVER_URL || process.env.REACT_APP_API_URL || '';

export class AdminResultsError extends Error {
  constructor(message, { code, stage, requestId, status } = {}) {
    super(message);
    this.name = 'AdminResultsError';
    this.code = code || null;
    this.stage = stage || null;
    this.requestId = requestId || null;
    this.status = status || null;
  }
}

/** Per-load state: contracts already received (sent once per load) and whether the slim RPC exists ('auto' until the first page says). */
export function createResponseLoadSession() {
  return { contracts: new Map(), mode: 'auto' };
}

export async function fetchAdminResponsePage(projectId, offset = 0, after = null, loadSession = null) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  if (!session?.access_token) {
    throw new AdminResultsError('请先登录管理员账户。', { code: 'ADMIN_RESULTS_AUTH', stage: 'auth', status: 401 });
  }
  const query = new URLSearchParams({ project: projectId, offset: String(offset) });
  if (after) query.set('after', JSON.stringify({ id: after.id, created_at: after.created_at || null }));
  if (loadSession) {
    if (loadSession.mode !== 'auto') query.set('mode', loadSession.mode);
    const known = [...loadSession.contracts.keys()];
    if (known.length && known.length <= 200) query.set('known', known.join(','));
  }
  const response = await fetch(`${API_BASE}/api/admin/project-responses?${query}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.responses)) {
    throw new AdminResultsError(data.error || '无法加载项目答卷，请稍后重试。', {
      code: data.code,
      stage: data.stage,
      requestId: data.requestId || response.headers.get('x-request-id'),
      status: response.status,
    });
  }
  return restorePage(data, loadSession);
}

function restorePage({ responses, contracts: received, mode }, loadSession) {
  const contracts = loadSession?.contracts || new Map();
  for (const [key, contract] of Object.entries(received || {})) contracts.set(key, contract);
  if (loadSession && (mode === 'legacy' || mode === 'slim')) loadSession.mode = mode;
  return restoreResponseContracts(responses, contracts);
}

const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

/** Owner Results: same page loader as the admin Worker, through PostgREST with the owner's session (RLS). */
export async function fetchOwnerResponsePage(projectId, after = null, loadSession = createResponseLoadSession()) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const rest = async ({ path, method = 'GET', query = '', body }) => {
    const res = await fetch(`${SUPABASE_URL}${path}${query}`, {
      method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      throw Object.assign(new Error(data?.message || res.statusText || 'Supabase request failed'), {
        status: res.status, code: data?.code, details: data,
      });
    }
    return data;
  };
  // The browser has no Worker memory/subrequest limits: fall back to 50-row pages in two parallel batches.
  const page = await loadSurveyResponsePage(rest, projectId, {
    after, mode: loadSession.mode, knownContracts: [...loadSession.contracts.keys()], legacyKeyLimit: 50, legacyBatch: 25,
  });
  return restorePage(page, loadSession);
}
