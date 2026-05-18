// Cloudflare Pages Function: DELETE /api/r2/delete
// Body: { keys: string[] }
// Returns: { success: true } | { success: false, error }

import { json, getR2Backend, r2NotConfiguredError } from '../../_lib/r2.js';

export const onRequestDelete = async ({ request, env }) => {
  try {
    const backend = getR2Backend(env);
    if (!backend) {
      return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
    }

    const { keys } = await request.json();
    if (!Array.isArray(keys) || keys.length === 0) {
      return json(
        { success: false, error: '"keys" array is required.' },
        { status: 400 }
      );
    }

    await backend.delete(keys);
    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
