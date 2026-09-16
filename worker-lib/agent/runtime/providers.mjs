/**
 * Compatibility facade over the Harness-aligned catalog, registry, and adapters.
 */

import { modelRequest, toOpenAiTools } from './adapters.mjs';
import {
  CATALOG_PROVIDERS,
  PROVIDER_ID_RE,
  PROTOCOLS,
  catalogProvider,
  extraHeaders,
  isProviderId,
  normalizeModelRecord,
} from './catalog.mjs';
import { modelAcceptsImage, resolveModel, resolveProvider } from './registry.mjs';
import { assertProviderResponseNotRedirect, assertSafeBaseUrl } from './ssrf.mjs';

export {
  PROVIDER_ID_RE,
  PROTOCOLS,
  isProviderId,
};

export const CATALOG_PROVIDER_IDS = CATALOG_PROVIDERS.map((p) => p.id);

export const PROVIDERS = Object.fromEntries(CATALOG_PROVIDERS.map((provider) => [provider.id, {
  id: provider.id,
  label: provider.displayName,
  defaultBaseUrl: provider.defaultBaseUrl,
  recommended: !!provider.recommended,
  defaultModels: provider.defaultModels,
  catalog: (provider.models || []).map((model) => normalizeModelRecord(model)),
  auth: provider.auth,
  protocol: provider.protocol,
}]));

export function detectProvider(plaintext, { baseUrl } = {}) {
  const key = String(plaintext || '').trim();
  const url = String(baseUrl || '').toLowerCase();
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('openrouter')) return 'openrouter';
  if (url.includes('anthropic')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-ds-') || key.toLowerCase().includes('deepseek')) return 'deepseek';
  return 'openai';
}

export function providerMeta(id) {
  const catalog = catalogProvider(id);
  if (catalog) return PROVIDERS[id];
  return {
    id,
    label: id,
    defaultBaseUrl: '',
    recommended: false,
    defaultModels: { assistant: '', fast: '', silicon: '' },
    catalog: [],
    auth: 'api-key',
    protocol: 'openai-completions',
  };
}

export function resolveEndpoint(provider, baseUrl) {
  const resolved = resolveProvider(provider, { baseUrl });
  return assertSafeBaseUrl(baseUrl || resolved.baseUrl || resolved.defaultBaseUrl);
}

export { extraHeaders };

export function modelCapabilities(provider, modelId, profile = {}) {
  const model = resolveModel(provider, modelId, profile);
  return {
    vision: Boolean(model?.vision),
    tools: model?.tools !== false,
    reasoning: Boolean(model?.reasoningEfforts),
    input: model?.input || ['text'],
    reasoningEfforts: model?.reasoningEfforts || false,
    defaultEffort: model?.defaultEffort || null,
    contextWindow: model?.contextWindow,
    maxTokens: model?.maxTokens,
  };
}

export function assertVisionModel(provider, modelId, profile = {}) {
  if (!modelAcceptsImage(provider, modelId, profile)) {
    throw Object.assign(new Error('Silicon samples require a vision-language model.'), {
      status: 400,
      code: 'VISION_MODEL_REQUIRED',
    });
  }
  return modelCapabilities(provider, modelId, profile);
}

export async function listProviderModels(apiKey, provider, baseUrl, { protocol } = {}) {
  const catalog = providerMeta(provider).catalog || [];
  if (catalogProvider(provider)) {
    return { success: true, models: catalog, fetched: false, source: 'catalog' };
  }
  const endpoint = resolveEndpoint(provider, baseUrl);
  if (!endpoint) return { success: true, models: catalog, fetched: false };
  if (protocol && protocol !== 'openai-completions' && protocol !== 'openai-responses') {
    return { success: false, models: catalog, fetched: false, code: 'DISCOVERY_UNSUPPORTED', error: 'This protocol does not support model discovery.' };
  }
  const res = await fetch(`${endpoint}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders(provider),
    },
    redirect: 'manual',
  });
  assertProviderResponseNotRedirect(res);
  if (res.status === 401) {
    return { success: false, models: catalog, fetched: false, code: 'MISSING_CREDENTIAL', error: 'Fetching available models returned 401.' };
  }
  if (!res.ok) {
    return { success: false, models: catalog, fetched: false, code: 'DISCOVERY_FAILED', error: `Discovery failed (${res.status}).` };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { success: false, models: catalog, fetched: false, code: 'MALFORMED_JSON', error: 'Provider returned malformed JSON.' };
  const rows = data.data || data.models;
  if (!Array.isArray(rows)) {
    return { success: false, models: catalog, fetched: false, code: 'DISCOVERY_FAILED', error: 'The provider listed no models. Add them by hand.' };
  }
  const models = rows.filter((row) => row?.id).map((row) => {
    const caps = modelCapabilities(provider, row.id);
    return {
      id: row.id,
      label: row.name || row.display_name || row.id,
      name: row.name || row.display_name || row.id,
      contextWindow: row.context_window || row.context_length || caps.contextWindow,
      maxTokens: row.max_output_tokens || row.max_tokens || caps.maxTokens,
      vision: caps.vision,
      input: caps.input,
      tools: true,
    };
  });
  return {
    success: true,
    models: models.length ? models : catalog,
    fetched: true,
    empty: models.length === 0,
  };
}

export async function chatCompletions(options) {
  return modelRequest({
    ...options,
    protocol: options.protocol || providerMeta(options.provider).protocol || 'openai-completions',
  });
}

export { toOpenAiTools };
