// Cloudflare Pages Function: DELETE /api/r2/delete
// Body: { keys: string[], allowTemplateKeys?: boolean, allowedPrefix?: string|null }
// Returns: { success: true, deleted, blocked } | { success: false, error }

import {
  json,
  getR2Backend,
  r2NotConfiguredError,
  filterDeletableR2Keys,
} from '../../_lib/r2.js';

export const onRequestDelete = async ({ request, env }) => {
  try {
    const backend = getR2Backend(env);
    if (!backend) {
      return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
    }

    const body = await request.json();
    const { keys, allowTemplateKeys = false, allowedPrefix = null } = body || {};
    if (!Array.isArray(keys) || keys.length === 0) {
      return json(
        { success: false, error: '"keys" array is required.' },
        { status: 400 }
      );
    }

    const { keys: safeKeys, skipped } = filterDeletableR2Keys(keys, {
      allowTemplateKeys,
      allowedPrefix,
    });
    if (skipped.length) {
      console.warn(
        `R2 delete blocked ${skipped.length} key(s) outside allowed scope`
        + (allowTemplateKeys ? '' : ' (templates/ protected)'),
        skipped.slice(0, 5),
      );
    }
    if (!safeKeys.length) {
      return json({ success: true, deleted: 0, blocked: skipped.length });
    }

    await backend.delete(safeKeys);
    return json({ success: true, deleted: safeKeys.length, blocked: skipped.length });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};
