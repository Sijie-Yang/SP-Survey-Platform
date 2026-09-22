import { getUserFromBearer, jsonResponse } from './auth/supabaseJwt.mjs';
import { supabaseRest } from './supabaseUserClient.mjs';
import { loadSurveyResponsePage } from './surveyResponsePages.mjs';

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `admin-results-${Date.now().toString(36)}`;
}

function logFailure(requestId, status, code, stage, extra = {}) {
  console.error(JSON.stringify({
    event: 'admin_project_responses_failed',
    requestId,
    stage,
    code,
    status,
    ...(extra.supabaseStatus != null ? { supabaseStatus: extra.supabaseStatus } : {}),
    ...(extra.supabaseCode ? { supabaseCode: extra.supabaseCode } : {}),
  }));
}

// Read-only platform-admin access. Owners continue to use their existing RLS path.
export async function handleAdminResultsRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/project-responses') return null;
  const requestId = newRequestId();
  const reply = (data, status = 200) => jsonResponse({ ...data, requestId }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  });
  const fail = (status, error, code, stage, extra) => {
    logFailure(requestId, status, code, stage, extra);
    return reply({ error, code, stage }, status);
  };
  if (request.method !== 'GET') return fail(405, 'Method not allowed', 'ADMIN_RESULTS_METHOD', 'method');
  try {
    let auth = null;
    try {
      auth = await getUserFromBearer(request, env);
    } catch {
      return fail(401, '请先登录管理员账户。', 'ADMIN_RESULTS_AUTH', 'auth');
    }
    if (!auth?.user?.id) return fail(401, '请先登录管理员账户。', 'ADMIN_RESULTS_AUTH', 'auth');

    let admins;
    try {
      admins = await supabaseRest(env, {
        path: '/rest/v1/admins', serviceRole: true,
        query: `?${new URLSearchParams({ user_id: `eq.${auth.user.id}`, select: 'user_id' })}`,
      });
    } catch {
      return fail(500, '无法验证管理员身份，请稍后重试。', 'ADMIN_RESULTS_ADMIN_QUERY', 'admin');
    }
    if (!admins?.length) return fail(403, '仅平台管理员可以查看此项目的答卷。', 'ADMIN_RESULTS_FORBIDDEN', 'admin');

    const projectId = url.searchParams.get('project');
    const offset = Number(url.searchParams.get('offset') || 0);
    let after = null;
    try {
      after = url.searchParams.has('after') ? JSON.parse(url.searchParams.get('after')) : null;
      if (after && (!['string', 'number'].includes(typeof after.id) || !String(after.id) || String(after.id).length > 256 || (after.created_at != null && !Number.isFinite(Date.parse(after.created_at))))) {
        throw new Error('Invalid cursor');
      }
    } catch {
      return fail(400, 'Invalid response cursor', 'ADMIN_RESULTS_CURSOR', 'cursor');
    }
    if (!projectId || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return fail(400, 'Invalid project or page', 'ADMIN_RESULTS_INPUT', 'input');
    }

    let projects;
    try {
      projects = await supabaseRest(env, {
        path: '/rest/v1/projects', serviceRole: true,
        query: `?${new URLSearchParams({ id: `eq.${projectId}`, select: 'id', limit: '1' })}`,
      });
    } catch {
      return fail(500, '无法查询项目，请稍后重试。', 'ADMIN_RESULTS_PROJECT_QUERY', 'project');
    }
    if (!projects?.length) return fail(404, '项目不存在或已删除。', 'ADMIN_RESULTS_PROJECT', 'project');

    try {
      const page = await loadSurveyResponsePage((opts) => supabaseRest(env, opts), projectId, { after, offset });
      return reply({ responses: page.responses, skipped: page.skipped });
    } catch (err) {
      return fail(500, '无法加载项目答卷，请稍后重试。', 'ADMIN_RESULTS_RESPONSE_QUERY', 'responses', {
        supabaseStatus: err?.status || null,
        supabaseCode: err?.code || null,
      });
    }
  } catch {
    return fail(500, '无法加载项目答卷，请检查服务配置或稍后重试。', 'ADMIN_RESULTS_UNKNOWN', 'unknown');
  }
}
