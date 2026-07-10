// Cloudflare R2 client helpers
// All operations are proxied through a backend (Express in dev, Cloudflare
// Worker in production) because R2 credentials must remain server-side.

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

// Returns true when the R2 public URL env var is set (synchronous, safe to call anywhere)
export const isR2Configured = () => !!process.env.REACT_APP_R2_PUBLIC_URL;

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

// Convert a File or Blob to a base64-encoded string (without the data-URL prefix)
function toBase64(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
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
  try {
    const base64 = await toBase64(file);
    const contentType = file.type || 'image/jpeg';
    const res = await fetch(`${SERVER_URL}/api/r2/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data: base64, contentType }),
    });
    if (!res.ok) throw await describeNonOk(res, 'R2 upload');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return { success: true, url: json.url, key: json.key };
  } catch (error) {
    console.error('uploadImageToR2:', error);
    return { success: false, error: error.message };
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: safeKeys, allowTemplateKeys }),
    });
    if (!res.ok) throw await describeNonOk(res, 'R2 delete');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Delete failed');
    return { success: true, deleted: safeKeys.length, skipped: skipped.length };
  } catch (error) {
    console.error('deleteImagesFromR2:', error);
    return { success: false, error: error.message };
  }
}

/**
 * List images stored in R2 under an optional prefix.
 * @param {string} prefix - folder prefix (e.g. "userId/projectId")
 * @returns {{ success: boolean, images: Array, error?: string }}
 */
export async function listImagesFromR2(prefix = '') {
  try {
    const res = await fetch(
      `${SERVER_URL}/api/r2/list?prefix=${encodeURIComponent(prefix)}`
    );
    if (!res.ok) throw await describeNonOk(res, 'R2 list');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'List failed');
    return { success: true, images: json.images };
  } catch (error) {
    console.error('listImagesFromR2:', error);
    return { success: false, images: [], error: error.message };
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
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    console.error('copyImagesInR2:', error);
    return { success: false, copied: [], errors: [], error: error.message };
  }
}

/**
 * Check whether R2 is reachable from the server.
 * Returns { configured, connected, bucketName?, error? }
 */
export async function checkR2Status() {
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/status`);
    if (!res.ok) throw await describeNonOk(res, 'R2 status');
    return await res.json();
  } catch (error) {
    return { configured: false, connected: false, error: error.message };
  }
}
