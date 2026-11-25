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
import { inferMediaType, MAX_AV_MEDIA_BYTES, normalizeFolderPath, normalizeMediaEntry } from '../../src/lib/mediaUtils.js';
import { buildProjectUrls, isSafeProjectId, sanitizeForAgent } from '../designProtocol.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { createProject, guardQuery, sameDraftStamp, saveDraft } from './projectHandlers.mjs';
import { deleteOwnedProject, loadOwned } from './projectLifecycle.mjs';
import {
  deletePrefixMedia,
  getPrefixObject,
  isR2Ready,
  listPrefixObjects,
  mapWithConcurrency,
  projectMediaPrefix,
  putPrefixObject,
} from './r2AgentMedia.mjs';
import {
  MAX_IMPORT_MEDIA_FILES,
  MAX_STAGED_BYTES,
  MAX_STAGED_UPLOADS,
  MAX_UNZIPPED_BYTES,
  SP_SCHEME_AGENT_STEPS,
} from './spSchemeWorkflow.mjs';
import {
  UPLOAD_PATH_PREFIX,
  UPLOAD_TOKEN_TTL_SECONDS,
  signTransferToken,
  stagingKey,
  stagingPrefix,
} from '../mcp/transferTokens.mjs';

// The size limits live in spSchemeWorkflow.mjs (no imports), so the discovery
// text can name them too.
export {
  MAX_IMPORT_MEDIA_FILES, MAX_STAGED_BYTES, MAX_STAGED_UPLOADS, MAX_UNZIPPED_BYTES,
} from './spSchemeWorkflow.mjs';

const STALE_STAGING_MS = 2 * 60 * 60 * 1000;
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };

const mb = (bytes) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

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

/**
 * Housekeeping for staged files the agent never imported: those older than
 * 2 hours go, and of the rest only the `keep` newest stay (`except`, the file
 * being written, is not counted). Best effort: a failure never blocks an upload.
 */
async function trimStaging(env, userId, { keep = MAX_STAGED_UPLOADS, except = null, now = Date.now() } = {}) {
  try {
    const prefix = stagingPrefix(userId);
    const listed = await listPrefixObjects(env, prefix);
    const at = (o) => {
      const time = Date.parse(o.uploaded || '');
      return Number.isFinite(time) ? time : 0;
    };
    const objects = (listed.objects || []).filter((o) => o.key !== except);
    const stale = objects.filter((o) => now - at(o) > STALE_STAGING_MS);
    const fresh = objects.filter((o) => now - at(o) <= STALE_STAGING_MS).sort((a, b) => at(b) - at(a));
    const drop = [...stale, ...fresh.slice(Math.max(keep, 0))].map((o) => o.key);
    if (drop.length) await deletePrefixMedia(env, prefix, drop);
  } catch {
    /* best effort */
  }
}

/** sp_scheme_upload_url: a signed PUT link (30 minutes) for one zip or html file. */
export async function createSpSchemeUploadUrl(env, ctx, request) {
  if (!isR2Ready(env)) throw fail('R2 is not configured on this server, so files cannot be uploaded. Pass the page inline as html instead.', 503, 'R2_NOT_CONFIGURED');
  const uploadId = crypto.randomUUID();
  const { token, expiresAt } = await signTransferToken(env, { kind: 'upload', userId: ctx.userId, uploadId }, UPLOAD_TOKEN_TTL_SECONDS);
  await trimStaging(env, ctx.userId);
  const uploadUrl = `${transferOrigin(request, env)}${UPLOAD_PATH_PREFIX}${token}`;
  return {
    success: true,
    uploadId,
    uploadUrl,
    method: 'PUT',
    maxBytes: MAX_STAGED_BYTES,
    maxUnzippedBytes: MAX_UNZIPPED_BYTES,
    maxMediaFiles: MAX_IMPORT_MEDIA_FILES,
    expiresAt,
    curl: `curl -X PUT --data-binary @study.zip '${uploadUrl}'`,
    next: 'Run the curl line with your zip (or index.html), then call sp_scheme_import with { uploadId }.',
  };
}

