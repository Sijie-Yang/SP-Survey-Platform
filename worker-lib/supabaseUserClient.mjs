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
  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : anonKey(env);
  if (!key) throw Object.assign(new Error('Supabase key missing'), { status: 500 });

  const headers = {
    apikey: key,
    Authorization: `Bearer ${serviceRole ? key : accessToken}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${baseUrl(env)}${path}${query}`, {
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
