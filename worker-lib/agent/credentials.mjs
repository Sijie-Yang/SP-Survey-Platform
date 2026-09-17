/**
 * Encrypted BYOK credentials (write-only) plus provider profiles.
 */

import {
  base64ToBytes,
  bytesToBase64,
  decryptApiKey,
  detectProvider,
  encryptApiKey,
  keyHint,
} from '../crypto/byokAesGcm.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { CATALOG_VERSION, catalogProvider, isProviderId } from './runtime/catalog.mjs';
import { modelRequest } from './runtime/adapters.mjs';
import {
  availableModelId,
  buildDirectory,
  publicCatalog,
  resolveModel,
  resolveModelRoute,
  resolveProvider,
} from './runtime/registry.mjs';
import { assertConfigurable, assertProviderId, assertRoute } from './runtime/validators.mjs';
import {
  applySubsidyToDirectory,
  loadActiveSubsidy,
  publicSubsidyView,
  subsidyAllowsRoute,
} from './subsidy.mjs';

function toByteaHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return `\\x${Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function fromBytea(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length / 2; i += 1) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    return base64ToBytes(value);
  }
  return new Uint8Array(value);
}

function normalizeProviderId(id, fallback = 'openai') {
  const value = String(id || '').trim();
  if (isProviderId(value)) return value;
  return isProviderId(fallback) ? fallback : 'openai';
}

export async function listProviderCredentials(env, userId) {
  const load = async (select) => supabaseRest(env, {
    path: '/rest/v1/user_ai_provider_credentials',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=${select}`,
  });
  try {
    const rows = await load('provider,key_hint,base_url,display_name,protocol,models,validated_at,updated_at');
    return Array.isArray(rows) ? rows : [];
  } catch {
    try {
      const rows = await load('provider,key_hint,base_url,validated_at,updated_at');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
}

export async function listProviderProfiles(env, userId) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/user_ai_provider_profiles',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    });
    if (Array.isArray(rows) && rows.length) return rows;
  } catch {
    // fall through to credential-embedded profiles
  }
  const creds = await listProviderCredentials(env, userId);
  return creds.map((row) => ({
    provider: row.provider,
    display_name: row.display_name,
    protocol: row.protocol || 'openai-completions',
    base_url: row.base_url,
    models: row.models || [],
  }));
}

export async function saveProviderProfile(env, userId, profile) {
  assertProviderId(profile.provider);
  assertConfigurable(profile.provider);
  const installed = catalogProvider(profile.provider);
  const catalogEndpointOverride = ['cloudflare-ai-gateway', 'cloudflare-workers-ai'].includes(profile.provider);
  const existing = (await listProviderProfiles(env, userId))
    .find((row) => row.provider === profile.provider) || {};
  const now = new Date().toISOString();
  const body = {
    user_id: userId,
    provider: profile.provider,
    display_name: profile.displayName ?? profile.display_name ?? existing.display_name ?? null,
    protocol: installed?.protocol || profile.protocol || existing.protocol || 'openai-completions',
    base_url: installed
      ? (catalogEndpointOverride ? (profile.baseUrl ?? profile.base_url ?? existing.base_url ?? null) : null)
      : (profile.baseUrl ?? profile.base_url ?? existing.base_url ?? null),
    default_input: profile.defaultInput || profile.default_input || existing.default_input || ['text'],
    compat: profile.compat || existing.compat || {},
    retry_policy: profile.retryPolicy || profile.retry_policy || existing.retry_policy || {},
    models: installed ? [] : (profile.models !== undefined ? profile.models : (existing.models || [])),
    enabled: profile.enabled !== undefined ? profile.enabled !== false : existing.enabled !== false,
    updated_at: now,
  };
  const rows = await supabaseRest(env, {
    path: '/rest/v1/user_ai_provider_profiles',
    method: 'POST',
    serviceRole: true,
    body,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return { success: true, profile: Array.isArray(rows) ? rows[0] : rows };
}

export async function deleteProviderProfile(env, userId, provider) {
  try {
    await supabaseRest(env, {
      path: '/rest/v1/user_ai_provider_profiles',
      method: 'DELETE',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
    });
  } catch {
    // ignore
  }
}

export async function loadUserAiSettings(env, userId) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/user_ai_settings',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : {
      default_provider: 'deepseek',
      permission: 'edit_draft',
      temperature: 0.4,
      max_tokens: 4096,
      settings_revision: 1,
    };
  } catch {
    return { default_provider: 'deepseek', permission: 'edit_draft', temperature: 0.4, max_tokens: 4096, settings_revision: 1 };
  }
}

