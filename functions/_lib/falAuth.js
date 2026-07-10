/**
 * Resolve fal API key from request body or project config (Supabase).
 */
export async function resolveFalKey(body, env = {}) {
  if (body?.falKey) return body.falKey;
  const projectId = body?.projectId;
  if (!projectId) return null;

  const url = env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=image_dataset_config`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const cfg = rows?.[0]?.image_dataset_config || {};
    return cfg.falApiKey || null;
  } catch {
    return null;
  }
}
