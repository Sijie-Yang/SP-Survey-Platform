// Cloudflare R2 client helpers
// All operations are proxied through a backend (Express in dev, Cloudflare
// Worker in production) because R2 credentials must remain server-side.

import { supabase } from './supabase';

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (!supabase) return headers;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // ignore — unauthenticated callers may still work in local Express mode
  }
  return headers;
}

// Returns true when the R2 public URL env var is set (synchronous, safe to call anywhere)
export const isR2Configured = () => !!process.env.REACT_APP_R2_PUBLIC_URL;

export function getR2ServerUrl() {
  return SERVER_URL;
}

/** True after a network failure talking to the R2 API proxy (Express :3001 / Worker). */
let r2ProxyUnreachable = false;
let r2ProxyWarnLogged = false;

export function isR2ProxyUnreachable() {
  return r2ProxyUnreachable;
}

export function resetR2ProxyUnreachable() {
  r2ProxyUnreachable = false;
  r2ProxyWarnLogged = false;
}

function isR2ProxyNetworkError(err) {
  const msg = err?.message || String(err || '');
  return /load failed|failed to fetch|networkerror|network request failed|could not connect|econnrefused|err_connection/i.test(msg);
}

/** Soft-fail: log once when the local/prod R2 API proxy is down. */
export function noteR2ProxyFailure(err, label) {
  if (!isR2ProxyNetworkError(err)) return false;
  r2ProxyUnreachable = true;
  if (!r2ProxyWarnLogged) {
    r2ProxyWarnLogged = true;
    console.warn(
      `R2 API proxy unreachable at ${SERVER_URL || '(same origin)'} (${label}). `
      + 'Image thumbnails from public/static URLs still work; list/upload/delete need the Express server '
      + '(npm run server / port 3001) or a deployed Worker. Set REACT_APP_SERVER_URL if the API is elsewhere.',
    );
  }
  return true;
}

export function getR2PublicBase() {
  return (process.env.REACT_APP_R2_PUBLIC_URL || '').replace(/\/$/, '');
}

export function projectR2Prefix(userId, projectId) {
  if (!userId || !projectId) return '';
  return `${userId}/${projectId}/`;
}

/** Extract object key from a public R2 URL, or null. */
export function r2KeyFromUrl(url) {
  const base = getR2PublicBase();
  if (!url || !base) return null;
  const prefix = `${base}/`;
  if (!String(url).startsWith(prefix)) return null;
  return String(url).slice(prefix.length).split('?')[0];
}

export function isTemplateR2Key(key) {
  return typeof key === 'string' && key.startsWith('templates/');
}

/** True when a media entry still points at a template-owned R2 object. */
export function isTemplateOwnedMediaEntry(entry) {
  if (!entry) return false;
  if (isTemplateR2Key(entry.key)) return true;
  const fromUrl = r2KeyFromUrl(entry.url);
  return isTemplateR2Key(fromUrl);
}

/** Drop template-owned refs that must never be treated as project uploads. */
export function stripTemplateOwnedMedia(preloadedImages = []) {
  return (preloadedImages || []).filter((entry) => !isTemplateOwnedMediaEntry(entry));
}

/**
 * Only allow deletes under an explicit prefix.
 * Template keys (`templates/…`) are blocked unless allowTemplateKeys=true.
 */
export function filterDeletableR2Keys(keys, {
  allowedPrefix = null,
  allowTemplateKeys = false,
} = {}) {
  const out = [];
  const skipped = [];
  for (const raw of keys || []) {
    const key = String(raw || '').replace(/^\/+/, '');
    if (!key) continue;
    if (!allowTemplateKeys && isTemplateR2Key(key)) {
      skipped.push(key);
      continue;
    }
    if (allowedPrefix && !key.startsWith(allowedPrefix)) {
      skipped.push(key);
      continue;
    }
    out.push(key);
  }
  return { keys: [...new Set(out)], skipped: [...new Set(skipped)] };
}