export async function saveUserAiSettings(env, userId, patch = {}) {
  const current = await loadUserAiSettings(env, userId);
  if (patch.expectedRevision != null && Number(current.settings_revision || 1) !== Number(patch.expectedRevision)) {
    throw Object.assign(new Error('Someone else changed these settings. Close and reopen to edit the current values.'), {
      status: 409,
      code: 'SETTINGS_CONFLICT',
    });
  }
  const now = new Date().toISOString();
  const allowed = [
    'default_provider', 'assistant_provider', 'assistant_model',
    'fast_provider', 'fast_model', 'silicon_provider', 'silicon_model',
    'temperature', 'max_tokens', 'reasoning_effort', 'permission',
    'assistant_reasoning_effort', 'silicon_reasoning_effort',
  ];
  const body = {
    user_id: userId,
    updated_at: now,
    settings_revision: Number(current.settings_revision || 1) + 1,
  };
  for (const key of allowed) {
    if (patch[key] !== undefined) body[key] = patch[key];
  }
  const profiles = await listProviderProfiles(env, userId);
  const profile = profiles.find((row) => row.provider === (body.assistant_provider || current.assistant_provider || body.default_provider));
  const credentials = await listProviderCredentials(env, userId);
  const subsidy = await loadActiveSubsidy(env);
  if (body.assistant_model && (body.assistant_provider || current.assistant_provider || body.default_provider)) {
    const providerId = body.assistant_provider || current.assistant_provider || body.default_provider;
    const viaSubsidy = subsidyAllowsRoute(subsidy, providerId, body.assistant_model);
    assertRoute({
      provider: providerId,
      model: body.assistant_model,
      profile,
      effort: body.assistant_reasoning_effort || body.reasoning_effort,
      requireConfigured: true,
      credential: credentials.find((row) => row.provider === providerId) || (viaSubsidy ? { configured: true } : null),
    });
  }
  if (body.silicon_model && (body.silicon_provider || current.silicon_provider || body.default_provider)) {
    const providerId = body.silicon_provider || current.silicon_provider || body.default_provider;
    const siliconProfile = profiles.find((row) => row.provider === providerId);
    assertRoute({
      provider: providerId,
      model: body.silicon_model,
      profile: siliconProfile,
      requireVision: true,
      effort: body.silicon_reasoning_effort,
      requireConfigured: true,
      credential: credentials.find((row) => row.provider === providerId),
    });
  }
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/user_ai_settings',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return { success: true, settings: Array.isArray(rows) ? rows[0] : rows };
  } catch (error) {
    delete body.settings_revision;
    delete body.assistant_reasoning_effort;
    delete body.silicon_reasoning_effort;
    const rows = await supabaseRest(env, {
      path: '/rest/v1/user_ai_settings',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return { success: true, settings: Array.isArray(rows) ? rows[0] : rows };
  }
}

export async function getCredentialStatus(env, userId) {
  const [credentials, profiles, settings] = await Promise.all([
    listProviderCredentials(env, userId),
    listProviderProfiles(env, userId),
    loadUserAiSettings(env, userId),
  ]);
  try {
    const legacy = await supabaseRest(env, {
      path: '/rest/v1/user_ai_credentials',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=provider,key_hint,validated_at,updated_at`,
    });
    const row = Array.isArray(legacy) ? legacy[0] : null;
    if (row && !credentials.some((p) => p.provider === row.provider)) {
      credentials.push({
        provider: row.provider,
        key_hint: row.key_hint,
        validated_at: row.validated_at,
        updated_at: row.updated_at,
        legacy: true,
      });
    }
  } catch {
    // legacy table optional
  }
  const directory = buildDirectory({ profiles, credentials }).map((provider) => ({
    ...provider,
    userConfigured: Boolean(provider.configured),
  }));
  const subsidy = await loadActiveSubsidy(env);
  let donorProfiles = [];
  if (subsidy?.donor_user_id) {
    donorProfiles = await listProviderProfiles(env, subsidy.donor_user_id).catch(() => []);
  }
  const merged = applySubsidyToDirectory(directory, subsidy, { donorProfiles });
  const configuredProviders = merged.directory.filter((item) => item.configured && item.userConfigured);
  const assistantReady = configuredProviders.length > 0 || merged.subsidizedRoutes.length > 0;
  const assistantProvider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const siliconProvider = settings.silicon_provider || settings.default_provider || 'deepseek';
  const assistantProfile = profiles.find((row) => row.provider === assistantProvider);
  const siliconProfile = profiles.find((row) => row.provider === siliconProvider);
  const subsidizedDefault = merged.subsidizedRoutes[0] || null;
  const userOwnsAssistant = configuredProviders.some((item) => item.id === assistantProvider);
  const defaultRoute = userOwnsAssistant || !subsidizedDefault
    ? {
      provider: assistantProvider,
      model: availableModelId(assistantProvider, settings.assistant_model, { profile: assistantProfile }),
      reasoningEffort: settings.assistant_reasoning_effort || settings.reasoning_effort || null,
    }
    : {
      provider: subsidizedDefault.provider,
      model: subsidizedDefault.model,
      reasoningEffort: null,
      shared: true,
    };
  const siliconRoute = {
    provider: siliconProvider,
    model: availableModelId(siliconProvider, settings.silicon_model, {
      profile: siliconProfile,
      vision: true,
    }),
    reasoningEffort: settings.silicon_reasoning_effort || null,
  };
  const primary = configuredProviders.find((p) => p.id === assistantProvider) || configuredProviders[0] || null;
  return {
    success: true,
    catalogVersion: CATALOG_VERSION,
    catalog: publicCatalog({ summariesOnly: true }),
    directory: merged.directory,
    configuredProviders: configuredProviders.map((provider) => provider.id),
    subsidizedRoutes: merged.subsidizedRoutes,
    subsidy: publicSubsidyView(subsidy),
    assistantConfigured: assistantReady,
    defaultRoute,
    siliconRoute,
    providers: credentials,
    settings: {
      ...settings,
      assistant_model: defaultRoute.model,
      silicon_model: siliconRoute.model,
    },
    openai: assistantReady
      ? {
        configured: true,
        provider: primary?.id || defaultRoute.provider,
        hint: primary?.hint || null,
        shared: !primary,
      }
      : { configured: false },
  };
}

export async function storeCredential(env, userId, apiKey, options = {}) {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed || trimmed.length < 16) {
    throw Object.assign(new Error('API key looks invalid.'), { status: 400 });
  }
  const provider = options.provider
    ? normalizeProviderId(options.provider, detectProvider(trimmed, { baseUrl: options.baseUrl }))
    : detectProvider(trimmed, { baseUrl: options.baseUrl });
  assertProviderId(provider);
  assertConfigurable(provider);
  const encrypted = await encryptApiKey(env, trimmed, { ...options, provider });
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    provider,
    key_ciphertext: toByteaHex(encrypted.ciphertext),
    key_nonce: toByteaHex(encrypted.nonce),
    key_version: encrypted.keyVersion,
    key_hint: encrypted.hint,
    validated_at: options.validated === false ? null : now,
    updated_at: now,
    base_url: options.baseUrl || null,
  };
  await supabaseRest(env, {
    path: '/rest/v1/user_ai_provider_credentials',
    method: 'POST',
    serviceRole: true,
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await saveProviderProfile(env, userId, {
    provider,
    displayName: options.displayName,
    protocol: options.protocol,
    baseUrl: options.baseUrl,
    models: options.models,
    defaultInput: options.defaultInput,
    compat: options.compat,
    retryPolicy: options.retryPolicy,
  });
  return {
    success: true,
    provider,
    hint: encrypted.hint,
    openai: { configured: true, provider, hint: encrypted.hint, validatedAt: now },
  };
}

export async function deleteProviderCredential(env, userId, provider) {
  if (provider && isProviderId(provider)) {
    await supabaseRest(env, {
      path: '/rest/v1/user_ai_provider_credentials',
      method: 'DELETE',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
    }).catch(() => null);
    await deleteProviderProfile(env, userId, provider);
    try {
      await supabaseRest(env, {
        path: '/rest/v1/user_ai_credentials',
        method: 'DELETE',
        serviceRole: true,
        query: `?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
      });
    } catch {
      // ignore
    }
  }
  return { success: true };
}

