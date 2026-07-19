/**
 * Route /api/agent/* and OAuth/MCP discovery endpoints.
 */

import {
  getUserFromAccessToken,
  getUserFromBearer,
  jsonResponse,
  errorResponse,
} from '../auth/supabaseJwt.mjs';
import {
  deleteCredential,
  getCredentialStatus,
  storeCredential,
  validateApiKeyWithProvider,
} from './credentials.mjs';
import { handleAgentChat } from './chatHandler.mjs';
import {
  acquireLease,
  applyProjectOperations,
  createProject,
  deleteProject,
  getDraft,
  handleAgentDiscovery,
  listProjects,
  listVersions,
  previewUrls,
  publishProject,
  releaseLease,
  rollbackProject,
  saveDraft,
  updateProjectMeta,
  validateProject,
} from './projectHandlers.mjs';
import {
  applyMainPage,
  createFromTemplate,
  deleteProjectMedia,
  duplicateProject,
  exportProject,
  getMediaDataset,
  getTemplate,
  importMediaFromTemplate,
  importProject,
  listProjectMedia,
  listTemplates,
  saveAsTemplate,
  updateMediaDataset,
  uploadProjectMedia,
} from './projectLifecycle.mjs';
import {
  deleteResponse,
  exportResponses,
  listResponses,
  summarizeResponses,
} from './resultsHandlers.mjs';
import {
  getSkill,
  listSkills,
  saveSkill,
} from './skillHandlers.mjs';
import {
  authorizationServerMetadata,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  listUserConnections,
  protectedResourceMetadata,
  refreshAccessToken,
  registerClient,
  resolveMcpAccessToken,
  revokeConnectionByHash,
  revokeToken,
  DEFAULT_SCOPES,
} from '../oauth/mcpOAuth.mjs';
import { handleMcpRequest } from '../mcp/server.mjs';

/** OAuth token/revoke bodies are usually form-urlencoded (RFC 6749), not JSON. */
async function parseOAuthBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await request.json().catch(() => ({}));
  }
  const text = await request.text();
  if (!text) return {};
  if (contentType.includes('application/x-www-form-urlencoded') || text.includes('=')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function resolveAuth(request, env, { allowMcp = false } = {}) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];

  const supabaseUser = await getUserFromAccessToken(token, env);
  if (supabaseUser) {
    return {
      kind: 'supabase',
      userId: supabaseUser.user.id,
      user: supabaseUser.user,
      accessToken: token,
      scopes: DEFAULT_SCOPES,
    };
  }

  if (allowMcp) {
    const mcp = await resolveMcpAccessToken(env, token);
    if (mcp) {
      return {
        kind: 'mcp',
        userId: mcp.userId,
        scopes: mcp.scopes,
        clientId: mcp.clientId,
        resource: mcp.resource,
      };
    }
  }
  return null;
}