/** PUT /api/mcp/upload/<token> after the token is verified: store the bytes for this user. */
export async function storeStagedUpload(env, claims, bytes) {
  const key = stagingKey(claims.userId, claims.uploadId);
  // Room for this one: at most MAX_STAGED_UPLOADS staged files per user.
  await trimStaging(env, claims.userId, { keep: MAX_STAGED_UPLOADS - 1, except: key });
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
  if (!got.bytes) throw fail(`No upload found for this uploadId. Run the curl line from sp_scheme_upload_url first (links expire after 30 minutes; a staged upload may be removed after 2 hours, and only your ${MAX_STAGED_UPLOADS} most recent are kept).`, 404, 'UPLOAD_NOT_FOUND');
  if (got.bytes.byteLength > MAX_STAGED_BYTES) throw fail(`The upload is larger than ${MAX_STAGED_BYTES / 1048576} MB.`, 413, 'UPLOAD_TOO_LARGE');
  const isZip = got.bytes.length > 3 && got.bytes[0] === 0x50 && got.bytes[1] === 0x4b;
  return { bytes: got.bytes, name: isZip ? 'upload.zip' : 'index.html', stagedKey: key };
}

// A media key must stay inside this project's folder: no empty, "." or ".." parts.
function safeProjectKey(key, prefix) {
  if (!key.startsWith(prefix)) return false;
  return key.slice(prefix.length).split('/').every((part) => part && part !== '.' && part !== '..');
}

function baseName(path) {
  return String(path || '').split('/').pop();
}

/** Checked before any project is made or any file is uploaded. */
function checkMediaPlan(plan) {
  const files = plan?.files || [];
  if (files.length > MAX_IMPORT_MEDIA_FILES) {
    throw fail(`The zip has ${files.length} media files; one import takes at most ${MAX_IMPORT_MEDIA_FILES}. Leave the rest out and upload them to the project's media library in the site.`, 413, 'TOO_MANY_MEDIA_FILES');
  }
  const sizeOf = (f) => Number(f.size) || f.bytes?.byteLength || 0;
  const total = files.reduce((sum, f) => sum + sizeOf(f), 0);
  if (total > MAX_UNZIPPED_BYTES) {
    throw fail(`The media files add up to ${mb(total)}; one import takes at most ${mb(MAX_UNZIPPED_BYTES)}.`, 413, 'UPLOAD_TOO_LARGE');
  }
  const big = files.find((f) => sizeOf(f) > MAX_AV_MEDIA_BYTES);
  if (big) throw fail(`${big.path} is larger than ${mb(MAX_AV_MEDIA_BYTES)}, the limit for one media file.`, 413, 'UPLOAD_TOO_LARGE');
}

// Studio's rules (src/lib/studioImport.js sortPlannedMedia): a library entry
// is known by its folder and file name, exactly (case-sensitive).
function identity(folder, name) {
  return `${normalizeFolderPath(folder)}\n${String(name || '')}`;
}

function entrySize(entry) {
  const size = Number(entry?.original_bytes ?? entry?.uploaded_bytes);
  return Number.isFinite(size) ? size : null;
}