export async function loadProviderCredential(env, userId, provider) {
  const wanted = provider && isProviderId(provider) ? provider : null;
  if (!wanted) {
    throw Object.assign(new Error('Provider is required.'), { status: 400, code: 'UNKNOWN_MODEL' });
  }
  let query = `?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(wanted)}&select=key_ciphertext,key_nonce,provider,key_hint,base_url`;
  const rows = await supabaseRest(env, {
    path: '/rest/v1/user_ai_provider_credentials',
    serviceRole: true,
    query,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row) {
    const plaintext = await decryptApiKey(env, fromBytea(row.key_ciphertext), fromBytea(row.key_nonce));
    return {
      apiKey: plaintext,
      provider: row.provider,
      hint: row.key_hint,
      baseUrl: row.base_url || null,
    };
  }
  try {
    const legacy = await supabaseRest(env, {
      path: '/rest/v1/user_ai_credentials',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(wanted)}&select=key_ciphertext,key_nonce,provider,key_hint`,
    });
    const legacyRow = Array.isArray(legacy) ? legacy[0] : null;
    if (legacyRow) {
      const plaintext = await decryptApiKey(env, fromBytea(legacyRow.key_ciphertext), fromBytea(legacyRow.key_nonce));
      return {
        apiKey: plaintext,
        provider: legacyRow.provider,
        hint: legacyRow.key_hint,
        baseUrl: null,
        legacy: true,
      };
    }
  } catch {
    // ignore
  }
  throw Object.assign(new Error('No API key configured. Add one in AI & Integrations.'), {
    status: 400,
    code: 'CREDENTIALS_MISSING',
  });
}

export function selectAssistantBinding({
  userCred = null,
  subsidy = null,
  provider,
  model,
  receiverProfile = {},
  donorProfile = {},
} = {}) {
  const shared = subsidyAllowsRoute(subsidy, provider, model || '');
  if (userCred) {
    return {
      source: 'user',
      credential: { ...userCred, source: 'user' },
      profile: receiverProfile || {},
    };
  }
  if (!shared) {
    return {
      source: 'missing',
      credential: null,
      profile: receiverProfile || {},
    };
  }
  return {
    source: 'subsidy',
    credential: { source: 'subsidy' },
    profile: donorProfile || {},
  };
}

export async function resolveAssistantCredential(env, userId, provider, { model = null } = {}) {
  const binding = await resolveAssistantBinding(env, userId, provider, model);
  return binding.credential;
}

export async function resolveAssistantBinding(env, userId, provider, model, { receiverProfiles = [] } = {}) {
  const subsidy = await loadActiveSubsidy(env);
  const shared = subsidyAllowsRoute(subsidy, provider, model || '');
  let userCred = null;
  try {
    userCred = await loadProviderCredential(env, userId, provider);
  } catch (error) {
    if (error?.code !== 'CREDENTIALS_MISSING') throw error;
  }
  if (userCred && !shared) {
    return {
      source: 'user',
      credential: { ...userCred, source: 'user' },
      profile: receiverProfiles.find((row) => row.provider === provider) || {},
    };
  }
  if (userCred && shared) {
    return {
      source: 'user',
      credential: { ...userCred, source: 'user' },
      profile: receiverProfiles.find((row) => row.provider === provider) || {},
    };
  }
  if (!shared) {
    throw Object.assign(new Error('No API key configured. Add one in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  try {
    const cred = await loadProviderCredential(env, subsidy.donor_user_id, provider);
    const donorProfiles = await listProviderProfiles(env, subsidy.donor_user_id);
    const donorProfile = donorProfiles.find((row) => row.provider === provider) || {};
    return {
      source: 'subsidy',
      credential: { ...cred, source: 'subsidy', donorUserId: subsidy.donor_user_id },
      profile: donorProfile,
    };
  } catch (donorError) {
    if (donorError?.code !== 'CREDENTIALS_MISSING') throw donorError;
    throw Object.assign(new Error('The free Assistant model is temporarily unavailable.'), {
      status: 503,
      code: 'SUBSIDY_UNAVAILABLE',
    });
  }
}

export async function deleteCredential(env, userId) {
  await Promise.all([
    supabaseRest(env, {
      path: '/rest/v1/user_ai_credentials',
      method: 'DELETE',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}`,
    }).catch(() => null),
    supabaseRest(env, {
      path: '/rest/v1/user_ai_provider_credentials',
      method: 'DELETE',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}`,
    }).catch(() => null),
    supabaseRest(env, {
      path: '/rest/v1/user_ai_provider_profiles',
      method: 'DELETE',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}`,
    }).catch(() => null),
  ]);
  return { success: true };
}

