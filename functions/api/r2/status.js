// Cloudflare Pages Function: GET /api/r2/status
// Returns: { configured, connected, bucketName?, mode?, error? }

import { json, getR2Backend, r2NotConfiguredError, publicBaseUrl } from '../../_lib/r2.js';

export const onRequestGet = async ({ env }) => {
  const backend = getR2Backend(env);
  const configured = !!backend && !!publicBaseUrl(env);
  if (!configured) {
    return json({
      configured: false,
      connected: false,
      error: !backend ? r2NotConfiguredError(env) : 'Missing R2_PUBLIC_URL environment variable.',
    });
  }

  try {
    await backend.probe();
    return json({
      configured: true,
      connected: true,
      mode: backend.kind,
      bucketName: backend.bucketName || env.R2_BUCKET_NAME || undefined,
    });
  } catch (error) {
    return json({
      configured: true,
      connected: false,
      mode: backend.kind,
      error: error.message || String(error),
    });
  }
};
