// Cloudflare Pages Function: GET /api/r2/list?prefix=xxx
// Returns: { success: true, images: [{ name, key, url, size, lastModified }] }

import { json, getR2Backend, r2NotConfiguredError, publicBaseUrl } from '../../_lib/r2.js';

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

export const onRequestGet = async ({ request, env }) => {
  try {
    const backend = getR2Backend(env);
    if (!backend) {
      return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
    }

    const publicBase = publicBaseUrl(env);
    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';

    const objects = await backend.list(prefix);
    const images = objects
      .filter((o) => IMAGE_RE.test(o.key))
      .map((o) => ({
        name: o.key.split('/').pop(),
        key: o.key,
        url: publicBase ? `${publicBase}/${o.key}` : '',
        size: o.size,
        lastModified: o.uploaded,
      }));

    return json({ success: true, images });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
