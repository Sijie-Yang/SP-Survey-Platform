import { getUserFromBearer, jsonResponse } from './auth/supabaseJwt.mjs';
import { supabaseRest } from './supabaseUserClient.mjs';

// Read-only platform-admin access. Owners continue to use their existing RLS path.
export async function handleAdminResultsRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/project-responses') return null;
  const reply = (data, status = 200) => jsonResponse(data, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  try {
    const auth = await getUserFromBearer(request, env);
    if (!auth?.user?.id) return reply({ error: '请先登录管理员账户。' }, 401);
    const admins = await supabaseRest(env, {
      path: '/rest/v1/admins', serviceRole: true,
      query: `?${new URLSearchParams({ user_id: `eq.${auth.user.id}`, select: 'user_id' })}`,
    });
    if (!admins?.length) return reply({ error: '仅平台管理员可以查看此项目的答卷。' }, 403);

    const projectId = url.searchParams.get('project');
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!projectId || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return reply({ error: 'Invalid project or page' }, 400);
    }
    const projects = await supabaseRest(env, {
      path: '/rest/v1/projects', serviceRole: true,
      query: `?${new URLSearchParams({ id: `eq.${projectId}`, select: 'id', limit: '1' })}`,
    });
    if (!projects?.length) return reply({ error: '项目不存在或已删除。' }, 404);
    const rows = await supabaseRest(env, {
      path: '/rest/v1/survey_responses', serviceRole: true,
      query: `?${new URLSearchParams({
        project_id: `eq.${projectId}`, select: '*',
        order: 'created_at.desc,id.desc', limit: '1000', offset: String(offset),
      })}`,
    });
    return reply({ responses: rows || [] });
  } catch {
    return reply({ error: '无法加载项目答卷，请检查服务配置或稍后重试。' }, 500);
  }
}
