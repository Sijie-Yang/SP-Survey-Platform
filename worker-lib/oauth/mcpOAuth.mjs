/**
 * OAuth 2.1 Authorization Code + PKCE for remote MCP.
 * Supabase session is used only for identity/consent; MCP tokens are opaque.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';

const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;
const CODE_TTL_SEC = 10 * 60;

const DEFAULT_SCOPES = [
  'surveys:read',
  'surveys:write',
  'surveys:publish',
  'media:write',
  'results:read',
];

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64url(digest);
}

export async function hashToken(token) {
  return sha256Base64Url(token);
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function issuerBase(request, env) {
  // Prefer explicit deploy URL; otherwise use the request origin so local
  // Express (:3001) and CRA-proxied (:3000) metadata stay consistent.
  const configured = stripTrailingSlash(env.APP_URL || '');
  if (configured) return configured;
  return stripTrailingSlash(new URL(request.url).origin);
}

/** MCP resource identifier (Codex sends this as `resource=.../mcp`). */
function mcpResourceUrl(request, env) {
  const configured = stripTrailingSlash(env.MCP_RESOURCE || '');
  if (configured) return configured;
  return `${issuerBase(request, env)}/mcp`;
}

function resourcesEquivalent(a, b) {
  const left = stripTrailingSlash(a);
  const right = stripTrailingSlash(b);
  if (!left || !right) return true;
  if (left === right) return true;
  // Accept origin and origin/mcp as the same audience during OAuth.
  return left === `${right}/mcp` || right === `${left}/mcp`;
}

export function protectedResourceMetadata(request, env) {
  const resource = mcpResourceUrl(request, env);
  const issuer = issuerBase(request, env);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: DEFAULT_SCOPES,
    bearer_methods_supported: ['header'],
  };
}

export function authorizationServerMetadata(request, env) {
  const issuer = issuerBase(request, env);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...DEFAULT_SCOPES, 'offline_access'],
    client_id_metadata_document_supported: true,
  };
}

export async function registerClient(env, body, userId = null) {
  const clientName = String(body?.client_name || 'MCP Client').slice(0, 120);
  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    throw Object.assign(new Error('redirect_uris required'), { status: 400 });
  }
  for (const uri of redirectUris) {
    let parsed;
    try {
      parsed = new URL(uri);
    } catch {
      throw Object.assign(new Error(`Invalid redirect_uri: ${uri}`), { status: 400 });
    }
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocal) {
      throw Object.assign(new Error('redirect_uri must be https or localhost'), { status: 400 });
    }
  }

  const clientId = `mcp_${randomToken(16)}`;
  await supabaseRest(env, {
    path: '/rest/v1/mcp_oauth_clients',
    method: 'POST',
    serviceRole: true,
    body: {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      created_by: userId,
      metadata: body || {},
    },
  });

  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

async function getClient(env, clientId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/mcp_oauth_clients',
    serviceRole: true,
    query: `?client_id=eq.${encodeURIComponent(clientId)}&select=*`,
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export async function createAuthorizationCode(env, {
  clientId,
  userId,
  redirectUri,
  codeChallenge,
  codeChallengeMethod = 'S256',
  scopes = DEFAULT_SCOPES,
  resource,
}) {
  const client = await getClient(env, clientId);
  if (!client) throw Object.assign(new Error('Unknown client_id'), { status: 400 });
  if (!(client.redirect_uris || []).includes(redirectUri)) {
    throw Object.assign(new Error('redirect_uri mismatch'), { status: 400 });
  }
  if (codeChallengeMethod !== 'S256') {
    throw Object.assign(new Error('Only S256 PKCE is supported'), { status: 400 });
  }

  const code = randomToken(24);
  const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/mcp_authorization_codes',
    method: 'POST',
    serviceRole: true,
    body: {
      code,
      client_id: clientId,
      user_id: userId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scopes,
      resource: resource || null,
      expires_at: expiresAt,
    },
  });
  return { code, expiresAt };
}

async function issueTokens(env, {
  userId,
  clientId,
  scopes,
  resource,
}) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const accessHash = await hashToken(accessToken);
  const refreshHash = await hashToken(refreshToken);
  const now = Date.now();
  const accessExpires = new Date(now + ACCESS_TTL_SEC * 1000).toISOString();
  const refreshExpires = new Date(now + REFRESH_TTL_SEC * 1000).toISOString();

  await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    method: 'POST',
    serviceRole: true,
    body: {
      token_hash: accessHash,
      user_id: userId,
      client_id: clientId,
      scopes,
      resource: resource || null,
      expires_at: accessExpires,
    },
  });

  await supabaseRest(env, {
    path: '/rest/v1/mcp_refresh_tokens',
    method: 'POST',
    serviceRole: true,
    body: {
      token_hash: refreshHash,
      access_token_hash: accessHash,
      user_id: userId,
      client_id: clientId,
      scopes,
      resource: resource || null,
      expires_at: refreshExpires,
    },
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    scope: (scopes || []).join(' '),
  };
}

