import { supabase } from './supabase';

const API_BASE = process.env.REACT_APP_SERVER_URL || process.env.REACT_APP_API_URL || '';

export async function fetchAdminResponsePage(projectId, offset = 0) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  if (!session?.access_token) throw new Error('请先登录管理员账户。');
  const query = new URLSearchParams({ project: projectId, offset: String(offset) });
  const response = await fetch(`${API_BASE}/api/admin/project-responses?${query}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.responses)) {
    throw new Error(data.error || '无法加载项目答卷，请稍后重试。');
  }
  return data.responses;
}
