/**
 * AES-256-GCM helpers for per-user OpenAI/OpenRouter keys.
 * Ciphertext never leaves the Worker except stored in Supabase.
 */

function decodeKeyMaterial(raw) {
  if (!raw) throw new Error('BYOK_ENCRYPTION_KEY is not configured');
  // Accept base64 (preferred) or hex
  const trimmed = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== 32) {
    throw new Error('BYOK_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return bytes;
}

async function importKey(env) {
  const material = decodeKeyMaterial(env.BYOK_ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function keyHint(plaintext) {
  const value = String(plaintext || '');
  return value.length <= 4 ? '****' : `...${value.slice(-4)}`;
}

export function detectProvider(plaintext) {
  return String(plaintext || '').trim().startsWith('sk-or-') ? 'openrouter' : 'openai';
}

export async function encryptApiKey(env, plaintext) {
  const key = await importKey(env);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(plaintext));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoded);
  return {
    ciphertext: new Uint8Array(cipherBuf),
    nonce,
    keyVersion: Number(env.BYOK_ENCRYPTION_KEY_ID || 1),
    hint: keyHint(plaintext),
    provider: detectProvider(plaintext),
  };
}

export async function decryptApiKey(env, ciphertext, nonce) {
  const key = await importKey(env);
  const ct = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
  const iv = nonce instanceof Uint8Array ? nonce : new Uint8Array(nonce);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plainBuf);
}

export function bytesToBase64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
