/**
 * Validate Supabase access tokens against Auth API.
 */

export async function getUserFromBearer(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return getUserFromAccessToken(match[1], env);
}

export async function getUserFromAccessToken(accessToken, env) {
  const supabaseUrl = env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !accessToken) return null;

  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id) return null;
  return { user, accessToken };
}

export function requireUser(auth) {
  if (!auth?.user?.id) {
    const err = new Error('Authentication required');
    err.status = 401;
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  return auth;
}

export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function errorResponse(error, fallbackStatus = 500) {
  const status = error.status || fallbackStatus;
  const body = {
    success: false,
    error: error.message || 'Request failed',
    code: error.code || undefined,
  };
  if (error.details) body.details = error.details;
  if (error.validation) body.validation = error.validation;
  if (error.draftUpdatedAt) body.draftUpdatedAt = error.draftUpdatedAt;
  return jsonResponse(body, { status });
}
