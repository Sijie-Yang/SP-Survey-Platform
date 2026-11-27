/**
 * Short-lived signed links for moving files between an agent and the platform
 * without putting the bytes into the model's context:
 *
 *   upload    PUT  /api/mcp/upload/<token>     a page or zip, staged for sp_scheme_import
 *   download  GET  /api/mcp/download/<token>   a project's data (or one export format) as one ZIP
 *
 * A token is stateless: base64url(JSON payload) "." base64url(HMAC-SHA256).
 * The payload names the kind of link, the user (and the upload or project) and
 * the expiry. It is signed with MCP_SIGNING_SECRET when set, otherwise with a
 * key derived from SUPABASE_SERVICE_ROLE_KEY and a fixed label. Neither secret
 * ever leaves the Worker. Verification uses crypto.subtle.verify, which
 * compares in constant time.
 */

export const UPLOAD_TOKEN_TTL_SECONDS = 30 * 60;
export const DOWNLOAD_TOKEN_TTL_SECONDS = 15 * 60;
export const UPLOAD_PATH_PREFIX = '/api/mcp/upload/';
export const DOWNLOAD_PATH_PREFIX = '/api/mcp/download/';

const KEY_LABEL = 'sp-survey:mcp-transfer-link:v1';
const KINDS = new Set(['upload', 'download']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TOKEN_LENGTH = 2048;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('bad encoding');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function tokenError(message, status = 401, code = 'INVALID_LINK') {
  return Object.assign(new Error(message), { status, code });
}

async function signingKey(env) {
  const explicit = String(env?.MCP_SIGNING_SECRET || '');
  let raw;
  if (explicit) {
    raw = encoder.encode(explicit);
  } else {
    const base = String(env?.SUPABASE_SERVICE_ROLE_KEY || '');
    if (!base) {
      throw tokenError('Signed links are not configured on this server (MCP_SIGNING_SECRET or SUPABASE_SERVICE_ROLE_KEY is missing).', 503, 'SIGNING_NOT_CONFIGURED');
    }
    // Derive a separate key so the service role key itself never signs anything.
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode(base), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    raw = new Uint8Array(await crypto.subtle.sign('HMAC', baseKey, encoder.encode(KEY_LABEL)));
  }
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** True for ids that are safe inside an R2 key or a token (no slashes, no dots). */
export function isSafeTransferId(value) {
  return ID_RE.test(String(value || ''));
}

/**
 * @param {object} env
 * @param {{ kind: 'upload'|'download', userId: string, uploadId?: string, projectId?: string, includePractice?: boolean, exportSpec?: { f: string, s: object } }} claims
 * @param {number} ttlSeconds
 * @param {number} [now] ms, for tests
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function signTransferToken(env, claims, ttlSeconds, now = Date.now()) {
  if (!KINDS.has(claims?.kind)) throw tokenError('Unknown link kind.', 500, 'BAD_LINK_KIND');
  if (!isSafeTransferId(claims.userId)) throw tokenError('Invalid user.', 400, 'BAD_USER');
  const exp = Math.floor(now / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const payload = { k: claims.kind, u: claims.userId, exp };
  if (claims.kind === 'upload') {
    if (!isSafeTransferId(claims.uploadId)) throw tokenError('Invalid upload id.', 400, 'BAD_UPLOAD_ID');
    payload.id = claims.uploadId;
  } else {
    if (!isSafeTransferId(claims.projectId)) throw tokenError('Invalid project id.', 400, 'INVALID_PROJECT_ID');
    payload.p = claims.projectId;
    if (claims.includePractice) payload.x = 1;
    // An export download names its format and filters (checked again when redeemed).
    if (claims.exportSpec) payload.e = claims.exportSpec;
  }
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(body)));
  return { token: `${body}.${b64urlEncode(sig)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Check a token's signature, kind and expiry.
 * @returns {Promise<{ kind, userId, uploadId?, projectId?, includePractice?, expiresAt }>}
 * @throws Error with status 401 (bad or expired link) or 503 (signing not configured)
 */
export async function verifyTransferToken(env, token, expectedKind, now = Date.now()) {
  const text = String(token || '');
  if (!text || text.length > MAX_TOKEN_LENGTH) throw tokenError('This link is not valid.');
  const parts = text.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw tokenError('This link is not valid.');
  let sig;
  try {
    sig = b64urlDecode(parts[1]);
  } catch {
    throw tokenError('This link is not valid.');
  }
  const key = await signingKey(env);
  const ok = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(parts[0]));
  if (!ok) throw tokenError('This link is not valid.');
  let payload;
  try {
    payload = JSON.parse(decoder.decode(b64urlDecode(parts[0])));
  } catch {
    throw tokenError('This link is not valid.');
  }
  if (!payload || payload.k !== expectedKind || !isSafeTransferId(payload.u) || !Number.isFinite(payload.exp)) {
    throw tokenError('This link is not valid.');
  }
  if (payload.exp * 1000 <= now) {
    throw tokenError(expectedKind === 'upload'
      ? 'This upload link has expired. Call sp_scheme_upload_url for a new one.'
      : 'This download link has expired. Call survey_download_url for a new one.', 401, 'LINK_EXPIRED');
  }
  const out = { kind: payload.k, userId: payload.u, expiresAt: new Date(payload.exp * 1000).toISOString() };
  if (expectedKind === 'upload') {
    if (!isSafeTransferId(payload.id)) throw tokenError('This link is not valid.');
    out.uploadId = payload.id;
  } else {
    if (!isSafeTransferId(payload.p)) throw tokenError('This link is not valid.');
    out.projectId = payload.p;
    out.includePractice = payload.x === 1;
    if (payload.e && typeof payload.e === 'object' && !Array.isArray(payload.e)) out.exportSpec = payload.e;
  }
  return out;
}

/** Where a staged upload lives in R2. Both parts are checked, so the key cannot leave the user's staging folder. */
export function stagingKey(userId, uploadId) {
  if (!isSafeTransferId(userId) || !isSafeTransferId(uploadId)) {
    throw tokenError('Invalid upload id.', 400, 'BAD_UPLOAD_ID');
  }
  return `_mcp-staging/${userId}/${uploadId}`;
}

export function stagingPrefix(userId) {
  if (!isSafeTransferId(userId)) throw tokenError('Invalid user.', 400, 'BAD_USER');
  return `_mcp-staging/${userId}/`;
}
