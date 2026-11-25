/**
 * SP-Scheme over MCP: the spec, a signed upload link for zips, and the import.
 *
 * The import runs the same library as Studio and the classic SP-Scheme panel
 * (src/lib/spSchemeImport.js), so an agent's upload becomes the same survey a
 * researcher would get by dropping the file into Studio. Media from a zip goes
 * to R2 with the browser's key scheme and library entry shape.
 */

import { strToU8 } from 'fflate';
import { buildSpSchemeText, readSpSchemeUpload, SP_SCHEME_VERSION } from '../../src/lib/spScheme.js';
import {
  finalizeSpSchemeImport,
  prepareSpSchemeUpload,
  revalidateSpSchemeUpload,
  spSchemeMediaPlan,
  spSchemeProblemsText,
  summarizeSpSchemeImport,
} from '../../src/lib/spSchemeImport.js';
import { normalizeAllowedHosts } from '../../src/lib/spSiteCore.js';
import { uploadMediaBatch } from '../../src/lib/mediaUploadBatch.js';
import { inferMediaType } from '../../src/lib/mediaUtils.js';
import { buildProjectUrls, isSafeProjectId, sanitizeForAgent } from '../designProtocol.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { createProject, saveDraft } from './projectHandlers.mjs';
import { deleteOwnedProject, loadOwned } from './projectLifecycle.mjs';
import {
  deletePrefixMedia,
  getPrefixObject,
  isR2Ready,
  listPrefixObjects,
  projectMediaPrefix,
  putPrefixObject,
} from './r2AgentMedia.mjs';
import { SP_SCHEME_AGENT_STEPS } from './spSchemeWorkflow.mjs';
import {
  UPLOAD_PATH_PREFIX,
  UPLOAD_TOKEN_TTL_SECONDS,
  signTransferToken,
  stagingKey,
  stagingPrefix,
} from '../mcp/transferTokens.mjs';

/** Largest staged upload (zip or html). */
export const MAX_STAGED_BYTES = 50 * 1024 * 1024;
/** A zip may expand to at most this much (the Worker has 128 MB). */
export const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const STALE_STAGING_MS = 2 * 60 * 60 * 1000;
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };

