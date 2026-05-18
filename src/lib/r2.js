// Cloudflare R2 client helpers
// All operations are proxied through the local Express server (/api/r2/*)
// because R2 credentials must remain server-side.

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

// Returns true when the R2 public URL env var is set (synchronous, safe to call anywhere)
export const isR2Configured = () => !!process.env.REACT_APP_R2_PUBLIC_URL;

// Convert a File or Blob to a base64-encoded string (without the data-URL prefix)
function toBase64(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
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
    if (!res.ok) throw new Error(`API server returned ${res.status} – is the Express server running?`);
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
 * @param {string[]} keys
 */
export async function deleteImagesFromR2(keys) {
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error(`API server returned ${res.status} – is the Express server running?`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Delete failed');
    return { success: true };
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
    if (!res.ok) throw new Error(`API server returned ${res.status} – is the Express server running?`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'List failed');
    return { success: true, images: json.images };
  } catch (error) {
    console.error('listImagesFromR2:', error);
    return { success: false, images: [], error: error.message };
  }
}

/**
 * Check whether R2 is reachable from the server.
 * Returns { configured, connected, bucketName?, error? }
 */
export async function checkR2Status() {
  try {
    const res = await fetch(`${SERVER_URL}/api/r2/status`);
    if (!res.ok) throw new Error(`API server returned ${res.status} – is the Express server running?`);
    return await res.json();
  } catch (error) {
    return { configured: false, connected: false, error: error.message };
  }
}