export async function exchangeAuthorizationCode(env, body, request) {
  const {
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
    resource,
  } = body || {};

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    throw Object.assign(new Error('code, redirect_uri, client_id, code_verifier required'), { status: 400 });
  }

  const rows = await supabaseRest(env, {
    path: '/rest/v1/mcp_authorization_codes',
    serviceRole: true,
    query: `?code=eq.${encodeURIComponent(code)}&select=*`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Invalid or expired code'), { status: 400 });
  }
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    throw Object.assign(new Error('Code parameters mismatch'), { status: 400 });
  }

  const expected = await sha256Base64Url(codeVerifier);
  if (expected !== row.code_challenge) {
    throw Object.assign(new Error('PKCE verification failed'), { status: 400 });
  }

  const expectedResource = mcpResourceUrl(request, env);
  if (row.resource && resource && !resourcesEquivalent(row.resource, resource)) {
    throw Object.assign(new Error('resource mismatch'), { status: 400 });
  }
  if (resource && !resourcesEquivalent(resource, expectedResource) && !resourcesEquivalent(resource, issuerBase(request, env))) {
    throw Object.assign(new Error('resource audience mismatch'), { status: 400 });
  }

  await supabaseRest(env, {
    path: '/rest/v1/mcp_authorization_codes',
    method: 'PATCH',
    serviceRole: true,
    query: `?code=eq.${encodeURIComponent(code)}`,
    body: { used_at: new Date().toISOString() },
  });

  return issueTokens(env, {
    userId: row.user_id,
    clientId,
    scopes: row.scopes || DEFAULT_SCOPES,
    resource: row.resource || expectedResource,
  });
}

export async function refreshAccessToken(env, body, request) {
  const refreshToken = body?.refresh_token;
  const clientId = body?.client_id;
  if (!refreshToken || !clientId) {
    throw Object.assign(new Error('refresh_token and client_id required'), { status: 400 });
  }
  const refreshHash = await hashToken(refreshToken);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/mcp_refresh_tokens',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(refreshHash)}&select=*`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.revoked_at || row.client_id !== clientId || new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Invalid refresh token'), { status: 400 });
  }

  // Rotate refresh token
  await supabaseRest(env, {
    path: '/rest/v1/mcp_refresh_tokens',
    method: 'PATCH',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(refreshHash)}`,
    body: { revoked_at: new Date().toISOString() },
  });
  if (row.access_token_hash) {
    await supabaseRest(env, {
      path: '/rest/v1/mcp_access_tokens',
      method: 'PATCH',
      serviceRole: true,
      query: `?token_hash=eq.${encodeURIComponent(row.access_token_hash)}`,
      body: { revoked_at: new Date().toISOString() },
    });
  }

  return issueTokens(env, {
    userId: row.user_id,
    clientId,
    scopes: row.scopes || DEFAULT_SCOPES,
    resource: row.resource || mcpResourceUrl(request, env),
  });
}

export async function revokeToken(env, body) {
  const token = body?.token;
  if (!token) return { success: true };
  const tokenHash = await hashToken(token);
  await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    method: 'PATCH',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(tokenHash)}`,
    body: { revoked_at: new Date().toISOString() },
  });
  await supabaseRest(env, {
    path: '/rest/v1/mcp_refresh_tokens',
    method: 'PATCH',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(tokenHash)}`,
    body: { revoked_at: new Date().toISOString() },
  });
  return { success: true };
}

export async function resolveMcpAccessToken(env, accessToken) {
  if (!accessToken) return null;
  const tokenHash = await hashToken(accessToken);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(tokenHash)}&select=*`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;

  await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    method: 'PATCH',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(tokenHash)}`,
    body: { last_used_at: new Date().toISOString() },
  });

  return {
    userId: row.user_id,
    clientId: row.client_id,
    scopes: row.scopes || [],
    resource: row.resource,
    kind: 'mcp',
  };
}

export async function listUserConnections(env, userId) {
  const tokens = await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null&select=token_hash,client_id,scopes,created_at,last_used_at,expires_at&order=created_at.desc`,
  });
  const clients = await supabaseRest(env, {
    path: '/rest/v1/mcp_oauth_clients',
    serviceRole: true,
    query: '?select=client_id,client_name,created_at',
  });
  const clientMap = Object.fromEntries((clients || []).map((c) => [c.client_id, c]));
  return {
    success: true,
    connections: (tokens || []).map((t) => ({
      id: t.token_hash.slice(0, 12),
      tokenHash: t.token_hash,
      clientId: t.client_id,
      clientName: clientMap[t.client_id]?.client_name || t.client_id,
      scopes: t.scopes,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
      expiresAt: t.expires_at,
    })),
  };
}

export async function revokeConnectionByHash(env, userId, tokenHash) {
  await supabaseRest(env, {
    path: '/rest/v1/mcp_access_tokens',
    method: 'PATCH',
    serviceRole: true,
    query: `?token_hash=eq.${encodeURIComponent(tokenHash)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: { revoked_at: new Date().toISOString() },
  });
  return { success: true };
}

export { DEFAULT_SCOPES };
