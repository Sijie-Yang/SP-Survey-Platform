// Cloudflare Pages Function: GET /api/r2/status
// Returns: { configured, connected, bucketName?, imageCount?, error? }

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

export const onRequestGet = async ({ env }) => {
  const configured = !!env.R2_BUCKET && !!env.R2_PUBLIC_URL;
  if (!configured) {
    return json({
      configured: false,
      connected: false,
      error:
        !env.R2_BUCKET
          ? 'Missing R2_BUCKET binding. Add it in Pages → Settings → Functions → R2 bucket bindings.'
          : 'Missing R2_PUBLIC_URL environment variable.',
    });
  }

  try {
    // A light list call confirms the binding actually reaches the bucket.
    const probe = await env.R2_BUCKET.list({ limit: 1 });
    return json({
      configured: true,
      connected: true,
      bucketName: env.R2_BUCKET_NAME || undefined,
      imageCount: probe.objects?.length ?? 0,
    });
  } catch (error) {
    return json({
      configured: true,
      connected: false,
      error: error.message || String(error),
    });
  }
};
