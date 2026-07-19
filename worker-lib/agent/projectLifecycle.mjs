/**
 * Project lifecycle ops for Agent/MCP: duplicate, export/import, templates, main page, media.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import {
  createDefaultSurveyConfig,
  findSecretFields,
  isSafeProjectId,
  sanitizeForAgent,
  validateSurveyConfig,
  buildProjectUrls,
} from '../designProtocol.mjs';
import { normalizeProjectMetadata, metadataFromRow, projectCardFromRow } from './projectMeta.mjs';
import {
  copyPrefixMedia,
  deletePrefixMedia,
  isR2Ready,
  listPrefixMedia,
  projectMediaPrefix,
  putPrefixObject,
  templateMediaPrefix,
} from './r2AgentMedia.mjs';

const MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|mp4|webm|mov|mp3|wav|m4a|ogg)$/i;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function normalizeFolderPath(path = '') {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
}

function mediaBasename(nameOrPath = '') {
  return String(nameOrPath).split('?')[0].split('/').pop() || '';
}

function buildProjectMediaKey(projectPrefix, folder, filename) {
  const prefix = String(projectPrefix || '').replace(/\/?$/, '/');
  const folderPart = normalizeFolderPath(folder);
  const safe = mediaBasename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return folderPart ? `${prefix}${folderPart}/${safe}` : `${prefix}${safe}`;
}

function decodeBase64Payload(data) {
  const raw = String(data || '').replace(/^data:[^;]+;base64,/, '');
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function guessContentType(filename, contentType) {
  if (contentType && String(contentType).trim()) return String(contentType).trim();
  const lower = mediaBasename(filename).toLowerCase();
  if (/\.png$/.test(lower)) return 'image/png';
  if (/\.gif$/.test(lower)) return 'image/gif';
  if (/\.webp$/.test(lower)) return 'image/webp';
  if (/\.mp4$/.test(lower)) return 'video/mp4';
  if (/\.webm$/.test(lower)) return 'video/webm';
  if (/\.mov$/.test(lower)) return 'video/quicktime';
  if (/\.mp3$/.test(lower)) return 'audio/mpeg';
  if (/\.wav$/.test(lower)) return 'audio/wav';
  if (/\.m4a$/.test(lower)) return 'audio/mp4';
  if (/\.ogg$/.test(lower)) return 'audio/ogg';
  return 'image/jpeg';
}

function sanitizeMediaFolderConfig(cfg = {}) {
  const allowed = new Set(['set', 'category']);
  const tagsIn = cfg?.mediaFolderTags && typeof cfg.mediaFolderTags === 'object'
    ? cfg.mediaFolderTags
    : {};
  const mediaFolderTags = {};
  Object.entries(tagsIn).forEach(([folder, tag]) => {
    const f = normalizeFolderPath(folder);
    const t = String(tag || '').toLowerCase();
    if (f && allowed.has(t)) mediaFolderTags[f] = t;
  });
  const mediaFolders = [...new Set(
    (Array.isArray(cfg?.mediaFolders) ? cfg.mediaFolders : [])
      .map(normalizeFolderPath)
      .filter(Boolean),
  )].sort();
  return { mediaFolderTags, mediaFolders };
}

function generateProjectId() {
  const rand = crypto.getRandomValues(new Uint8Array(5));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `proj_${Date.now()}_${hex}`;
}

function draftConfig(row) {
  return row.survey_config_draft ?? row.survey_config ?? {};
}

export async function loadOwned(env, { accessToken, userId, projectId, serviceRole = false }) {
  if (!isSafeProjectId(projectId)) {
    throw Object.assign(new Error('Invalid project id'), { status: 400, code: 'INVALID_PROJECT_ID' });
  }
  let query = `?id=eq.${encodeURIComponent(projectId)}&select=*`;
  if (serviceRole) {
    if (!userId) throw Object.assign(new Error('userId required'), { status: 400 });
    query += `&user_id=eq.${encodeURIComponent(userId)}`;
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken,
    serviceRole,
    query,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  return row;
}

function originFromRequest(request, env) {
  return env.APP_URL || request.headers.get('Origin') || new URL(request.url).origin;
}

function stripSecrets(config) {
  return sanitizeForAgent(config || {});
}

export async function duplicateProject(env, ctx, projectId, body = {}, request) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const name = String(body?.name || `${row.name} (Copy)`).trim().slice(0, 160);
  const surveyConfig = stripSecrets(draftConfig(row));
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) {
    throw Object.assign(new Error('Source survey validation failed.'), { status: 400, validation });
  }
  const id = generateProjectId();
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata(body, metadataFromRow(row));
  const newRow = {
    id,
    user_id: ctx.userId || row.user_id,
    name,
    description: body?.description != null ? String(body.description) : (row.description || ''),
    survey_config: surveyConfig,
    survey_config_draft: surveyConfig,
    draft_updated_at: now,
    metadata,
    image_dataset_config: row.image_dataset_config || { enabled: true },
    template_id: row.template_id || null,
    preloaded_images: [],
    preloaded_at: null,
    preloaded_source: null,
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };

  let mediaCopy = null;
  if (body?.copyMedia === true && isR2Ready(env)) {
    const ownerId = ctx.userId || row.user_id;
    mediaCopy = await copyPrefixMedia(
      env,
      projectMediaPrefix(ownerId, projectId),
      projectMediaPrefix(ownerId, id),
    );
    if (mediaCopy.files?.length) {
      newRow.preloaded_images = mediaCopy.files.map((f) => ({
        url: f.url,
        name: f.name,
        key: f.to,
      }));
      newRow.preloaded_at = now;
      newRow.preloaded_source = 'duplicate';
    }
  }

  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    body: newRow,
    prefer: 'return=representation',
  });

  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(newRow)),
    surveyConfig,
    draftUpdatedAt: now,
    validation,
    mediaCopy,
    urls: buildProjectUrls(id, originFromRequest(request, env)),
  };
}

export async function exportProject(env, ctx, projectId) {
  const row = await loadOwned(env, { ...ctx, projectId });
  return {
    success: true,
    package: {
      project: sanitizeForAgent({
        ...projectCardFromRow(row),
        imageDatasetConfig: row.image_dataset_config || {},
        templateId: row.template_id || null,
      }),
      surveyConfig: stripSecrets(draftConfig(row)),
      metadata: metadataFromRow(row),
      exportedAt: new Date().toISOString(),
    },
  };
}

export async function importProject(env, ctx, body, request) {
  const secretFields = findSecretFields(body);
  if (secretFields.length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), {
      status: 400,
      details: { secretFields },
    });
  }
  const pkg = body?.package || body;
  const surveyConfig = pkg?.surveyConfig || pkg?.survey_config;
  const name = String(pkg?.project?.name || pkg?.name || 'Imported project').trim().slice(0, 160);
  if (!name) throw Object.assign(new Error('Project name is required.'), { status: 400 });
  if (!surveyConfig) throw Object.assign(new Error('surveyConfig is required.'), { status: 400 });

  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) {
    throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  }

  const id = generateProjectId();
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata(
    { ...(pkg.metadata || {}), ...(pkg.project || {}) },
    {},
  );
  const cleaned = stripSecrets(surveyConfig);
  const row = {
    id,
    user_id: ctx.userId,
    name,
    description: String(pkg?.project?.description || pkg?.description || '').trim(),
    survey_config: cleaned,
    survey_config_draft: cleaned,
    draft_updated_at: now,
    metadata,
    image_dataset_config: { enabled: true },
    preloaded_images: [],
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };

  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    body: row,
    prefer: 'return=representation',
  });

  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: cleaned,
    draftUpdatedAt: now,
    validation,
    urls: buildProjectUrls(id, originFromRequest(request, env)),
  };
}

export async function listTemplates(env, ctx) {
  const userId = ctx.userId;
  // Approved + own pending
  const rows = await supabaseRest(env, {
    path: '/rest/v1/templates',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    query: userId
      ? `?or=(is_approved.eq.true,user_id.eq.${encodeURIComponent(userId)})&select=id,name,description,author,year,category,tags,is_approved,user_id,created_at,updated_at&order=created_at.desc`
      : '?is_approved=eq.true&select=id,name,description,author,year,category,tags,is_approved,created_at,updated_at&order=created_at.desc',
  });
  return {
    success: true,
    templates: (rows || []).map((t) => sanitizeForAgent({
      id: t.id,
      name: t.name,
      description: t.description || '',
      author: t.author || '',
      year: t.year || '',
      category: t.category || '',
      tags: t.tags || [],
      isApproved: !!t.is_approved,
      createdAt: t.created_at,
    })),
  };
}

export async function getTemplate(env, ctx, templateId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/templates',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    query: `?id=eq.${encodeURIComponent(templateId)}&select=*`,
  });
  const t = Array.isArray(rows) ? rows[0] : null;
  if (!t) throw Object.assign(new Error('Template not found'), { status: 404 });
  if (!t.is_approved && t.user_id !== ctx.userId) {
    throw Object.assign(new Error('Template not found'), { status: 404 });
  }
  return {
    success: true,
    template: sanitizeForAgent({
      id: t.id,
      name: t.name,
      description: t.description || '',
      author: t.author || '',
      year: t.year || '',
      category: t.category || '',
      tags: t.tags || [],
      isApproved: !!t.is_approved,
      huggingfaceDataset: t.huggingface_dataset || '',
      website: t.paper_url || '',
    }),
    surveyConfig: stripSecrets(t.survey_config || {}),
  };
}

export async function createFromTemplate(env, ctx, body, request) {
  const templateId = body?.templateId;
  if (!templateId) throw Object.assign(new Error('templateId is required'), { status: 400 });
  const tpl = await getTemplate(env, ctx, templateId);
  const name = String(body?.name || tpl.template.name).trim().slice(0, 160);
  const surveyConfig = body?.surveyConfig
    ? stripSecrets(body.surveyConfig)
    : { ...tpl.surveyConfig, title: name };
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) {
    throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  }
  const id = generateProjectId();
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata({
    author: tpl.template.author,
    year: tpl.template.year,
    category: tpl.template.category,
    tags: tpl.template.tags,
    website: tpl.template.website,
    huggingfaceDataset: tpl.template.huggingfaceDataset,
    ...body,
  }, {});
  const row = {
    id,
    user_id: ctx.userId,
    name,
    description: String(body?.description ?? tpl.template.description ?? '').trim(),
    survey_config: surveyConfig,
    survey_config_draft: surveyConfig,
    draft_updated_at: now,
    metadata,
    template_id: templateId,
    image_dataset_config: { enabled: true },
    preloaded_images: [],
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    body: row,
    prefer: 'return=representation',
  });
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig,
    draftUpdatedAt: now,
    validation,
    note: 'Template media was not copied. Use media_import_from_template if needed.',
    urls: buildProjectUrls(id, originFromRequest(request, env)),
  };
}

function buildTemplateIdBase({ name, author, year }) {
  const safeYear = (year || String(new Date().getFullYear())).toString().trim();
  const firstWord = (s, fallback) => {
    const word = (s || fallback).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return word || fallback;
  };
  return `${safeYear}-${firstWord(author, 'user')}-${firstWord(name, 'template')}`;
}

export async function saveAsTemplate(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const meta = metadataFromRow(row);
  const name = String(body?.name || row.name).trim();
  const author = String(body?.author || meta.author || 'User').trim();
  const year = String(body?.year || meta.year || new Date().getFullYear()).trim();
  const baseId = buildTemplateIdBase({ name, author, year });
  let templateId = baseId;
  for (let n = 0; n < 8; n += 1) {
    const attempt = n === 0 ? baseId : `${baseId}-${n + 1}`;
    const existing = await supabaseRest(env, {
      path: '/rest/v1/templates',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(attempt)}&select=id`,
    });
    if (!existing?.length) {
      templateId = attempt;
      break;
    }
  }

  const surveyConfig = stripSecrets(draftConfig(row));
  const now = new Date().toISOString();
  let preloaded = [];
  let mediaCopy = null;
  if (isR2Ready(env)) {
    const ownerId = ctx.userId || row.user_id;
    mediaCopy = await copyPrefixMedia(
      env,
      projectMediaPrefix(ownerId, projectId),
      templateMediaPrefix(templateId),
    );
    preloaded = (mediaCopy.files || []).map((f) => ({
      url: f.url,
      name: f.name,
      key: f.to,
    }));
  }

  const tplRow = {
    id: templateId,
    name,
    description: String(body?.description ?? row.description ?? '').trim(),
    author,
    year,
    category: String(body?.category || meta.category || 'Custom').trim(),
    tags: Array.isArray(body?.tags) ? body.tags : (meta.tags || []),
    paper_url: body?.website || meta.website || null,
    huggingface_dataset: body?.huggingfaceDataset || meta.huggingfaceDataset || null,
    survey_config: surveyConfig,
    preloaded_images: preloaded,
    preloaded_at: preloaded.length ? now : null,
    preloaded_source: preloaded.length ? 'project' : null,
    image_dataset_config: row.image_dataset_config || {},
    user_id: ctx.userId || row.user_id,
    is_approved: false,
    show_on_landing: false,
    is_pinned: false,
    is_active: false,
    created_at: now,
    updated_at: now,
  };

  // Ownership already verified via loadOwned; use service role so JWT agent
  // path is not blocked by restrictive template insert RLS.
  await supabaseRest(env, {
    path: '/rest/v1/templates',
    method: 'POST',
    serviceRole: true,
    body: tplRow,
  });

  return {
    success: true,
    templateId,
    status: 'pending_review',
    mediaCopy,
    message: 'Template submitted for admin review. Sensitive fields were stripped.',
  };
}

export async function applyMainPage(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const meta = metadataFromRow(row);
  const startIso = body.onlineStart ? new Date(body.onlineStart).toISOString() : null;
  const endIso = body.onlineEnd ? new Date(body.onlineEnd).toISOString() : null;
  if (!startIso || !endIso || Number.isNaN(Date.parse(startIso)) || Number.isNaN(Date.parse(endIso))) {
    throw Object.assign(new Error('onlineStart and onlineEnd are required ISO datetimes.'), { status: 400 });
  }
  if (new Date(endIso) <= new Date(startIso)) {
    throw Object.assign(new Error('onlineEnd must be after onlineStart.'), { status: 400 });
  }

  // Ownership verified; service role for listing writes (same as template submit).
  const existingRows = await supabaseRest(env, {
    path: '/rest/v1/live_survey_listings',
    serviceRole: true,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=1`,
  });
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const nowIso = new Date().toISOString();
  const tags = Array.isArray(body.tags) ? body.tags : (meta.tags || []);
  const card = {
    title: String(body.title || row.name || 'Untitled Survey').trim(),
    description: String(body.description ?? row.description ?? '').trim(),
    category: String(body.category || meta.category || 'Custom').trim(),
    tags,
    author: String(body.author || meta.author || '').trim(),
    thumbnail_url: body.thumbnailUrl || null,
  };

  if (existing?.status === 'approved') {
    const patch = {
      ...card,
      pending_online_start: startIso,
      pending_online_end: endIso,
      has_pending_window_change: true,
      updated_at: nowIso,
    };
    await supabaseRest(env, {
      path: '/rest/v1/live_survey_listings',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(existing.id)}`,
      body: patch,
    });
    return {
      success: true,
      mode: 'window_change',
      listingId: existing.id,
      message: 'Window change submitted for admin review. Current approved window stays active.',
    };
  }

  const listingId = existing?.id || `live-${projectId}-${Date.now().toString(36)}`.slice(0, 80);
  const listing = {
    id: listingId,
    project_id: projectId,
    user_id: ctx.userId || row.user_id,
    ...card,
    online_start: startIso,
    online_end: endIso,
    pending_online_start: null,
    pending_online_end: null,
    has_pending_window_change: false,
    status: 'pending',
    show_on_live: true,
    updated_at: nowIso,
    created_at: existing?.created_at || nowIso,
  };

  if (existing) {
    await supabaseRest(env, {
      path: '/rest/v1/live_survey_listings',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(existing.id)}`,
      body: listing,
    });
  } else {
    await supabaseRest(env, {
      path: '/rest/v1/live_survey_listings',
      method: 'POST',
      serviceRole: true,
      body: listing,
    });
  }

  return {
    success: true,
    mode: 'apply',
    listingId,
    message: 'Main page application submitted for admin review.',
  };
}

export async function deleteOwnedProject(env, ctx, projectId) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const ownerId = ctx.userId || row.user_id;
  let media = { configured: false, deleted: 0 };
  if (isR2Ready(env)) {
    media = await deletePrefixMedia(env, projectMediaPrefix(ownerId, projectId));
  }
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'DELETE',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    query: ctx.serviceRole
      ? `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(ownerId)}`
      : `?id=eq.${encodeURIComponent(projectId)}`,
  });
  return { success: true, projectId, deleted: true, media };
}

export async function listProjectMedia(env, ctx, projectId) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const ownerId = ctx.userId || row.user_id;
  const listed = await listPrefixMedia(env, projectMediaPrefix(ownerId, projectId));
  return {
    success: true,
    projectId,
    r2Configured: listed.configured,
    preloadedImages: row.preloaded_images || [],
    objects: listed.objects || [],
  };
}

export async function importMediaFromTemplate(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const templateId = body.templateId || row.template_id;
  if (!templateId) {
    throw Object.assign(new Error('templateId is required (or project.template_id).'), { status: 400 });
  }
  await getTemplate(env, ctx, templateId);
  if (!isR2Ready(env)) {
    throw Object.assign(new Error('R2 is not configured on this server.'), { status: 503 });
  }
  const ownerId = ctx.userId || row.user_id;
  const copy = await copyPrefixMedia(
    env,
    templateMediaPrefix(templateId),
    projectMediaPrefix(ownerId, projectId),
  );
  const now = new Date().toISOString();
  const preloaded = (copy.files || []).map((f) => {
    const rel = String(f.to || '').startsWith(projectMediaPrefix(ownerId, projectId))
      ? String(f.to).slice(projectMediaPrefix(ownerId, projectId).length)
      : String(f.name || '');
    const parts = rel.split('/').filter(Boolean);
    const name = parts.pop() || f.name;
    const folder = parts.join('/');
    return { url: f.url, name, key: f.to, folder };
  });
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    query: ctx.serviceRole
      ? `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(ownerId)}`
      : `?id=eq.${encodeURIComponent(projectId)}`,
    body: {
      preloaded_images: preloaded,
      preloaded_at: now,
      preloaded_source: 'template',
      template_id: templateId,
      updated_at: now,
    },
  });
  return { success: true, projectId, templateId, ...copy };
}

export async function deleteProjectMedia(env, ctx, projectId, body = {}) {
  await loadOwned(env, { ...ctx, projectId });
  const keys = Array.isArray(body.keys) ? body.keys : null;
  if (!keys?.length) {
    throw Object.assign(new Error('keys array is required.'), { status: 400 });
  }
  const row = await loadOwned(env, { ...ctx, projectId });
  const ownerId = ctx.userId || row.user_id;
  const prefix = projectMediaPrefix(ownerId, projectId);
  if (!isR2Ready(env)) {
    throw Object.assign(new Error('R2 is not configured on this server.'), { status: 503 });
  }
  const result = await deletePrefixMedia(env, prefix, keys);
  return { success: true, projectId, ...result };
}

/**
 * Upload one media file (base64) into an owned project R2 prefix.
 * Max decoded size 8MB — large video stays in Admin Media Dataset.
 */
