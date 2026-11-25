/**
 * Minimal Supabase REST helpers using the caller's JWT (RLS) or service role.
 */

function baseUrl(env) {
  return (env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
}

function anonKey(env) {
  return env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY;
}

/**
 * The body as text, reading at most `maxBytes` (when given). `onBytes` gets
 * the byte count of the body that was read.
 */
async function readBodyText(res, maxBytes, onBytes) {
  if (!res.body) {
    if (onBytes) onBytes(0);
    return '';
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (maxBytes && bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error(`The database reply is larger than ${maxBytes} bytes.`), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (onBytes) onBytes(bytes);
  return text;
}

export async function supabaseRest(env, {
  path,
  method = 'GET',
  accessToken,
  serviceRole = false,
  body,
  prefer,
  query = '',
  signal,
  // Optional: stop reading a reply larger than this (413 PAYLOAD_TOO_LARGE),
  // and learn how many bytes the reply had.
  maxBodyBytes = 0,
  onBodyBytes = null,
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
    signal,
  });

  const text = res.ok && (maxBodyBytes || onBodyBytes)
    ? await readBodyText(res, maxBodyBytes, onBodyBytes)
    : await res.text();
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
