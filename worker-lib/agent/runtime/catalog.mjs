import { CATALOG_PROVIDERS, CATALOG_VERSION } from './catalog.generated.mjs';

export const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/;
export const PROTOCOLS = [
  { id: 'openai-completions', label: 'openai-completions' },
  { id: 'openai-responses', label: 'openai-responses' },
  { id: 'anthropic-messages', label: 'anthropic-messages' },
];
export const NATIVE_AUTH = new Set(['aws', 'adc', 'azure', 'oauth']);

export function isProviderId(id) {
  return PROVIDER_ID_RE.test(String(id || ''));
}

export function listCatalogProviders() {
  return CATALOG_PROVIDERS.map((p) => ({ ...p, models: [...(p.models || [])] }));
}

export function catalogProvider(id) {
  return CATALOG_PROVIDERS.find((p) => p.id === id) || null;
}

export function catalogModel(providerId, modelId) {
  const provider = catalogProvider(providerId);
  if (!provider) return null;
  return (provider.models || []).find((m) => m.id === modelId) || null;
}

export function isApiKeyAuth(providerId) {
  const provider = catalogProvider(providerId);
  if (!provider) return true;
  return provider.auth === 'api-key';
}

export function authUnsupported(providerId) {
  const provider = catalogProvider(providerId);
  if (!provider || provider.auth === 'api-key') return null;
  return {
    code: 'AUTH_UNSUPPORTED',
    auth: provider.auth,
    message: provider.authHint || `${provider.displayName} requires native authentication.`,
  };
}

export function normalizeModelRecord(model, fallback = {}) {
  const input = Array.isArray(model.input) && model.input.length
    ? model.input
    : (fallback.input || ['text']);
  return {
    id: model.id,
    name: model.name || model.label || model.id,
    label: model.label || model.name || model.id,
    contextWindow: Number(model.contextWindow || fallback.contextWindow || 128000),
    maxTokens: Number(model.maxTokens || fallback.maxTokens || 8192),
    input,
    vision: input.includes('image'),
    tools: model.tools !== false,
    reasoningEfforts: model.reasoningEfforts || fallback.reasoningEfforts || false,
    defaultEffort: model.defaultEffort || fallback.defaultEffort || null,
    compat: model.compat && typeof model.compat === 'object' ? model.compat : {},
  };
}

export function extraHeaders(providerId) {
  if (providerId === 'openrouter' || providerId === 'vercel-ai-gateway') {
    return {
      'HTTP-Referer': 'https://sp-survey.org',
      'X-Title': 'SP-Survey-Platform',
    };
  }
  return {};
}

export { CATALOG_VERSION, CATALOG_PROVIDERS };