export async function uploadProjectMedia(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  if (!isR2Ready(env)) {
    throw Object.assign(new Error('R2 is not configured on this server.'), { status: 503 });
  }
  const filename = mediaBasename(body.filename || body.name || '');
  if (!filename || !MEDIA_EXT_RE.test(filename)) {
    throw Object.assign(
      new Error('filename required with a supported media extension (jpg/png/gif/webp/mp4/webm/mov/mp3/wav/m4a/ogg).'),
      { status: 400 },
    );
  }
  if (!body.data) {
    throw Object.assign(new Error('data (base64) is required.'), { status: 400 });
  }

  let bytes;
  try {
    bytes = decodeBase64Payload(body.data);
  } catch {
    throw Object.assign(new Error('Invalid base64 data.'), { status: 400 });
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw Object.assign(
      new Error(`File too large (${bytes.byteLength} bytes). Max ${MAX_UPLOAD_BYTES} bytes via MCP; use Admin Media Dataset for larger files.`),
      { status: 400, code: 'UPLOAD_TOO_LARGE' },
    );
  }

  const ownerId = ctx.userId || row.user_id;
  const prefix = projectMediaPrefix(ownerId, projectId);
  const folder = normalizeFolderPath(body.folder || '');
  if (folder.includes('..') || String(body.filename || '').includes('..')) {
    throw Object.assign(new Error('Invalid folder or filename.'), { status: 400 });
  }
  const key = buildProjectMediaKey(prefix, folder, filename);
  if (!key.startsWith(prefix) || key.includes('..') || key.startsWith('templates/')) {
    throw Object.assign(new Error('Upload key must stay under the project media prefix.'), { status: 400 });
  }

  const contentType = guessContentType(filename, body.contentType);
  const put = await putPrefixObject(env, key, bytes, contentType);
  if (!put.configured) {
    throw Object.assign(new Error('R2 is not configured on this server.'), { status: 503 });
  }

  const updatePreloaded = body.updatePreloaded !== false;
  let preloadedImages = Array.isArray(row.preloaded_images) ? [...row.preloaded_images] : [];
  if (updatePreloaded) {
    const entry = { url: put.url, name: filename, key, folder: folder || '' };
    const idx = preloadedImages.findIndex((p) => p?.key === key || p?.url === put.url);
    if (idx >= 0) preloadedImages[idx] = entry;
    else preloadedImages.push(entry);
    const now = new Date().toISOString();
    await supabaseRest(env, {
      path: '/rest/v1/projects',
      method: 'PATCH',
      accessToken: ctx.accessToken,
      serviceRole: Boolean(ctx.serviceRole),
      query: ctx.serviceRole
        ? `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(ownerId)}`
        : `?id=eq.${encodeURIComponent(projectId)}`,
      body: {
        preloaded_images: preloadedImages,
        preloaded_at: now,
        preloaded_source: 'mcp_upload',
        updated_at: now,
      },
    });
  }

  return {
    success: true,
    projectId,
    key: put.key,
    url: put.url,
    contentType,
    bytes: bytes.byteLength,
    folder: folder || null,
    name: filename,
    preloadedUpdated: updatePreloaded,
  };
}