function unauthorized(request, env) {
  const issuer = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  return new Response(JSON.stringify({
    success: false,
    error: 'Authentication required',
    code: 'UNAUTHENTICATED',
  }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'WWW-Authenticate': `Bearer realm="sp-survey", resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    },
  });
}

export async function handleAgentAndMcpRoutes(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Discovery
  if (pathname === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
    return jsonResponse(protectedResourceMetadata(request, env));
  }
  if (
    (pathname === '/.well-known/oauth-authorization-server'
      || pathname === '/.well-known/openid-configuration')
    && request.method === 'GET'
  ) {
    return jsonResponse(authorizationServerMetadata(request, env));
  }

  // OAuth endpoints
  if (pathname === '/oauth/register' && request.method === 'POST') {
    try {
      const body = await request.json();
      const auth = await getUserFromBearer(request, env);
      const result = await registerClient(env, body, auth?.user?.id || null);
      return jsonResponse(result, { status: 201 });
    } catch (error) {
      const msg = String(error.message || '');
      if (msg.includes('mcp_oauth_clients') || error.details?.code === 'PGRST205') {
        return errorResponse(Object.assign(new Error(
          'OAuth tables are missing. Run supabase/agent_mcp_platform.sql in your Supabase SQL editor, then retry codex mcp login.',
        ), { status: 503, code: 'MIGRATION_REQUIRED' }), 503);
      }
      return errorResponse(error, error.status || 400);
    }
  }

  if (pathname === '/oauth/authorize' && request.method === 'GET') {
    // Consent UI lives in the React SPA (CRA :3000 / production origin),
    // not on the API host (:3001 Worker/Express). Prefer APP_URL.
    const spaOrigin = (env.APP_URL || env.MCP_RESOURCE || url.origin).replace(/\/$/, '');
    const consent = new URL('/oauth/mcp', spaOrigin);
    url.searchParams.forEach((value, key) => consent.searchParams.set(key, value));
    return Response.redirect(consent.toString(), 302);
  }

  if (pathname === '/oauth/approve' && request.method === 'POST') {
    try {
      const auth = await getUserFromBearer(request, env);
      if (!auth) return unauthorized(request, env);
      const body = await request.json();
      const scopes = Array.isArray(body.scopes) && body.scopes.length
        ? body.scopes
        : DEFAULT_SCOPES;
      const { code, expiresAt } = await createAuthorizationCode(env, {
        clientId: body.client_id,
        userId: auth.user.id,
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method || 'S256',
        scopes,
        resource: body.resource || null,
      });
      return jsonResponse({ success: true, code, expiresAt });
    } catch (error) {
      return errorResponse(error, 400);
    }
  }

  if (pathname === '/oauth/token' && request.method === 'POST') {
    try {
      const body = await parseOAuthBody(request);
      if (body.grant_type === 'refresh_token') {
        return jsonResponse(await refreshAccessToken(env, body, request));
      }
      return jsonResponse(await exchangeAuthorizationCode(env, body, request));
    } catch (error) {
      return errorResponse(error, 400);
    }
  }

  if (pathname === '/oauth/revoke' && request.method === 'POST') {
    try {
      const body = await parseOAuthBody(request);
      return jsonResponse(await revokeToken(env, body));
    } catch (error) {
      return errorResponse(error, 400);
    }
  }

  // MCP
  if (pathname === '/mcp') {
    const auth = await resolveAuth(request, env, { allowMcp: true });
    if (!auth) return unauthorized(request, env);
    return handleMcpRequest(request, env, auth);
  }

  // Agent API
  if (!pathname.startsWith('/api/agent')) return null;

  if (pathname === '/api/agent' && request.method === 'GET') {
    return jsonResponse(await handleAgentDiscovery(request, env));
  }

  const auth = await resolveAuth(request, env, { allowMcp: true });
  if (!auth) return unauthorized(request, env);

  try {
    // Credentials
    if (pathname === '/api/agent/credentials/status' && request.method === 'GET') {
      return jsonResponse(await getCredentialStatus(env, auth.userId));
    }
    if (pathname === '/api/agent/credentials/openai' && request.method === 'POST') {
      if (auth.kind !== 'supabase') {
        return errorResponse(Object.assign(new Error('Store credentials via browser session'), { status: 403 }));
      }
      const body = await request.json();
      if (body?.validateOnly && body?.apiKey) {
        const validated = await validateApiKeyWithProvider(body.apiKey);
        return jsonResponse(validated);
      }
      if (!body?.apiKey) {
        return errorResponse(Object.assign(new Error('apiKey required'), { status: 400 }));
      }
      await validateApiKeyWithProvider(body.apiKey);
      return jsonResponse(await storeCredential(env, auth.userId, body.apiKey));
    }
    if (pathname === '/api/agent/credentials/openai' && request.method === 'DELETE') {
      if (auth.kind !== 'supabase') {
        return errorResponse(Object.assign(new Error('Revoke credentials via browser session'), { status: 403 }));
      }
      return jsonResponse(await deleteCredential(env, auth.userId));
    }

    // Connections (Integrations UI)
    if (pathname === '/api/agent/connections' && request.method === 'GET') {
      if (auth.kind !== 'supabase') {
        return errorResponse(Object.assign(new Error('Forbidden'), { status: 403 }));
      }
      return jsonResponse(await listUserConnections(env, auth.userId));
    }
    if (pathname.startsWith('/api/agent/connections/') && request.method === 'DELETE') {
      if (auth.kind !== 'supabase') {
        return errorResponse(Object.assign(new Error('Forbidden'), { status: 403 }));
      }
      const tokenHash = decodeURIComponent(pathname.slice('/api/agent/connections/'.length));
      return jsonResponse(await revokeConnectionByHash(env, auth.userId, tokenHash));
    }

    // Chat (browser assistant — requires stored BYOK)
    if (pathname === '/api/agent/chat' && request.method === 'POST') {
      if (auth.kind !== 'supabase') {
        return errorResponse(Object.assign(new Error('Chat requires browser session'), { status: 403 }));
      }
      const body = await request.json();
      // Reject apiKey in body for production path
      if (body?.apiKey) {
        return errorResponse(Object.assign(new Error('Do not send apiKey in body. Store it via /api/agent/credentials/openai'), { status: 400 }));
      }
      return jsonResponse(await handleAgentChat(env, auth.userId, body));
    }

    // Projects
    if (pathname === '/api/agent/projects' && request.method === 'GET') {
      if (auth.kind === 'mcp') {
        // Use MCP tool path semantics via service-filtered list
        const { default: unused } = { default: null };
        void unused;
      }
      if (!auth.accessToken) {
        // MCP opaque — list via service role filtered in a thin call
        const { supabaseRest } = await import('../supabaseUserClient.mjs');
        const rows = await supabaseRest(env, {
          path: '/rest/v1/projects',
          serviceRole: true,
          query: `?user_id=eq.${encodeURIComponent(auth.userId)}&select=id,name,description,updated_at,draft_updated_at,published_at,published_version,last_writer&order=updated_at.desc`,
        });
        return jsonResponse({
          success: true,
          projects: (rows || []).map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description || '',
            updatedAt: row.updated_at,
            draftUpdatedAt: row.draft_updated_at,
            publishedAt: row.published_at,
            publishedVersion: row.published_version || 0,
            lastWriter: row.last_writer || null,
          })),
        });
      }
      return jsonResponse(await listProjects(env, auth.accessToken));
    }

    if (pathname === '/api/agent/projects' && request.method === 'POST') {
      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Creating projects via MCP opaque token: use MCP tool survey_create_project'), { status: 400 }));
      }
      const body = await request.json();
      return jsonResponse(await createProject(env, auth.accessToken, auth.userId, body, request), { status: 201 });
    }

    if (pathname === '/api/agent/projects/import' && request.method === 'POST') {
      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Use MCP tools for opaque MCP tokens'), { status: 400 }));
      }
      const body = await request.json();
      return jsonResponse(await importProject(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
      }, body, request), { status: 201 });
    }

    if (pathname === '/api/agent/projects/from-template' && request.method === 'POST') {
      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Use MCP tools for opaque MCP tokens'), { status: 400 }));
      }
      const body = await request.json();
      return jsonResponse(await createFromTemplate(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
      }, body, request), { status: 201 });
    }

    if (pathname === '/api/agent/skills' && request.method === 'GET') {
      return jsonResponse(await listSkills(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
        serviceRole: !auth.accessToken,
      }));
    }
    if (pathname === '/api/agent/skills' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.confirm) {
        return errorResponse(Object.assign(new Error('Set confirm:true to save a skill.'), { status: 400 }));
      }
      return jsonResponse(await saveSkill(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
        serviceRole: true,
      }, body), { status: 201 });
    }
    const skillMatch = pathname.match(/^\/api\/agent\/skills\/([^/]+)$/);
    if (skillMatch && request.method === 'GET') {
      return jsonResponse(await getSkill(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
        serviceRole: true,
      }, decodeURIComponent(skillMatch[1])));
    }

    if (pathname === '/api/agent/templates' && request.method === 'GET') {
      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Use MCP tools for opaque MCP tokens'), { status: 400 }));
      }
      return jsonResponse(await listTemplates(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
      }));
    }

    const templateMatch = pathname.match(/^\/api\/agent\/templates\/([^/]+)$/);
    if (templateMatch && request.method === 'GET') {
      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Use MCP tools for opaque MCP tokens'), { status: 400 }));
      }
      return jsonResponse(await getTemplate(env, {
        accessToken: auth.accessToken,
        userId: auth.userId,
      }, decodeURIComponent(templateMatch[1])));
    }

    const projectMatch = pathname.match(/^\/api\/agent\/projects\/([^/]+)(?:\/(.*))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const action = projectMatch[2] || '';

      if (!auth.accessToken) {
        return errorResponse(Object.assign(new Error('Use MCP /mcp tools for opaque MCP tokens'), { status: 400 }));
      }

      const jwtCtx = { accessToken: auth.accessToken, userId: auth.userId, serviceRole: false };

      if (!action && request.method === 'PATCH') {
        const body = await request.json();
        return jsonResponse(await updateProjectMeta(env, auth.accessToken, projectId, body, auth.userId));
      }
      if (!action && request.method === 'DELETE') {
        return jsonResponse(await deleteProject(env, auth.accessToken, projectId, auth.userId));
      }
      if (action === 'duplicate' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await duplicateProject(env, jwtCtx, projectId, body, request), { status: 201 });
      }
      if (action === 'export' && request.method === 'GET') {
        return jsonResponse(await exportProject(env, jwtCtx, projectId));
      }
      if (action === 'save-as-template' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.confirm) {
          return errorResponse(Object.assign(new Error('Set confirm:true to submit as template.'), { status: 400 }));
        }
        return jsonResponse(await saveAsTemplate(env, jwtCtx, projectId, body));
      }
      if (action === 'main-page' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.confirm) {
          return errorResponse(Object.assign(new Error('Set confirm:true to apply to Main Page.'), { status: 400 }));
        }
        return jsonResponse(await applyMainPage(env, jwtCtx, projectId, body));
      }
      if (action === 'media' && request.method === 'GET') {
        return jsonResponse(await listProjectMedia(env, jwtCtx, projectId));
      }
      if (action === 'media/import-template' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (!body.confirm) {
          return errorResponse(Object.assign(new Error('Set confirm:true to import template media.'), { status: 400 }));
        }
        return jsonResponse(await importMediaFromTemplate(env, jwtCtx, projectId, body));
      }
      if (action === 'media' && request.method === 'DELETE') {
        const body = await request.json().catch(() => ({}));
        if (!body.confirm) {
          return errorResponse(Object.assign(new Error('Set confirm:true to delete media.'), { status: 400 }));
        }
        return jsonResponse(await deleteProjectMedia(env, jwtCtx, projectId, body));
      }
      if (action === 'media/upload' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await uploadProjectMedia(env, jwtCtx, projectId, body), { status: 201 });
      }
      if (action === 'media-dataset' && request.method === 'GET') {
        return jsonResponse(await getMediaDataset(env, jwtCtx, projectId));
      }
      if (action === 'media-dataset' && request.method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await updateMediaDataset(env, jwtCtx, projectId, body));
      }
      if (action === 'responses' && request.method === 'GET') {
        const url = new URL(request.url);
        const filters = {
          includePractice: url.searchParams.get('includePractice') === 'true',
          includeAnswers: url.searchParams.get('includeAnswers') === 'true',
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          sessionId: url.searchParams.get('sessionId') || undefined,
          limit: url.searchParams.get('limit') || undefined,
          offset: url.searchParams.get('offset') || undefined,
        };
        return jsonResponse(await listResponses(env, jwtCtx, projectId, filters));
      }
      if (action === 'responses/export' && request.method === 'GET') {
        const url = new URL(request.url);
        const filters = {
          format: url.searchParams.get('format') || 'json',
          includePractice: url.searchParams.get('includePractice') === 'true',
          excludeFlagged: url.searchParams.get('excludeFlagged') === 'true',
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          sessionId: url.searchParams.get('sessionId') || undefined,
        };
        return jsonResponse(await exportResponses(env, jwtCtx, projectId, filters));
      }
      if (action === 'results/summary' && request.method === 'GET') {
        const url = new URL(request.url);
        const filters = {
          includePractice: url.searchParams.get('includePractice') === 'true',
          excludeFlagged: url.searchParams.get('excludeFlagged') === 'true',
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          sessionId: url.searchParams.get('sessionId') || undefined,
        };
        return jsonResponse(await summarizeResponses(env, jwtCtx, projectId, filters));
      }
      if (action === 'responses' && request.method === 'DELETE') {
        const body = await request.json().catch(() => ({}));
        if (!body.confirm) {
          return errorResponse(Object.assign(new Error('Set confirm:true to delete a response.'), { status: 400 }));
        }
        return jsonResponse(await deleteResponse(env, jwtCtx, projectId, body));
      }
      if (action === 'draft' && request.method === 'GET') {
        return jsonResponse(await getDraft(env, auth.accessToken, projectId, request));
      }
      if (action === 'draft' && request.method === 'PUT') {
        const body = await request.json();
        const writer = auth.kind === 'mcp' ? 'codex' : 'browser-ai';
        return jsonResponse(await saveDraft(env, auth.accessToken, projectId, body, writer));
      }
      if (action === 'operations' && request.method === 'POST') {
        const body = await request.json();
        return jsonResponse(await applyProjectOperations(env, auth.accessToken, projectId, body, 'codex'));
      }
      if (action === 'publish' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await publishProject(env, auth.accessToken, projectId, body));
      }
      if (action === 'versions' && request.method === 'GET') {
        return jsonResponse(await listVersions(env, auth.accessToken, projectId));
      }
      if (action === 'rollback' && request.method === 'POST') {
        const body = await request.json();
        return jsonResponse(await rollbackProject(env, auth.accessToken, projectId, body));
      }
      if (action === 'validate' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await validateProject(env, auth.accessToken, projectId, body));
      }
      if (action === 'preview-url' && request.method === 'GET') {
        return jsonResponse(await previewUrls(env, auth.accessToken, projectId, request));
      }
      if (action === 'lease' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await acquireLease(env, auth.accessToken, auth.userId, projectId, body));
      }
      if (action === 'lease' && request.method === 'DELETE') {
        const body = await request.json().catch(() => ({}));
        return jsonResponse(await releaseLease(env, auth.accessToken, projectId, body));
      }
    }

    return jsonResponse({ success: false, error: 'Not found' }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