function fail(message, status = 400, code = 'BAD_REQUEST', extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function appOrigin(request, env) {
  return String(env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

// Signed links point at the server the agent reached, so they work locally too.
function transferOrigin(request, env) {
  try {
    return new URL(request.url).origin;
  } catch {
    return appOrigin(request, env);
  }
}

/** sp_scheme_spec */
export function spSchemeSpec() {
  return {
    success: true,
    version: SP_SCHEME_VERSION,
    text: buildSpSchemeText(),
    steps: [...SP_SCHEME_AGENT_STEPS],
  };
}

// Housekeeping: staged files the agent never imported.
async function deleteStaleStaging(env, userId, now = Date.now()) {
  try {
    const prefix = stagingPrefix(userId);
    const listed = await listPrefixObjects(env, prefix);
    const stale = (listed.objects || [])
      .filter((o) => {
        const at = Date.parse(o.uploaded || '');
        return Number.isFinite(at) && now - at > STALE_STAGING_MS;
      })
      .map((o) => o.key);
    if (stale.length) await deletePrefixMedia(env, prefix, stale);
  } catch {
    /* best effort */
  }
}

/** sp_scheme_upload_url: a signed PUT link (30 minutes) for one zip or html file. */
export async function createSpSchemeUploadUrl(env, ctx, request) {
  if (!isR2Ready(env)) throw fail('R2 is not configured on this server, so files cannot be uploaded. Pass the page inline as html instead.', 503, 'R2_NOT_CONFIGURED');
  const uploadId = crypto.randomUUID();
  const { token, expiresAt } = await signTransferToken(env, { kind: 'upload', userId: ctx.userId, uploadId }, UPLOAD_TOKEN_TTL_SECONDS);
  await deleteStaleStaging(env, ctx.userId);
  const uploadUrl = `${transferOrigin(request, env)}${UPLOAD_PATH_PREFIX}${token}`;
  return {
    success: true,
    uploadId,
    uploadUrl,
    method: 'PUT',
    maxBytes: MAX_STAGED_BYTES,
    expiresAt,
    curl: `curl -X PUT --data-binary @study.zip '${uploadUrl}'`,
    next: 'Run the curl line with your zip (or index.html), then call sp_scheme_import with { uploadId }.',
  };
}

/** PUT /api/mcp/upload/<token> after the token is verified: store the bytes for this user. */
export async function storeStagedUpload(env, claims, bytes) {
  const key = stagingKey(claims.userId, claims.uploadId);
  const put = await putPrefixObject(env, key, bytes, 'application/octet-stream');
  if (!put.configured) throw fail('R2 is not configured on this server.', 503, 'R2_NOT_CONFIGURED');
  return { ok: true, uploadId: claims.uploadId, bytes: bytes.byteLength };
}

async function readImportBytes(env, ctx, args) {
  const hasHtml = typeof args.html === 'string' && args.html.length > 0;
  const hasUpload = args.uploadId != null && args.uploadId !== '';
  if (hasHtml === hasUpload) throw fail('Pass exactly one of html (the page as text) or uploadId (from sp_scheme_upload_url).', 400, 'ONE_SOURCE_REQUIRED');
  if (hasHtml) {
    const bytes = strToU8(args.html);
    if (bytes.byteLength > MAX_STAGED_BYTES) throw fail(`The page is larger than ${MAX_STAGED_BYTES / 1048576} MB.`, 413, 'UPLOAD_TOO_LARGE');
    return { bytes, name: 'index.html', stagedKey: null };
  }
  const uploadId = String(args.uploadId);
  if (!UPLOAD_ID_RE.test(uploadId)) throw fail('Invalid uploadId.', 400, 'BAD_UPLOAD_ID');
  // The key is built from the caller's own id: another user's upload is never found.
  const key = stagingKey(ctx.userId, uploadId);
  const got = await getPrefixObject(env, key);
  if (!got.configured) throw fail('R2 is not configured on this server.', 503, 'R2_NOT_CONFIGURED');
  if (!got.bytes) throw fail('No upload found for this uploadId. Run the curl line from sp_scheme_upload_url first (links expire after 30 minutes).', 404, 'UPLOAD_NOT_FOUND');
  if (got.bytes.byteLength > MAX_STAGED_BYTES) throw fail(`The upload is larger than ${MAX_STAGED_BYTES / 1048576} MB.`, 413, 'UPLOAD_TOO_LARGE');
  const isZip = got.bytes.length > 3 && got.bytes[0] === 0x50 && got.bytes[1] === 0x4b;
  return { bytes: got.bytes, name: isZip ? 'upload.zip' : 'index.html', stagedKey: key };
}

function toFile({ path, bytes }) {
  const name = path.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  return new File([bytes], name, { type: MIME[ext] || (inferMediaType(name) === 'image' ? 'image/*' : 'application/octet-stream') });
}

// A media key must stay inside this project's folder: no empty, "." or ".." parts.
function safeProjectKey(key, prefix) {
  if (!key.startsWith(prefix)) return false;
  return key.slice(prefix.length).split('/').every((part) => part && part !== '.' && part !== '..');
}

/**
 * Upload the plan's files with the browser's key scheme
 * (`${uid}/${pid}/${folder}/${safeBase}__${uuid}${ext}`) and entry shape.
 * All or nothing: on any failure the objects already written are deleted.
 */
export async function uploadPlanToR2(env, { plan, userId, projectId }) {
  const prefix = projectMediaPrefix(userId, projectId);
  const written = [];
  const entries = [];
  const failures = [];
  const byFolder = new Map();
  plan.files.forEach((file) => {
    if (!byFolder.has(file.folder)) byFolder.set(file.folder, []);
    byFolder.get(file.folder).push(file);
  });
  for (const [folder, files] of byFolder) {
    // eslint-disable-next-line no-await-in-loop
    const result = await uploadMediaBatch({
      files: files.map(toFile),
      prefix,
      folder,
      prepare: (raw) => raw,
      makeId: () => crypto.randomUUID(),
      upload: async (file, key) => {
        if (!safeProjectKey(key, prefix)) return { success: false, error: 'Unsafe file path' };
        const put = await putPrefixObject(env, key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
        if (!put.configured) return { success: false, error: 'R2 is not configured' };
        written.push(key);
        if (!put.url) return { success: false, error: 'R2_PUBLIC_URL is not configured' };
        return { success: true, url: put.url };
      },
      // One write at the end of the whole import, not per batch.
      persist: async () => {},
    });
    entries.push(...result.uploaded);
    failures.push(...result.failures.map((f) => ({ name: `${folder}/${f.name}`, error: f.error })));
    if (failures.length) break;
  }
  if (failures.length) {
    if (written.length) await deletePrefixMedia(env, prefix, written).catch(() => {});
    return { entries: [], failures, written: [] };
  }
  return { entries, failures: [], written };
}

function linksFor(origin, projectId, row) {
  const urls = buildProjectUrls(projectId, origin, row);
  return {
    studio: urls.studio,
    // The Studio project page shows the participant view of the draft; nothing is recorded there.
    preview: urls.studio,
    participant: urls.participant,
  };
}

async function patchLibrary(env, ctx, projectId, expectedDraftUpdatedAt, body) {
  const owner = ctx.serviceRole ? `&user_id=eq.${encodeURIComponent(ctx.userId)}` : '';
  const stamp = `&draft_updated_at=eq.${encodeURIComponent(expectedDraftUpdatedAt)}`;
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    serviceRole: Boolean(ctx.serviceRole),
    query: `?id=eq.${encodeURIComponent(projectId)}${owner}${stamp}&select=id`,
    body,
    prefer: 'return=representation',
  });
  return Array.isArray(rows) && rows.length > 0;
}

// Undo our library entries even when someone saved the project meanwhile:
// keep everything else that is there now.
async function removeLibraryEntries(env, ctx, projectId, keys) {
  const drop = new Set(keys);
  const owner = ctx.serviceRole ? `&user_id=eq.${encodeURIComponent(ctx.userId)}` : '';
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken: ctx.accessToken,
    serviceRole: Boolean(ctx.serviceRole),
    query: `?id=eq.${encodeURIComponent(projectId)}${owner}&select=preloaded_images`,
  });
  const current = Array.isArray(rows?.[0]?.preloaded_images) ? rows[0].preloaded_images : [];
  const kept = current.filter((entry) => !drop.has(entry?.key));
  if (kept.length === current.length) return;
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    serviceRole: Boolean(ctx.serviceRole),
    query: `?id=eq.${encodeURIComponent(projectId)}${owner}`,
    body: { preloaded_images: kept },
  });
}