// The R2 key of an entry: its key, or the key in its public URL.
function storedKey(entry, env) {
  if (entry?.key) return String(entry.key);
  const url = String(entry?.url || '');
  const bases = [env?.R2_PUBLIC_URL, ...String(env?.R2_LEGACY_PUBLIC_URLS || '').split(',')]
    .map((base) => String(base || '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  const base = bases.find((b) => url.startsWith(`${b}/`));
  return base ? url.slice(base.length + 1).split('?')[0] : '';
}

/**
 * Sorts the planned files against the library, as Studio does:
 *   unchanged  same folder, name and size as every entry of that name: not uploaded
 *   replaced   same folder and name, another or unknown size: uploaded, and
 *              the old entries (`old`, library indexes) leave the library
 *   new        no entry of that folder and name: uploaded
 * @returns {{ files: object[], added: number, replaced: number, unchanged: number, old: Set<number> }}
 */
export function planLibraryImport(library, files, projectPrefix = null) {
  const byIdentity = new Map();
  (library || []).forEach((raw, index) => {
    const entry = normalizeMediaEntry(raw, projectPrefix);
    if (!entry?.name) return;
    const id = identity(entry.folder, entry.name);
    if (!byIdentity.has(id)) byIdentity.set(id, []);
    byIdentity.get(id).push(index);
  });
  const upload = [];
  const old = new Set();
  let unchanged = 0;
  let replaced = 0;
  (files || []).forEach((file) => {
    const existing = byIdentity.get(identity(file.folder, baseName(file.path))) || [];
    const size = file.bytes?.length;
    if (existing.length && existing.every((index) => entrySize(library[index]) === size)) {
      unchanged += 1;
      return;
    }
    if (existing.length) {
      replaced += 1;
      existing.forEach((index) => old.add(index));
    }
    upload.push(file);
  });
  return { files: upload, added: upload.length - replaced, replaced, unchanged, old };
}

/** The library after the import (old entries out, new ones at the end) and what it no longer holds. */
function composeLibrary(library, plan, uploaded) {
  const kept = [];
  const removed = [];
  (library || []).forEach((entry, index) => (plan.old.has(index) ? removed : kept).push(entry));
  return { next: [...kept, ...uploaded], removed };
}

/**
 * Upload files with the browser's key scheme
 * (`${uid}/${pid}/${folder}/${safeBase}__${uuid}${ext}`) and entry shape, at
 * most UPLOAD_CONCURRENCY at a time. Each key is added to `written` as soon as
 * it is stored, so the caller can remove them; after the first failure no new
 * upload starts. Entries keep the order of `files`.
 */
export async function uploadPlanToR2(env, { files, userId, projectId, written = [] }) {
  const prefix = projectMediaPrefix(userId, projectId);
  const failures = [];
  const entries = await mapWithConcurrency(files || [], UPLOAD_CONCURRENCY, async (file) => {
    if (failures.length) return null;
    const name = baseName(file.path);
    const ext = name.split('.').pop().toLowerCase();
    // A plain file-like object over the unzipped bytes: no File, no copy.
    const item = {
      name,
      size: file.bytes.byteLength,
      type: MIME[ext] || (inferMediaType(name) === 'image' ? 'image/*' : 'application/octet-stream'),
      bytes: file.bytes,
    };
    const result = await uploadMediaBatch({
      files: [item],
      prefix,
      folder: file.folder,
      prepare: (raw) => raw,
      makeId: () => crypto.randomUUID(),
      upload: async (raw, key) => {
        if (!safeProjectKey(key, prefix)) return { success: false, error: 'Unsafe file path' };
        const put = await putPrefixObject(env, key, raw.bytes, raw.type || 'application/octet-stream');
        if (!put.configured) return { success: false, error: 'R2 is not configured' };
        written.push(key);
        if (!put.url) return { success: false, error: 'R2_PUBLIC_URL is not configured' };
        return { success: true, url: put.url };
      },
      // One write at the end of the whole import, not per batch.
      persist: async () => {},
    });
    if (result.failures.length) {
      failures.push(...result.failures.map((f) => ({ name: `${file.folder}/${f.name}`, error: f.error })));
      return null;
    }
    return result.uploaded[0] || null;
  });
  return { entries, failures, written };
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

function ownerFilter(ctx) {
  return ctx.serviceRole ? `&user_id=eq.${encodeURIComponent(ctx.userId)}` : '';
}

// The library columns in one write, only while the row is as read (guards).
async function patchProject(env, ctx, projectId, guards, body) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    serviceRole: Boolean(ctx.serviceRole),
    query: `?id=eq.${encodeURIComponent(projectId)}${ownerFilter(ctx)}${guardQuery(guards)}&select=id`,
    body,
    prefer: 'return=representation',
  });
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Undo a library write (browser-session path): take out what the import added
 * and put back what it removed, keeping anything else that is there now. Each
 * write is guarded on updated_at; tried three times.
 */
async function restoreLibrary(env, ctx, projectId, { addedKeys, removed }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await supabaseRest(env, {
      path: '/rest/v1/projects',
      accessToken: ctx.accessToken,
      serviceRole: Boolean(ctx.serviceRole),
      query: `?id=eq.${encodeURIComponent(projectId)}${ownerFilter(ctx)}&select=preloaded_images,updated_at`,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new Error('project not found');
    const current = Array.isArray(row.preloaded_images) ? row.preloaded_images : [];
    const next = current.filter((entry) => !addedKeys.has(storedKey(entry, env)));
    const present = new Set(next.map((entry) => storedKey(entry, env) || entry?.url));
    removed.forEach((entry) => { if (!present.has(storedKey(entry, env) || entry?.url)) next.push(entry); });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    // eslint-disable-next-line no-await-in-loop
    const ok = await patchProject(env, ctx, projectId, { updated_at: row.updated_at ?? null }, {
      preloaded_images: next,
      updated_at: new Date().toISOString(),
    });
    if (ok) return;
  }
  throw new Error('the media library kept changing');
}

/**
 * Take back what a failed import wrote: the library change, the uploaded
 * files, the project it created. Returns the error to throw; when any of this
 * fails, its message says "Cleanup incomplete" and what is left.
 */
async function rollbackImport(env, ctx, projectId, undo, error) {
  const problems = [];
  if (undo.library) {
    try {
      await restoreLibrary(env, ctx, projectId, undo.library);
    } catch (err) {
      problems.push(`media library entries (${err.message || err})`);
    }
  }
  if (undo.written.length) {
    try {
      await deletePrefixMedia(env, projectMediaPrefix(ctx.userId, projectId), [...undo.written]);
    } catch (err) {
      problems.push(`${undo.written.length} uploaded file(s) (${err.message || err})`);
    }
  }
  if (undo.created) {
    try {
      await deleteOwnedProject(env, ctx, projectId);
    } catch (err) {
      problems.push(`the new project ${projectId} (${err.message || err})`);
    }
  }
  const out = error instanceof Error ? error : new Error(String(error));
  if (problems.length) {
    out.message = `${out.message} Cleanup incomplete: could not remove ${problems.join('; ')}.`;
    out.cleanupIncomplete = true;
  }
  return out;
}

/**
 * What the published version still uses, read after the save (as Studio
 * does): keys in its media snapshot and the text of its survey config.
 * null when it cannot be read; then no old file is deleted.
 */
async function publishedUse(env, ctx, projectId) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/projects',
      accessToken: ctx.accessToken,
      serviceRole: Boolean(ctx.serviceRole),
      query: `?id=eq.${encodeURIComponent(projectId)}${ownerFilter(ctx)}&select=release_managed,published_media,survey_config_published`,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    if (!row.release_managed) return { keys: new Set(), configText: '' };
    const media = row.published_media?.preloadedImages;
    return {
      keys: new Set((Array.isArray(media) ? media : []).map((entry) => storedKey(entry, env)).filter(Boolean)),
      configText: JSON.stringify(row.survey_config_published ?? {}),
    };
  } catch {
    return null;
  }
}