export async function loadDecryptedApiKey(env, userId) {
  const settings = await loadUserAiSettings(env, userId);
  const provider = settings.assistant_provider || settings.default_provider || 'deepseek';
  return loadProviderCredential(env, userId, provider);
}

export async function validateApiKeyWithProvider(apiKey, options = {}) {
  const trimmed = String(apiKey || '').trim();
  const provider = options.provider || detectProvider(trimmed, { baseUrl: options.baseUrl });
  assertConfigurable(provider);
  const installed = catalogProvider(provider);
  if (installed) {
    const profile = options.baseUrl ? { baseUrl: options.baseUrl } : {};
    const model = availableModelId(provider, null, { profile });
    const route = resolveModelRoute(provider, model, profile);
    if (!model || !route?.supported) {
      throw Object.assign(new Error('Provider endpoint is not fully configured.'), {
        status: 400,
        code: 'PROVIDER_ENDPOINT_REQUIRED',
      });
    }
    await modelRequest({
      apiKey: trimmed,
      provider,
      baseUrl: route.baseUrl,
      model,
      modelRecord: route.model,
      protocol: route.protocol,
      compat: route.model.compat,
      extra: route.headers,
      messages: [{ role: 'user', content: 'Reply OK.' }],
      temperature: 0,
      maxTokens: 1,
      retryPolicy: { maxRetries: 0 },
    });
    return {
      success: true,
      provider,
      model,
      hint: keyHint(trimmed),
      validated: true,
      source: 'model-request',
    };
  }
  const profile = {
    baseUrl: options.baseUrl,
    protocol: options.protocol || 'openai-completions',
    models: options.models || [],
  };
  const model = profile.models.find((item) => item?.id)?.id;
  const route = resolveModelRoute(provider, model, profile);
  if (!model || !route?.supported) {
    throw Object.assign(new Error('Custom provider validation requires a model ID and HTTPS endpoint.'), {
      status: 400,
      code: 'PROVIDER_ENDPOINT_REQUIRED',
    });
  }
  await modelRequest({
    apiKey: trimmed,
    provider,
    baseUrl: route.baseUrl,
    model,
    modelRecord: route.model,
    protocol: route.protocol,
    compat: route.model.compat,
    extra: route.headers,
    messages: [{ role: 'user', content: 'Reply OK.' }],
    temperature: 0,
    maxTokens: 1,
    retryPolicy: { maxRetries: 0 },
  });
  return {
    success: true,
    provider,
    model,
    hint: keyHint(trimmed),
    validated: true,
    source: 'model-request',
  };
}

export function describeRoute(settings = {}, kind = 'assistant') {
  if (kind === 'silicon') {
    const provider = settings.silicon_provider || settings.default_provider || 'deepseek';
    const model = availableModelId(provider, settings.silicon_model, { vision: true });
    return { provider, model, reasoningEffort: settings.silicon_reasoning_effort || null };
  }
  const provider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const model = availableModelId(provider, settings.assistant_model);
  return {
    provider,
    model,
    reasoningEffort: settings.assistant_reasoning_effort || settings.reasoning_effort || null,
    record: resolveModel(provider, model),
  };
}

export { bytesToBase64, base64ToBytes };
