// Cloudflare Pages Function: GET /api/r2/list?prefix=xxx
// Returns: { success: true, images: [{ name, key, url, size, lastModified }] }
//
// Requires:
//   - R2 bucket binding "R2_BUCKET"
//   - Env var R2_PUBLIC_URL

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

export const onRequestGet = async ({ request, env }) => {
  try {
    if (!env.R2_BUCKET) {
      return json(
        {
          success: false,
          error:
            'Cloudflare R2 is not configured: missing R2_BUCKET binding. Add it in Pages → Settings → Functions → R2 bucket bindings.',
        },
        { status: 503 }
      );
    }

    const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';

    // Walk through all pages so callers see every object under the prefix.
    let cursor = undefined;
    const objects = [];
    do {
      const page = await env.R2_BUCKET.list({ prefix, limit: 1000, cursor });
      objects.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const images = objects
      .filter((obj) => IMAGE_RE.test(obj.key))
      .map((obj) => ({
        name: obj.key.split('/').pop(),
        key: obj.key,
        url: publicBase ? `${publicBase}/${obj.key}` : '',
        size: obj.size,
        lastModified: obj.uploaded,
      }));

    return json({ success: true, images });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
