// Cloudflare Pages Function: POST /api/r2/upload
// Body: { key: string, data: string (base64), contentType?: string }
// Returns: { success: true, url, key } | { success: false, error }

import {
  json,
  base64ToArrayBuffer,
  getR2Backend,
  r2NotConfiguredError,
  publicBaseUrl,
} from '../../_lib/r2.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const backend = getR2Backend(env);
    if (!backend) {
      return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
    }
    if (!env.R2_PUBLIC_URL) {
      return json(
        { success: false, error: 'Missing R2_PUBLIC_URL environment variable.' },
        { status: 503 }
      );
    }

    const { key, data, contentType } = await request.json();
    if (!key || !data) {
      return json(
        { success: false, error: '"key" and "data" fields are required.' },
        { status: 400 }
      );
    }

    await backend.put(key, base64ToArrayBuffer(data), contentType || 'image/jpeg');

    return json({ success: true, url: `${publicBaseUrl(env)}/${key}`, key });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
