import { supabase } from './supabase';

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

export async function fetchAdminResponsePage(projectId, offset = 0, after = null) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  if (!session?.access_token) {
    throw new AdminResultsError('请先登录管理员账户。', { code: 'ADMIN_RESULTS_AUTH', stage: 'auth', status: 401 });
  }
  const query = new URLSearchParams({ project: projectId, offset: String(offset) });
  if (after) query.set('after', JSON.stringify({ id: after.id, created_at: after.created_at || null }));
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
  return data.responses;
}