/**
 * sp_scheme_import: { projectId?, name?, html?, uploadId?, allowHosts? }.
 * Nothing is written unless the page passes the check; then media first, the
 * library in one write, and the draft through the normal draft save.
 */
export async function importSpScheme(env, ctx, args = {}, request) {
  if (args.projectId != null && args.projectId !== '' && !isSafeProjectId(args.projectId)) {
    throw fail('Invalid project id', 400, 'INVALID_PROJECT_ID');
  }
  const source = await readImportBytes(env, ctx, args);
  let read;
  try {
    read = readSpSchemeUpload(source.bytes, { maxZipBytes: MAX_STAGED_BYTES, maxUnzippedBytes: MAX_UNZIPPED_BYTES });
  } catch (err) {
    throw fail(`The upload could not be read: ${err.message || err}`, 400, 'UNREADABLE_UPLOAD');
  }
  source.bytes = null;

  const prepared = prepareSpSchemeUpload(read, { name: source.name });
  let { report, allowed } = prepared;
  if (Array.isArray(args.allowHosts)) {
    allowed = normalizeAllowedHosts(args.allowHosts);
    report = revalidateSpSchemeUpload(prepared.upload, allowed);
  }
  const { upload, hosts } = prepared;
  const summary = summarizeSpSchemeImport({ report, upload, hosts, allowed });

  if (!report.ok) {
    return {
      success: true,
      imported: false,
      summary,
      fixHint: {
        problems: summary.problems,
        text: spSchemeProblemsText(summary.problems).trim(),
        hosts: 'If a needed script or style host was left out, pass it in allowHosts. Hosts the page only sends requests to stay off unless you list them.',
      },
      next: 'Nothing was imported. Fix the problems in the page and call sp_scheme_import again (the same uploadId works until it expires).',
    };
  }

  const plan = spSchemeMediaPlan(upload);
  if (plan && !isR2Ready(env)) throw fail('This zip carries media files, but R2 is not configured on this server.', 503, 'R2_NOT_CONFIGURED');

  // The project: an owned one, or a new one through the normal create path.
  let created = false;
  let row;
  let projectId = args.projectId ? String(args.projectId) : '';
  if (projectId) {
    row = await loadOwned(env, { ...ctx, projectId });
  } else {
    const name = String(args.name || summary.title || 'New study').trim().slice(0, 160) || 'New study';
    const made = await createProject(env, ctx.serviceRole ? null : ctx.accessToken, ctx.userId, { name }, request);
    projectId = made.project.id;
    created = true;
    row = await loadOwned(env, { ...ctx, projectId });
  }
  const expected = row.draft_updated_at || null;
  const undoCreate = async () => {
    if (created) await deleteOwnedProject(env, ctx, projectId).catch(() => {});
  };
  if (!expected) {
    throw fail('This project has no draft timestamp yet. Save it once (survey_replace_draft or the editor), then import again.', 409, 'NO_DRAFT_TOKEN');
  }

  // Media, all or nothing.
  let media = { entries: [], written: [] };
  if (plan) {
    media = await uploadPlanToR2(env, { plan, userId: ctx.userId, projectId });
    if (media.failures?.length) {
      await undoCreate();
      throw fail(`Media upload failed, so nothing was imported: ${media.failures.slice(0, 5).map((f) => `${f.name}: ${f.error}`).join('; ')}`, 502, 'MEDIA_UPLOAD_FAILED', { failures: media.failures.slice(0, 20) });
    }
  }
  const undoMedia = async () => {
    if (media.written.length) await deletePrefixMedia(env, projectMediaPrefix(ctx.userId, projectId), media.written).catch(() => {});
  };

  // The library, in one write, guarded by the draft token read above.
  const previousLibrary = Array.isArray(row.preloaded_images) ? row.preloaded_images : [];
  if (media.entries.length) {
    const now = new Date().toISOString();
    const ok = await patchLibrary(env, ctx, projectId, expected, {
      preloaded_images: [...previousLibrary, ...media.entries],
      preloaded_at: now,
      preloaded_source: 'r2',
      updated_at: now,
    }).catch(async (err) => { await undoMedia(); await undoCreate(); throw err; });
    if (!ok) {
      await undoMedia();
      await undoCreate();
      throw fail('The project changed while importing. Nothing was imported; try again.', 409, 'CONFLICT');
    }
  }

  // The survey: the same finalize step as Studio, saved as the draft.
  const baseConfig = sanitizeForAgent(row.survey_config_draft ?? row.survey_config ?? {});
  const nextConfig = finalizeSpSchemeImport(report, upload, baseConfig);
  let saved;
  try {
    saved = await saveDraft(env, ctx.serviceRole ? null : ctx.accessToken, projectId, {
      surveyConfig: nextConfig,
      expectedDraftUpdatedAt: expected,
      writer: { tool: 'sp_scheme_import' },
    }, 'codex', ctx.serviceRole ? ctx.userId : null);
  } catch (err) {
    if (media.entries.length) await removeLibraryEntries(env, ctx, projectId, media.written).catch(() => {});
    await undoMedia();
    await undoCreate();
    throw err;
  }

  if (source.stagedKey) {
    await deletePrefixMedia(env, stagingPrefix(ctx.userId), [source.stagedKey]).catch(() => {});
  }

  const links = linksFor(appOrigin(request, env), projectId, row);
  return {
    success: true,
    imported: true,
    created,
    projectId,
    draftUpdatedAt: saved.draftUpdatedAt,
    summary,
    media: { uploaded: media.entries.length, folders: summary.media.folders },
    links,
    next: [
      // eslint-disable-next-line no-nested-ternary
      !summary.hasSite
        ? 'No page came with this package, so the survey uses the platform\'s standard look.'
        : summary.asIs
          ? 'The page was imported as it is: the platform records what participants submit but does not analyse it. For analysis, fix summary.problems and import again with this projectId.'
          : `The page follows SP-Scheme (${summary.matchLevel}): the platform records and analyses its declared questions.`,
      `Check the page at links.preview. Publish with survey_publish { projectId: "${projectId}", expectedDraftUpdatedAt: "${saved.draftUpdatedAt}", confirm: true }, then share links.participant.`,
    ],
  };
}
