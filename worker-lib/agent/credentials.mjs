/**
 * Encrypted BYOK credential storage (Worker-only decrypt).
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
      for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    return base64ToBytes(value);
  }
  return new Uint8Array(value);
}

export async function getCredentialStatus(env, userId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/user_ai_credentials',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=provider,key_hint,validated_at,updated_at`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { success: true, openai: { configured: false } };
  }
  return {
    success: true,
    openai: {
      configured: true,
      provider: row.provider,
      hint: row.key_hint,
      validatedAt: row.validated_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function storeCredential(env, userId, apiKey) {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed || trimmed.length < 16) {
    throw Object.assign(new Error('API key looks invalid.'), { status: 400 });
  }
  const encrypted = await encryptApiKey(env, trimmed);
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    provider: encrypted.provider,
    key_ciphertext: toByteaHex(encrypted.ciphertext),
    key_nonce: toByteaHex(encrypted.nonce),
    key_version: encrypted.keyVersion,
    key_hint: encrypted.hint,
    validated_at: now,
    updated_at: now,
  };

  await supabaseRest(env, {
    path: '/rest/v1/user_ai_credentials',
    method: 'POST',
    serviceRole: true,
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });

  return {
    success: true,
    openai: {
      configured: true,
      provider: encrypted.provider,
      hint: encrypted.hint,
      validatedAt: now,
    },
  };
}

export async function deleteCredential(env, userId) {
  await supabaseRest(env, {
    path: '/rest/v1/user_ai_credentials',
    method: 'DELETE',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}`,
  });
  return { success: true };
}

export async function loadDecryptedApiKey(env, userId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/user_ai_credentials',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=key_ciphertext,key_nonce,provider,key_hint`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw Object.assign(new Error('No API key configured. Add one in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  const plaintext = await decryptApiKey(
    env,
    fromBytea(row.key_ciphertext),
    fromBytea(row.key_nonce),
  );
  return {
    apiKey: plaintext,
    provider: row.provider || detectProvider(plaintext),
    hint: row.key_hint || keyHint(plaintext),
  };
}

/** Validate a key by calling the provider models endpoint. */
export async function validateApiKeyWithProvider(apiKey) {
  const trimmed = String(apiKey || '').trim();
  const isOpenRouter = trimmed.startsWith('sk-or-');
  const url = isOpenRouter
    ? 'https://openrouter.ai/api/v1/models'
    : 'https://api.openai.com/v1/models';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${trimmed}` },
  });
  if (!res.ok) {
    throw Object.assign(new Error('API key validation failed.'), { status: 400 });
  }
  return {
    success: true,
    provider: isOpenRouter ? 'openrouter' : 'openai',
    hint: keyHint(trimmed),
  };
}

export { bytesToBase64, base64ToBytes };
