// Cloudflare Pages Function: POST /api/r2/upload
// Body: { key: string, data: string (base64), contentType?: string }
// Returns: { success: true, url, key } | { success: false, error }
//
// Requires:
//   - R2 bucket binding "R2_BUCKET" (Pages → Settings → Functions → R2 bindings)
//   - Env var R2_PUBLIC_URL (e.g. https://pub-xxxxx.r2.dev or your custom domain)

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    if (!env.R2_BUCKET) {
      return json(
        {
          success: false,
          error:
            'Cloudflare R2 is not configured: missing R2_BUCKET binding. In Pages → Settings → Functions → R2 bucket bindings, add binding name "R2_BUCKET" pointing at your bucket.',
        },
        { status: 503 }
      );
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

    const body = base64ToArrayBuffer(data);
    await env.R2_BUCKET.put(key, body, {
      httpMetadata: { contentType: contentType || 'image/jpeg' },
    });

    const publicBase = String(env.R2_PUBLIC_URL).replace(/\/$/, '');
    return json({ success: true, url: `${publicBase}/${key}`, key });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