/**
 * Old files the replaced entries pointed at that can go once the import is
 * saved: stored under this project by this user (as Studio), not used by an
 * entry that stays, and not used by the published version.
 */
function retiredKeys(removed, nextLibrary, published, prefix, env) {
  if (!published) return [];
  const inUse = new Set(nextLibrary.map((entry) => storedKey(entry, env)).filter(Boolean));
  return [...new Set(removed.map((entry) => storedKey(entry, env)))]
    .filter((key) => key
      && safeProjectKey(key, prefix)
      && !inUse.has(key)
      && !published.keys.has(key)
      && !published.configText.includes(key));
}

/**
 * sp_scheme_import: { projectId?, expectedDraftUpdatedAt?, name?, html?, uploadId?, allowHosts? }.
 * The page is checked first, and a page that fails is refused before anything
 * is written. Then: media first (only new or changed files), then the library
 * and the draft. With an MCP token these are one guarded write; with a browser
 * session the library write comes first and is undone if the draft save fails.
 * Anything already written is removed again when a later step fails.
 */
export async function importSpScheme(env, ctx, args = {}, request) {
  if (args.projectId != null && args.projectId !== '' && !isSafeProjectId(args.projectId)) {
    throw fail('Invalid project id', 400, 'INVALID_PROJECT_ID');
  }
  const expectedArg = args.expectedDraftUpdatedAt != null && args.expectedDraftUpdatedAt !== ''
    ? String(args.expectedDraftUpdatedAt)
    : null;
  const source = await readImportBytes(env, ctx, args);
  let read;
  try {
    read = readSpSchemeUpload(source.bytes, { maxZipBytes: MAX_STAGED_BYTES, maxUnzippedBytes: MAX_UNZIPPED_BYTES });
  } catch (err) {
    throw fail(`The upload could not be read: ${err.message || err}`, 400, 'UNREADABLE_UPLOAD');
  }
  // The zip is not needed once unpacked.
  source.bytes = null;

  const prepared = prepareSpSchemeUpload(read, { name: source.name });
  read = null;
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
      next: 'Nothing was imported. Fix the problems in the page and import it again. To retry this same upload (for example with other allowHosts), reuse its uploadId; a staged upload may be removed after 2 hours.',
    };
  }

  // Limits first: nothing is created or uploaded for an import that cannot fit.
  const plan = spSchemeMediaPlan(upload);
  if (plan) checkMediaPlan(plan);
  if (plan && !isR2Ready(env)) throw fail('This zip carries media files, but R2 is not configured on this server.', 503, 'R2_NOT_CONFIGURED');

  // The project: an owned one, or a new one through the normal create path.
  let projectId = args.projectId ? String(args.projectId) : '';
  let row = null;
  const undo = { created: false, written: [], library: null };
  if (projectId) {
    row = await loadOwned(env, { ...ctx, projectId });
    if (expectedArg && !sameDraftStamp(expectedArg, row.draft_updated_at)) {
      throw fail(`The draft changed since ${expectedArg} (now ${row.draft_updated_at || 'unknown'}). Read it with survey_get_draft, then import again with its draftUpdatedAt.`, 409, 'CONFLICT');
    }
    if (row.release_managed && !expectedArg) {
      throw fail('This project is published, so pass expectedDraftUpdatedAt (draftUpdatedAt from survey_get_draft or your last import) to replace its draft.', 400, 'MISSING_EXPECTED_DRAFT_UPDATED_AT');
    }
  } else {
    const name = String(args.name || summary.title || 'New study').trim().slice(0, 160) || 'New study';
    const made = await createProject(env, ctx.serviceRole ? null : ctx.accessToken, ctx.userId, { name }, request);
    projectId = made.project.id;
    // From here on the project is ours to remove if anything fails.
    undo.created = true;
  }

  let saved;
  // Counts as Studio reports them: new files, files replacing an older one,
  // files already there unchanged (not uploaded); uploaded = new + replaced.
  let mediaReport = { uploaded: 0, new: 0, replaced: 0, unchanged: 0 };
  let composed = null;
  const prefix = projectMediaPrefix(ctx.userId, projectId);
  try {
    if (!row) row = await loadOwned(env, { ...ctx, projectId });
    const expected = row.draft_updated_at || null;
    if (!expected) {
      throw fail('This project has no draft timestamp yet. Save it once (survey_replace_draft or the editor), then import again.', 409, 'NO_DRAFT_TOKEN');
    }

    // Media: only new or changed files are uploaded.
    const previousLibrary = Array.isArray(row.preloaded_images) ? row.preloaded_images : [];
    let libraryColumns = null;
    if (plan) {
      const libraryPlan = planLibraryImport(previousLibrary, plan.files, prefix);
      const media = await uploadPlanToR2(env, {
        files: libraryPlan.files,
        userId: ctx.userId,
        projectId,
        written: undo.written,
      });
      if (media.failures.length) {
        throw fail(`Media upload failed, so nothing was imported: ${media.failures.slice(0, 5).map((f) => `${f.name}: ${f.error}`).join('; ')}`, 502, 'MEDIA_UPLOAD_FAILED');
      }
      mediaReport = {
        uploaded: libraryPlan.files.length,
        new: libraryPlan.added,
        replaced: libraryPlan.replaced,
        unchanged: libraryPlan.unchanged,
      };
      if (libraryPlan.files.length) {
        composed = composeLibrary(previousLibrary, libraryPlan, media.entries);
        libraryColumns = {
          preloaded_images: composed.next,
          preloaded_at: new Date().toISOString(),
          preloaded_source: 'r2',
        };
      }
    }

    // The survey: the same finalize step as Studio.
    const baseConfig = sanitizeForAgent(row.survey_config_draft ?? row.survey_config ?? {});
    const nextConfig = finalizeSpSchemeImport(report, upload, baseConfig);
    // As in Studio: a new page that names no folders and brings no images of
    // its own keeps the folders the old page was linked to.
    if (nextConfig.spSite && !plan && !nextConfig.spSite.mediaFolders?.length && baseConfig.spSite?.mediaFolders?.length) {
      nextConfig.spSite.mediaFolders = [...baseConfig.spSite.mediaFolders];
    }
    const draftBody = { surveyConfig: nextConfig, expectedDraftUpdatedAt: expected, writer: { tool: 'sp_scheme_import' } };
    // The library may not have changed since it was read (updated_at), or
    // another writer's library change would be lost.
    const libraryGuards = { updated_at: row.updated_at ?? null };

    if (ctx.serviceRole) {
      // Library and draft in one write, as Studio saves them.
      saved = await saveDraft(env, null, projectId, draftBody, 'codex', ctx.userId, {
        replacePage: true,
        extraColumns: libraryColumns,
        extraGuards: libraryColumns ? libraryGuards : null,
      });
    } else {
      // A browser session saves the draft through save_project_draft, so the
      // library goes first and is undone if the draft save fails.
      if (libraryColumns) {
        const ok = await patchProject(env, ctx, projectId, { draft_updated_at: expected, ...libraryGuards }, {
          ...libraryColumns,
          updated_at: new Date().toISOString(),
        });
        if (!ok) throw fail('conflict', 409, 'CONFLICT');
        undo.library = {
          addedKeys: new Set(composed.next.filter((entry) => !previousLibrary.includes(entry)).map((entry) => storedKey(entry, env))),
          removed: composed.removed,
        };
      }
      saved = await saveDraft(env, ctx.accessToken, projectId, draftBody, 'codex', null, { replacePage: true });
    }
  } catch (err) {
    if (err?.code === 'CONFLICT') {
      err.message = 'The project changed while importing (someone saved the draft or the media library), so nothing was imported. Read it again with survey_get_draft and import again.';
    }
    throw await rollbackImport(env, ctx, projectId, undo, err);
  }

  // Saved. Old files of replaced entries can go now, unless the published
  // version still uses them (best effort; nothing is deleted when the
  // published version cannot be read).
  const notes = [];
  if (composed?.removed.length) {
    const retired = retiredKeys(composed.removed, composed.next, await publishedUse(env, ctx, projectId), prefix, env);
    if (retired.length) {
      try {
        await deletePrefixMedia(env, prefix, retired);
      } catch {
        notes.push(`${retired.length} replaced file(s) are no longer in the library but could not be deleted from storage.`);
      }
    }
  }
  if (source.stagedKey) {
    await deletePrefixMedia(env, stagingPrefix(ctx.userId), [source.stagedKey]).catch(() => {});
  }

  const links = linksFor(appOrigin(request, env), projectId, row);
  return {
    success: true,
    imported: true,
    created: undo.created,
    projectId,
    draftUpdatedAt: saved.draftUpdatedAt,
    summary,
    media: { ...mediaReport, folders: summary.media.folders, ...(notes.length ? { note: notes.join(' ') } : {}) },
    links,
    next: [
      // eslint-disable-next-line no-nested-ternary
      !summary.hasSite
        ? 'No page came with this package, so the survey uses the platform\'s standard look.'
        : summary.asIs
          ? `The page was imported as it is: the platform records what participants submit but does not analyse it. For analysis, fix summary.problems and import again with projectId "${projectId}" and expectedDraftUpdatedAt "${saved.draftUpdatedAt}".`
          : `The page follows SP-Scheme (${summary.matchLevel}): the platform records and analyses its declared questions.`,
      `Check the page at links.preview. Publish with survey_publish { projectId: "${projectId}", expectedDraftUpdatedAt: "${saved.draftUpdatedAt}", confirm: true }, then share links.participant.`,
    ],
  };
}