export async function getMediaDataset(env, ctx, projectId) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const cfg = sanitizeMediaFolderConfig(row.image_dataset_config || {});
  return {
    success: true,
    projectId,
    imageDatasetConfig: cfg,
    note: 'Product name: Media Dataset. DB column remains image_dataset_config. Tag folders as set or category for mediaAssignmentMode.',
  };
}

export async function updateMediaDataset(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const ownerId = ctx.userId || row.user_id;
  const current = row.image_dataset_config && typeof row.image_dataset_config === 'object'
    ? row.image_dataset_config
    : {};
  const incoming = body.imageDatasetConfig || body.mediaDataset || body;
  const mergedTags = {
    ...(current.mediaFolderTags || {}),
    ...(incoming.mediaFolderTags || {}),
  };
  const mergedFolders = [
    ...(Array.isArray(current.mediaFolders) ? current.mediaFolders : []),
    ...(Array.isArray(incoming.mediaFolders) ? incoming.mediaFolders : []),
  ];
  const safe = sanitizeMediaFolderConfig({
    mediaFolderTags: mergedTags,
    mediaFolders: mergedFolders,
  });
  // Preserve non-folder fields on the existing config.
  const next = {
    ...current,
    mediaFolderTags: safe.mediaFolderTags,
    mediaFolders: safe.mediaFolders,
  };
  const now = new Date().toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    serviceRole: Boolean(ctx.serviceRole),
    query: ctx.serviceRole
      ? `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(ownerId)}`
      : `?id=eq.${encodeURIComponent(projectId)}`,
    body: { image_dataset_config: next, updated_at: now },
  });
  return {
    success: true,
    projectId,
    imageDatasetConfig: sanitizeMediaFolderConfig(next),
  };
}

// Re-export helpers used by update path
export { normalizeProjectMetadata, metadataFromRow, projectCardFromRow, createDefaultSurveyConfig };
