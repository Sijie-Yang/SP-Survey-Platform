/**
 * The two signed-link routes behind the MCP tools:
 *
 *   PUT /api/mcp/upload/<token>     raw zip or html body (max 50 MB) → staged for sp_scheme_import
 *   GET /api/mcp/download/<token>   the project's data as one ZIP (survey_download_url)
 *
 * The token is the only credential: signed, short-lived and bound to the user
 * (and the project for downloads). Ownership is checked again on download.
 */

import {
  DOWNLOAD_PATH_PREFIX,
  UPLOAD_PATH_PREFIX,
  verifyTransferToken,
} from './transferTokens.mjs';
import { MAX_STAGED_BYTES, storeStagedUpload } from '../agent/spSchemeAgent.mjs';
import { handleDataDownload } from '../agent/resultsDownload.mjs';
import { isR2Ready } from '../agent/r2AgentMedia.mjs';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function errorJson(error) {
  const status = Number(error?.status) || 500;
  // Server-side failures keep their detail out of the reply.
  const message = status >= 500 && status !== 503 ? 'The request failed. Try again later.' : (error?.message || 'Request failed');
  return json({ ok: false, error: message, code: error?.code || 'ERROR' }, status);
}

/** Read at most `max` bytes of the body; null when it is larger. */
async function readBodyCapped(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.byteLength; });
  return out;
}

function tokenFrom(pathname, prefix) {
  const token = pathname.slice(prefix.length);
  return token && !token.includes('/') ? token : '';
}

async function handleUpload(request, env, token) {
  if (request.method !== 'PUT') return json({ ok: false, error: 'Use PUT with the file as the request body.', code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PUT' });
  const claims = await verifyTransferToken(env, token, 'upload');
  if (!isR2Ready(env)) return json({ ok: false, error: 'R2 is not configured on this server.', code: 'R2_NOT_CONFIGURED' }, 503);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_STAGED_BYTES) {
    return json({ ok: false, error: `The file is larger than ${MAX_STAGED_BYTES / 1048576} MB.`, code: 'UPLOAD_TOO_LARGE' }, 413);
  }
  const bytes = await readBodyCapped(request, MAX_STAGED_BYTES);
  if (!bytes) return json({ ok: false, error: `The file is larger than ${MAX_STAGED_BYTES / 1048576} MB.`, code: 'UPLOAD_TOO_LARGE' }, 413);
  if (!bytes.byteLength) return json({ ok: false, error: 'The request body is empty. Send the file with --data-binary @file.', code: 'EMPTY_UPLOAD' }, 400);
  return json(await storeStagedUpload(env, claims, bytes));
}

async function handleDownload(request, env, token) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'Use GET.', code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  const claims = await verifyTransferToken(env, token, 'download');
  const response = await handleDataDownload(env, claims);
  return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

/** Response for /api/mcp/upload/* and /api/mcp/download/*, or null for any other path. */
export async function handleMcpTransferRoutes(request, env) {
  const { pathname } = new URL(request.url);
  const isUpload = pathname.startsWith(UPLOAD_PATH_PREFIX);
  const isDownload = pathname.startsWith(DOWNLOAD_PATH_PREFIX);
  if (!isUpload && !isDownload) return null;
  try {
    const token = tokenFrom(pathname, isUpload ? UPLOAD_PATH_PREFIX : DOWNLOAD_PATH_PREFIX);
    if (!token) return json({ ok: false, error: 'This link is not valid.', code: 'INVALID_LINK' }, 401);
    return isUpload ? await handleUpload(request, env, token) : await handleDownload(request, env, token);
  } catch (error) {
    return errorJson(error);
  }
}
