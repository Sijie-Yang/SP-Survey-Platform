import {
  authUnsupported,
  catalogModel,
  catalogProvider,
  extraHeaders,
  isApiKeyAuth,
  listCatalogProviders,
  normalizeModelRecord,
} from './catalog.mjs';
import { DEFAULT_COMPAT, mergeCompat } from './compat.mjs';
import { DEFAULT_RETRY_POLICY } from './retry.mjs';

export function resolveProvider(providerId, profile = {}, credential = {}) {
  const catalog = catalogProvider(providerId);
  const custom = !catalog;
  const unsupported = authUnsupported(providerId);
  return {
    id: providerId,
    displayName: profile.display_name || profile.displayName || catalog?.displayName || providerId,
    catalog: !custom,
    custom,
    recommended: !!catalog?.recommended,
    auth: catalog?.auth || 'api-key',
    authUnsupported: unsupported,
    authHint: catalog?.authHint || unsupported?.message || null,
    protocol: profile.protocol || catalog?.protocol || 'openai-completions',
    baseUrl: profile.base_url || profile.baseUrl || credential.base_url || catalog?.defaultBaseUrl || '',
    defaultBaseUrl: catalog?.defaultBaseUrl || '',
    keyDocs: catalog?.keyDocs || null,
    configured: Boolean(credential.key_hint || credential.configured),
    hint: credential.key_hint || credential.hint || '',
    defaultInput: profile.default_input || profile.defaultInput || ['text'],
    compat: mergeCompat(catalog?.compat, profile.compat),
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(profile.retry_policy || profile.retryPolicy || {}) },
    defaultModels: catalog?.defaultModels || { assistant: '', silicon: '' },
    group: catalog?.group || (custom ? 'custom' : 'catalog'),
  };
}

export function resolveModels(providerId, profile = {}, catalogModels) {
  const catalog = catalogProvider(providerId);
  const inherited = catalogModels || catalog?.models || [];
  const overrides = Array.isArray(profile.models) ? profile.models : [];
  if (!overrides.length) return inherited.map((model) => normalizeModelRecord(model));
  return overrides.map((model) => {
    const base = inherited.find((item) => item.id === model.id) || {};
    return normalizeModelRecord({ ...base, ...model }, base);
  });
}

export function resolveModel(providerId, modelId, profile = {}) {
  const models = resolveModels(providerId, profile);
  const hit = models.find((model) => model.id === modelId);
  if (hit) return hit;
  const catalog = catalogModel(providerId, modelId);
  if (catalog) return normalizeModelRecord(catalog);
  if (!modelId) return null;
  return normalizeModelRecord({
    id: modelId,
    name: modelId,
    input: profile.default_input || profile.defaultInput || ['text'],
  });
}

export function modelAcceptsImage(providerId, modelId, profile = {}) {
  const model = resolveModel(providerId, modelId, profile);
  return Boolean(model?.vision || model?.input?.includes('image'));
}

export function effortOptions(providerId, modelId, profile = {}) {
  const model = resolveModel(providerId, modelId, profile);
  if (!model?.reasoningEfforts) return [];
  return Object.keys(model.reasoningEfforts);
}

export function buildDirectory({ profiles = [], credentials = [] } = {}) {
  const credById = Object.fromEntries(credentials.map((row) => [row.provider, row]));
  const profileById = Object.fromEntries(profiles.map((row) => [row.provider, row]));
  const ids = new Set([
    ...listCatalogProviders().map((p) => p.id),
    ...Object.keys(profileById),
    ...Object.keys(credById),
  ]);
  return [...ids].map((id) => {
    const provider = resolveProvider(id, profileById[id], credById[id]);
    const models = resolveModels(id, profileById[id]);
    return { ...provider, models };
  });
}

export function publicCatalog() {
  return listCatalogProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    label: provider.displayName,
    recommended: !!provider.recommended,
    auth: provider.auth,
    authHint: provider.authHint || null,
    protocol: provider.protocol,
    defaultBaseUrl: provider.defaultBaseUrl,
    keyDocs: provider.keyDocs || null,
    group: provider.group,
    configurable: isApiKeyAuth(provider.id),
    defaultModels: provider.defaultModels,
    catalog: (provider.models || []).map((model) => normalizeModelRecord(model)),
  }));
}

export { extraHeaders, DEFAULT_COMPAT };