// Convert a File or Blob to a base64-encoded string (without the data-URL prefix).
// Prefer arrayBuffer + btoa: Safari FileReader often surfaces a vague "Load failed".
async function toBase64(fileOrBlob) {
  if (fileOrBlob?.arrayBuffer) {
    const buf = await fileOrBlob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(reader.error?.message || 'FileReader failed'));
    reader.readAsDataURL(fileOrBlob);
  });
}

// Read the most useful error message out of a non-2xx Response without
// swallowing the actual server-side reason. The old code blanket-said
// "is the Express server running?" which masked R2/Worker errors in prod.
async function describeNonOk(res, label) {
  let detail = '';
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await res.json();
      detail = body?.error || body?.message || JSON.stringify(body).slice(0, 300);
    } else {
      detail = (await res.text()).slice(0, 300);
    }
  } catch {
    /* leave detail empty */
  }
  const hint = detail ? `: ${detail}` : '';
  return new Error(`${label} failed (HTTP ${res.status})${hint}`);
}

/**
 * Upload a File or Blob to R2 via the server proxy.
 * @param {File|Blob} file
 * @param {string} key  - object key / path inside the bucket
 * @returns {{ success: boolean, url?: string, key?: string, error?: string }}
 */
export async function uploadImageToR2(file, key) {
  if (r2ProxyUnreachable) {
    return {
      success: false,
      error: `R2 API proxy unreachable (${SERVER_URL || 'same origin'})`,
      unreachable: true,
    };
  }
  try {
    const base64 = await toBase64(file);
    const contentType = file.type || 'image/jpeg';
    const res = await fetch(`${SERVER_URL}/api/r2/upload`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key, data: base64, contentType }),
    });
    if (!res.ok) throw await describeNonOk(res, 'R2 upload');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return { success: true, url: json.url, key: json.key };
  } catch (error) {
    if (!noteR2ProxyFailure(error, 'upload')) console.error('uploadImageToR2:', error);
    return {
      success: false,
      error: error.message,
      unreachable: isR2ProxyNetworkError(error),
    };
  }
}

/**
 * Delete one or more objects from R2.
 * By default refuses `templates/…` keys so project cleanup cannot wipe template libraries.
 * Pass `{ allowTemplateKeys: true }` only for intentional template admin deletes.
 *
 * @param {string[]} keys
 * @param {{ allowTemplateKeys?: boolean, allowedPrefix?: string|null }} [options]
 */
export async function deleteImagesFromR2(keys, options = {}) {
  const { allowTemplateKeys = false, allowedPrefix = null } = options;
  if (r2ProxyUnreachable) {
    return {
      success: false,
      error: `R2 API proxy unreachable (${SERVER_URL || 'same origin'})`,
      unreachable: true,
    };
  }
  try {
    const { keys: safeKeys, skipped } = filterDeletableR2Keys(keys, {
      allowTemplateKeys,
      allowedPrefix,
    });
    if (skipped.length) {
      console.warn(
        `🛡️ Blocked R2 delete of ${skipped.length} key(s) outside allowed scope`
        + (allowTemplateKeys ? '' : ' (templates/ protected)'),
        skipped.slice(0, 5),
      );
    }
    if (!safeKeys.length) {
      return { success: true, deleted: 0, skipped: skipped.length };
    }
    const res = await fetch(`${SERVER_URL}/api/r2/delete`, {
      method: 'DELETE',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keys: safeKeys, allowTemplateKeys, allowedPrefix }),
    });
    if (!res.ok) throw await describeNonOk(res, 'R2 delete');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Delete failed');
    return { success: true, deleted: safeKeys.length, skipped: skipped.length };
  } catch (error) {
    if (!noteR2ProxyFailure(error, 'delete')) console.error('deleteImagesFromR2:', error);
    return {
      success: false,
      error: error.message,
      unreachable: isR2ProxyNetworkError(error),
    };
  }
}

/**
 * List images stored in R2 under an optional prefix.
 * @param {string} prefix - folder prefix (e.g. "userId/projectId")
 * @returns {{ success: boolean, images: Array, error?: string }}
 */
