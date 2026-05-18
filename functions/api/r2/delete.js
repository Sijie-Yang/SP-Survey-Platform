// Cloudflare Pages Function: DELETE /api/r2/delete
// Body: { keys: string[] }
// Returns: { success: true } | { success: false, error }

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

export const onRequestDelete = async ({ request, env }) => {
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

    const { keys } = await request.json();
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return json(
        { success: false, error: '"keys" array is required.' },
        { status: 400 }
      );
    }

    // R2 binding supports batch delete by passing the array directly.
    await env.R2_BUCKET.delete(keys);

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
