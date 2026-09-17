import { supabaseRest } from '../supabaseUserClient.mjs';
import {
  resolveModel,
  resolveModelRoute,
  resolveModels,
  resolveProvider,
} from './runtime/registry.mjs';

export function normalizeSubsidyRoutes(routes = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(routes) ? routes : []) {
    const provider = String(item?.provider || '').trim();
    const model = String(item?.model || '').trim();
    if (!provider || !model) continue;
    const key = `${provider}::${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider, model });
  }
  return out;
}

export function isSubsidyActive(row, now = Date.now()) {
  if (!row?.enabled || !row.donor_user_id) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= now) return false;
  return normalizeSubsidyRoutes(row.allowed_routes).length > 0;
}

export function subsidyAllowsRoute(row, provider, model, now = Date.now()) {
  if (!isSubsidyActive(row, now) || !provider || !model) return false;
  return normalizeSubsidyRoutes(row.allowed_routes).some((route) => (
    route.provider === provider && route.model === model
  ));
}

export function publicSubsidyView(row, now = Date.now()) {
  const active = isSubsidyActive(row, now);
  return {
    enabled: active,
    expiresAt: active ? (row.expires_at || null) : null,
    routes: active ? normalizeSubsidyRoutes(row.allowed_routes) : [],
  };
}

export function ownedRouteOptions(directory = []) {
  const options = [];
  for (const provider of directory || []) {
    if (!provider?.userConfigured || provider.authUnsupported) continue;
    for (const model of provider.models || []) {
      if (!model?.id) continue;
      options.push({
        value: `${provider.id}::${model.id}`,
        provider: provider.id,
        model: model.id,
        label: `${provider.displayName || provider.id} / ${model.label || model.name || model.id}`,
      });
    }
  }
  return options;
}

export function applySubsidyToDirectory(directory = [], subsidy = null, { donorProfiles = [] } = {}, now = Date.now()) {
  const routes = isSubsidyActive(subsidy, now) ? normalizeSubsidyRoutes(subsidy.allowed_routes) : [];
  const next = (directory || []).map((provider) => ({
    ...provider,
    userConfigured: Boolean(provider.userConfigured ?? provider.configured),
    models: [...(provider.models || [])],
  }));
  if (!routes.length) {
    return { directory: next, subsidizedRoutes: [] };
  }

  const byProvider = new Map();
  for (const route of routes) {
    if (!byProvider.has(route.provider)) byProvider.set(route.provider, []);
    byProvider.get(route.provider).push(route);
  }

  for (const [providerId, allowed] of byProvider.entries()) {
    const donorProfile = donorProfiles.find((row) => row.provider === providerId) || {};
    let provider = next.find((item) => item.id === providerId);
    if (!provider) {
      const resolved = resolveProvider(providerId, donorProfile);
      provider = {
        ...resolved,
        configured: false,
        userConfigured: false,
        models: [],
        modelCount: 0,
      };
      next.push(provider);
    }
    const allowedIds = new Set(allowed.map((route) => route.model));
    const catalogModels = resolveModels(providerId, donorProfile).map((model) => ({
      ...model,
      runtimeSupported: resolveModelRoute(providerId, model.id, donorProfile)?.supported !== false,
    }));
    if (provider.userConfigured) {
      provider.models = (provider.models.length ? provider.models : catalogModels).map((model) => (
        allowedIds.has(model.id) ? { ...model, shared: true } : model
      ));
    } else {
      const source = catalogModels.length ? catalogModels : provider.models;
      provider.models = source
        .filter((model) => allowedIds.has(model.id) && resolveModel(providerId, model.id, donorProfile)?.id)
        .map((model) => ({ ...model, shared: true }));
      provider.configured = provider.models.length > 0;
      provider.shared = provider.configured;
      provider.hint = null;
    }
  }

  return {
    directory: next,
    subsidizedRoutes: routes.map((route) => ({ ...route, shared: true })),
  };
}

export async function loadSubsidySettings(env) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/platform_assistant_subsidy',
      serviceRole: true,
      query: '?id=eq.1&select=*&limit=1',
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

export async function loadActiveSubsidy(env, now = Date.now()) {
  const row = await loadSubsidySettings(env);
  return isSubsidyActive(row, now) ? row : null;
}

export async function saveSubsidySettings(env, userId, patch = {}) {
  const current = await loadSubsidySettings(env) || {};
  const enabled = patch.enabled != null ? Boolean(patch.enabled) : Boolean(current.enabled);
  const expiresAt = patch.expires_at === undefined
    ? (current.expires_at || null)
    : (patch.expires_at || null);
  const allowedRoutes = normalizeSubsidyRoutes(
    patch.allowed_routes === undefined ? current.allowed_routes : patch.allowed_routes,
  );
  if (enabled && !allowedRoutes.length) {
    throw Object.assign(new Error('Select at least one provider and model to share.'), {
      status: 400,
      code: 'SUBSIDY_ROUTES_REQUIRED',
    });
  }
  const body = {
    id: 1,
    enabled,
    expires_at: expiresAt,
    donor_user_id: enabled ? userId : (current.donor_user_id || userId || null),
    allowed_routes: allowedRoutes,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const rows = await supabaseRest(env, {
    path: '/rest/v1/platform_assistant_subsidy',
    method: 'POST',
    serviceRole: true,
    body,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
