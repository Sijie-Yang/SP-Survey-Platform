import { authUnsupported, isProviderId, PROTOCOLS } from './catalog.mjs';
import { effortOptions, modelAcceptsImage, resolveModel, resolveProvider } from './registry.mjs';
import { assertSafeBaseUrl } from './ssrf.mjs';

export function assertProviderId(id) {
  if (!isProviderId(id)) {
    throw Object.assign(new Error('Start with a lowercase letter; then lowercase letters, digits, and dashes.'), {
      status: 400,
      code: 'PROVIDER_ID_INVALID',
    });
  }
}

export function assertConfigurable(providerId) {
  const blocked = authUnsupported(providerId);
  if (blocked) {
    throw Object.assign(new Error(blocked.message), { status: 400, code: blocked.code, auth: blocked.auth });
  }
}

export function assertProtocol(protocol) {
  if (!PROTOCOLS.some((item) => item.id === protocol)) {
    throw Object.assign(new Error('Unsupported API protocol.'), {
      status: 400,
      code: 'PROTOCOL_UNSUPPORTED',
    });
  }
}

export function assertRoute({
  provider,
  model,
  profile,
  requireVision = false,
  effort,
  requireConfigured = false,
  credential,
} = {}) {
  assertProviderId(provider);
  assertConfigurable(provider);
  if (requireConfigured && !(credential?.key_hint || credential?.configured || credential?.apiKey)) {
    throw Object.assign(new Error('No API key configured. Add one in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  const resolved = resolveProvider(provider, profile);
  if (!resolved.baseUrl && !resolved.defaultBaseUrl) {
    throw Object.assign(new Error('Provider endpoint is not configured.'), {
      status: 400,
      code: 'UNKNOWN_MODEL',
    });
  }
  const record = resolveModel(provider, model, profile);
  if (!record?.id) {
    throw Object.assign(new Error('Select a configured model.'), {
      status: 400,
      code: 'UNKNOWN_MODEL',
    });
  }
  if (requireVision && !modelAcceptsImage(provider, model, profile)) {
    throw Object.assign(new Error('Silicon samples require a vision-language model.'), {
      status: 400,
      code: 'VISION_MODEL_REQUIRED',
    });
  }
  if (effort && effort !== 'off') {
    const allowed = effortOptions(provider, model, profile);
    if (allowed.length && !allowed.includes(effort)) {
      throw Object.assign(new Error(`Unsupported reasoning effort: ${effort}`), {
        status: 400,
        code: 'UNSUPPORTED_REASONING_EFFORT',
      });
    }
  }
  if (resolved.custom || !resolved.catalog) {
    if (profile?.base_url || profile?.baseUrl) assertSafeBaseUrl(profile.base_url || profile.baseUrl);
  }
  return { provider: resolved, model: record };
}

export function assertCustomProviderDraft(draft) {
  assertProviderId(draft.provider);
  assertProtocol(draft.protocol || 'openai-completions');
  assertSafeBaseUrl(draft.baseUrl);
  const models = (draft.models || []).filter((model) => model.id);
  if (!models.length) {
    throw Object.assign(new Error('A custom provider needs at least one model.'), {
      status: 400,
      code: 'CUSTOM_NEEDS_MODELS',
    });
  }
}
