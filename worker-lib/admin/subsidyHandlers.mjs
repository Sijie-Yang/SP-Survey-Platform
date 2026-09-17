import { getUserFromBearer, jsonResponse, errorResponse } from '../auth/supabaseJwt.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { getCredentialStatus, loadProviderCredential } from '../agent/credentials.mjs';
import {
  loadSubsidySettings,
  normalizeSubsidyRoutes,
  ownedRouteOptions,
  publicSubsidyView,
  saveSubsidySettings,
} from '../agent/subsidy.mjs';

async function requireAdmin(request, env) {
  const auth = await getUserFromBearer(request, env);
  if (!auth?.user?.id) {
    throw Object.assign(new Error('Authentication required'), { status: 401, code: 'UNAUTHENTICATED' });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/admins',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(auth.user.id)}&select=user_id`,
  });
  if (!Array.isArray(rows) || !rows[0]) {
    throw Object.assign(new Error('Admin only'), { status: 403, code: 'FORBIDDEN' });
  }
  return auth;
}

function adminSubsidyView(row) {
  const pub = publicSubsidyView(row);
  return {
    enabled: Boolean(row?.enabled),
    active: pub.enabled,
    expires_at: row?.expires_at || null,
    donor_user_id: row?.donor_user_id || null,
    allowed_routes: normalizeSubsidyRoutes(row?.allowed_routes),
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
  };
}

export async function handleAssistantSubsidyRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/assistant-subsidy') return null;

  try {
    const auth = await requireAdmin(request, env);
    const userId = auth.user.id;

    if (request.method === 'GET') {
      const settings = await loadSubsidySettings(env);
      const status = await getCredentialStatus(env, userId);
      const ownedDirectory = (status.directory || []).map((provider) => (
        provider.userConfigured
          ? { ...provider, shared: false, models: (provider.models || []).map((model) => ({ ...model, shared: false })) }
          : provider
      ));
      return jsonResponse({
        success: true,
        settings: adminSubsidyView(settings),
        availableRoutes: ownedRouteOptions(ownedDirectory),
      });
    }

    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => ({}));
      const allowedRoutes = normalizeSubsidyRoutes(body.allowed_routes);
      if (body.enabled) {
        if (!allowedRoutes.length) {
          throw Object.assign(new Error('Select at least one provider and model to share.'), {
            status: 400,
            code: 'SUBSIDY_ROUTES_REQUIRED',
          });
        }
        for (const route of allowedRoutes) {
          await loadProviderCredential(env, userId, route.provider);
        }
      }
      const saved = await saveSubsidySettings(env, userId, {
        enabled: body.enabled,
        expires_at: body.expires_at,
        allowed_routes: allowedRoutes,
      });
      return jsonResponse({ success: true, settings: adminSubsidyView(saved) });
    }

    return jsonResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    return errorResponse(error);
  }
}
