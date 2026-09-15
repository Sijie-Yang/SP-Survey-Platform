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
import { CATALOG_VERSION, isProviderId } from './runtime/catalog.mjs';
import { buildDirectory, publicCatalog, resolveModel, resolveProvider } from './runtime/registry.mjs';
import { assertConfigurable, assertProviderId, assertRoute } from './runtime/validators.mjs';
import { assertSafeBaseUrl } from './runtime/ssrf.mjs';

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
  const existing = (await listProviderProfiles(env, userId))
    .find((row) => row.provider === profile.provider) || {};
  const now = new Date().toISOString();
  const body = {
    user_id: userId,
    provider: profile.provider,
    display_name: profile.displayName ?? profile.display_name ?? existing.display_name ?? null,
    protocol: profile.protocol || existing.protocol || 'openai-completions',
    base_url: profile.baseUrl ?? profile.base_url ?? existing.base_url ?? null,
    default_input: profile.defaultInput || profile.default_input || existing.default_input || ['text'],
    compat: profile.compat || existing.compat || {},
    retry_policy: profile.retryPolicy || profile.retry_policy || existing.retry_policy || {},
    models: profile.models !== undefined ? profile.models : (existing.models || []),
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
  if (body.assistant_model && (body.assistant_provider || current.assistant_provider || body.default_provider)) {
    const providerId = body.assistant_provider || current.assistant_provider || body.default_provider;
    assertRoute({
      provider: providerId,
      model: body.assistant_model,
      profile,
      effort: body.assistant_reasoning_effort || body.reasoning_effort,
      requireConfigured: true,
      credential: credentials.find((row) => row.provider === providerId),
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
  const directory = buildDirectory({ profiles, credentials });
  const configuredProviders = directory.filter((item) => item.configured);
  const assistantProvider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const siliconProvider = settings.silicon_provider || settings.default_provider || 'deepseek';
  const defaultRoute = {
    provider: assistantProvider,
    model: settings.assistant_model || resolveProvider(assistantProvider).defaultModels.assistant,
    reasoningEffort: settings.assistant_reasoning_effort || settings.reasoning_effort || null,
  };
  const siliconRoute = {
    provider: siliconProvider,
    model: settings.silicon_model || resolveProvider(siliconProvider).defaultModels.silicon,
    reasoningEffort: settings.silicon_reasoning_effort || null,
  };
  const primary = configuredProviders.find((p) => p.id === assistantProvider) || configuredProviders[0] || null;
  return {
    success: true,
    catalogVersion: CATALOG_VERSION,
    catalog: publicCatalog(),
    directory,
    configuredProviders,
    defaultRoute,
    siliconRoute,
    providers: credentials,
    settings,
    openai: primary
      ? {
        configured: true,
        provider: primary.id,
        hint: primary.hint,
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
    validated_at: now,
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
  const resolved = resolveProvider(provider, { baseUrl: options.baseUrl });
  const base = assertSafeBaseUrl(options.baseUrl || resolved.baseUrl || resolved.defaultBaseUrl);
  const headers = { Authorization: `Bearer ${trimmed}` };
  if (provider === 'anthropic') {
    headers['x-api-key'] = trimmed;
    headers['anthropic-version'] = '2023-06-01';
    delete headers.Authorization;
  }
  const res = await fetch(`${String(base).replace(/\/$/, '')}${provider === 'anthropic' ? '/v1/models' : '/models'}`, {
    headers,
    redirect: 'error',
  });
  if (!res.ok) {
    throw Object.assign(new Error('API key validation failed.'), { status: 400, code: 'MISSING_CREDENTIAL' });
  }
  return { success: true, provider, hint: keyHint(trimmed) };
}

export function describeRoute(settings = {}, kind = 'assistant') {
  if (kind === 'silicon') {
    const provider = settings.silicon_provider || settings.default_provider || 'deepseek';
    const model = settings.silicon_model || resolveProvider(provider).defaultModels.silicon;
    return { provider, model, reasoningEffort: settings.silicon_reasoning_effort || null };
  }
  const provider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const model = settings.assistant_model || resolveProvider(provider).defaultModels.assistant;
  return {
    provider,
    model,
    reasoningEffort: settings.assistant_reasoning_effort || settings.reasoning_effort || null,
    record: resolveModel(provider, model),
  };
}

export { bytesToBase64, base64ToBytes };
