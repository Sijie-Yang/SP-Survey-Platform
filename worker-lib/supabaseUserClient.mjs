/**
 * Minimal Supabase REST helpers using the caller's JWT (RLS) or service role.
 */

function baseUrl(env) {
  return (env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
}

function anonKey(env) {
  return env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY;
}

export async function supabaseRest(env, {
  path,
  method = 'GET',
  accessToken,
  serviceRole = false,
  body,
  prefer,
  query = '',
}) {
  const root = baseUrl(env);
  if (!root) {
    throw Object.assign(new Error(
      'SUPABASE_URL is missing on the Worker. Set it in wrangler.jsonc vars or as a Cloudflare Secret (plaintext dashboard vars are wiped on deploy).',
    ), { status: 500, code: 'SUPABASE_URL_MISSING' });
  }

  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : anonKey(env);
  if (!key) {
    throw Object.assign(new Error(
      serviceRole
        ? 'SUPABASE_SERVICE_ROLE_KEY is missing on the Worker (must be a Cloudflare Secret).'
        : 'SUPABASE_ANON_KEY is missing on the Worker (use a Cloudflare Secret; plaintext dashboard vars are wiped on deploy).',
    ), { status: 500, code: 'SUPABASE_KEY_MISSING' });
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${serviceRole ? key : accessToken}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${root}${path}${query}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message = data?.message || data?.error_description || data?.error || res.statusText;
    throw Object.assign(new Error(message || 'Supabase request failed'), {
      status: res.status,
      details: data,
    });
  }
  return data;
}

export async function rpc(env, fnName, args, accessToken, { serviceRole = false } = {}) {
  return supabaseRest(env, {
    path: `/rest/v1/rpc/${fnName}`,
    method: 'POST',
    accessToken,
    serviceRole,
    body: args,
  });
}