export async function listImagesFromR2(prefix = '') {
  if (r2ProxyUnreachable) {
    return {
      success: false,
      images: [],
      error: `R2 API proxy unreachable (${SERVER_URL || 'same origin'})`,
      unreachable: true,
    };
  }
  try {
    const res = await fetch(
      `${SERVER_URL}/api/r2/list?prefix=${encodeURIComponent(prefix)}`,
      { headers: await authHeaders() },
    );
    if (!res.ok) throw await describeNonOk(res, 'R2 list');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'List failed');
    return { success: true, images: json.images };
  } catch (error) {
    if (!noteR2ProxyFailure(error, 'list')) console.error('listImagesFromR2:', error);
    return {
      success: false,
      images: [],
      error: error.message,
      unreachable: isR2ProxyNetworkError(error),
    };
  }
}

async function readCopyStream(body, onProgress) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = { success: false, copied: [], errors: [] };

  const handleLine = (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.type === 'item') {
      onProgress?.(msg);
      if (msg.ok) result.copied.push({ from: msg.from, to: msg.to, url: msg.url });
      else result.errors.push({ from: msg.from, to: msg.to, error: msg.error });
    } else if (msg.type === 'done') {
      result = {
        success: msg.success,
        copied: msg.copied || result.copied,
        errors: msg.errors || result.errors,
        error: msg.error,
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handleLine);
  }
  if (buffer.trim()) handleLine(buffer);
  return result;
}

/**
 * Server-side copy of one or more R2 objects.
 * @param {Array<{from: string, to: string}>} copies
 * @param {{ onProgress?: (msg: { type: 'item', ok: boolean, finished: number, total: number }) => void }} [options]
 * @returns {{ success: boolean, copied: Array, errors: Array, error?: string }}
 */
export async function copyImagesInR2(copies, options = {}) {
  const { onProgress } = options;
  const stream = typeof onProgress === 'function';
  if (r2ProxyUnreachable) {
    return {
      success: false,
      copied: [],
      errors: [],
      error: `R2 API proxy unreachable (${SERVER_URL || 'same origin'})`,
      unreachable: true,
    };
  }
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/copy`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ copies, stream }),
    });
    if (!res.ok) throw await describeNonOk(res, 'R2 copy');
    if (stream && res.body) {
      return await readCopyStream(res.body, onProgress);
    }
    const json = await res.json();
    return {
      success: json.success,
      copied: json.copied || [],
      errors: json.errors || [],
      error: json.error,
    };
  } catch (error) {
    if (!noteR2ProxyFailure(error, 'copy')) console.error('copyImagesInR2:', error);
    return {
      success: false,
      copied: [],
      errors: [],
      error: error.message,
      unreachable: isR2ProxyNetworkError(error),
    };
  }
}

/**
 * Move R2 objects via copy + delete.
 * @param {Array<{from: string, to: string}>} moves
 */
export async function moveImagesInR2(moves, options = {}) {
  const list = (moves || []).filter((m) => m?.from && m?.to && m.from !== m.to);
  if (!list.length) return { success: true, moved: [], errors: [] };
  const copyResult = await copyImagesInR2(list, options);
  const copiedOk = (copyResult.copied || []).map((c) => c.from);
  if (copiedOk.length) {
    await deleteImagesFromR2(copiedOk, {
      allowTemplateKeys: options.allowTemplateKeys,
      allowedPrefix: options.allowedPrefix,
    });
  }
  return {
    success: copyResult.success && !(copyResult.errors || []).length,
    moved: copyResult.copied || [],
    errors: copyResult.errors || [],
    error: copyResult.error,
  };
}

/**
 * Check whether R2 is reachable from the server.
 * Returns { configured, connected, bucketName?, error? }
 */
export async function checkR2Status() {
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/status`);
    if (!res.ok) throw await describeNonOk(res, 'R2 status');
    const json = await res.json();
    if (json?.connected || json?.configured) resetR2ProxyUnreachable();
    return json;
  } catch (error) {
    noteR2ProxyFailure(error, 'status');
    return {
      configured: isR2Configured(),
      connected: false,
      error: error.message,
      unreachable: isR2ProxyNetworkError(error),
      serverUrl: SERVER_URL,
    };
  }
}
