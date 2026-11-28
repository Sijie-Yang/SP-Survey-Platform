/**
 * Project lifecycle ops for Agent/MCP: duplicate, export/import, templates, main page, media.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { siteMediaName } from '../../src/lib/spSiteCore.js';
import {
  createDefaultSurveyConfig,
  findSecretFields,
  isSafeProjectId,
  sanitizeForAgent,
  stripOwnResponseSupabase,
  validateSurveyConfig,
  buildProjectUrls,
} from '../designProtocol.mjs';
import { normalizeProjectMetadata, metadataFromRow, projectCardFromRow } from './projectMeta.mjs';
import { hydrateSkillContracts } from './skillContracts.mjs';
import {
  copyObjects,
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

export function sanitizeMediaFolderConfig(cfg = {}) {
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
  const surveyConfig = await hydrateSkillContracts(env, stripSecrets(draftConfig(row)), ctx.userId || row.user_id);
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
  const inputSurveyConfig = pkg?.surveyConfig || pkg?.survey_config;
  const name = String(pkg?.project?.name || pkg?.name || 'Imported project').trim().slice(0, 160);
  if (!name) throw Object.assign(new Error('Project name is required.'), { status: 400 });
  if (!inputSurveyConfig) throw Object.assign(new Error('surveyConfig is required.'), { status: 400 });

  const surveyConfig = await hydrateSkillContracts(env, inputSurveyConfig, ctx.userId);

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
    media: templateMediaSummary(t),
  };
}

/**
 * Where a template's images are served from: count per origin, and how many
 * still point at the site's own /project_templates/ folder (repository files).
 */
export function templateMediaSummary(t) {
  const urls = (Array.isArray(t?.preloaded_images) ? t.preloaded_images : [])
    .map((entry) => String((entry && typeof entry === 'object' ? entry.url : entry) || ''))
    .filter(Boolean);
  const byOrigin = {};
  urls.forEach((url) => {
    let origin = 'relative';
    try { origin = new URL(url).origin; } catch { /* relative path */ }
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;
  });
  const configText = JSON.stringify(t?.survey_config || {});
  return {
    count: urls.length,
    byOrigin,
    repoFileRefs: urls.filter((url) => url.includes('/project_templates/')).length
      + (configText.match(/\/project_templates\//g) || []).length,
  };
}

export async function createFromTemplate(env, ctx, body, request) {
  const templateId = body?.templateId;
  if (!templateId) throw Object.assign(new Error('templateId is required'), { status: 400 });
  const tpl = await getTemplate(env, ctx, templateId);
  const name = String(body?.name || tpl.template.name).trim().slice(0, 160);
  const inputSurveyConfig = body?.surveyConfig
    ? stripSecrets(body.surveyConfig)
    : { ...tpl.surveyConfig, title: name };
  const surveyConfig = await hydrateSkillContracts(env, inputSurveyConfig, ctx.userId);
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

/** The first free template id: base, base-2, base-3, … */
async function reserveTemplateId(env, baseId) {
  let templateId = baseId;
  for (let n = 0; n < 8; n += 1) {
    const attempt = n === 0 ? baseId : `${baseId}-${n + 1}`;
    // eslint-disable-next-line no-await-in-loop
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
  return templateId;
}

export async function saveAsTemplate(env, ctx, projectId, body = {}) {
  const row = await loadOwned(env, { ...ctx, projectId });
  const meta = metadataFromRow(row);
  const name = String(body?.name || row.name).trim();
  const author = String(body?.author || meta.author || 'User').trim();
  const year = String(body?.year || meta.year || new Date().getFullYear()).trim();
  const baseId = buildTemplateIdBase({ name, author, year });
  const templateId = await reserveTemplateId(env, baseId);

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

const TEMPLATE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Platform admin, checked on the server against the admins table. */
export async function isPlatformAdmin(env, userId) {
  if (!userId) return false;
  let rows;
  try {
    rows = await supabaseRest(env, {
      path: '/rest/v1/admins',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
    });
  } catch {
    throw Object.assign(new Error('Could not check admin rights. Try again later.'), { status: 503, code: 'ADMIN_CHECK_FAILED' });
  }
  return Array.isArray(rows) && rows.length > 0;
}

function safeRelativeKey(rel) {
  const parts = String(rel || '').split('/');
  return parts.length > 0 && parts.every((part) => part && part !== '.' && part !== '..');
}

/**
 * The project's media library as the template's own: every entry stored under
 * the project's R2 prefix is copied to templates/<id>/ at the same relative
 * path, keeping its name, type and folder (pages find files by folder/name).
 * Entries stored elsewhere (template-owned or external URLs) are kept as they are.
 */
// Time for copying template media in one call; the MCP client gives up after 60 s.
const TEMPLATE_COPY_BUDGET_MS = 35000;

export function templateMediaPlan(preloadedImages, projectPrefix, templatePrefix, publicBase = '') {
  const base = String(publicBase || '').replace(/\/$/, '');
  const copies = new Map();
  const entries = (Array.isArray(preloadedImages) ? preloadedImages : []).map((entry) => {
    const key = String(entry?.key || entry?.media_id || '');
    if (!key.startsWith(projectPrefix)) return entry;
    const rel = key.slice(projectPrefix.length);
    if (!safeRelativeKey(rel)) return entry;
    const to = `${templatePrefix}${rel}`;
    copies.set(key, to);
    return { ...entry, key: to, media_id: to, url: base ? `${base}/${to}` : entry.url };
  });
  return { entries, copies: [...copies.entries()].map(([from, to]) => ({ from, to })) };
}

/**
 * Admin only: publish a project as an approved template directly (no review
 * queue), or overwrite an existing template from the project. Templates live in
 * Supabase, so nothing needs to be synced to the repository.
 */
export async function publishTemplate(env, ctx, projectId, body = {}, request = null) {
  if (!(await isPlatformAdmin(env, ctx.userId))) {
    throw Object.assign(new Error('Only platform admins can publish templates directly. Use survey_save_as_template to submit this project for review.'), { status: 403, code: 'ADMIN_ONLY' });
  }
  const row = await loadOwned(env, { ...ctx, projectId });
  // A browser session (Supabase JWT) can read projects it collaborates on, and
  // an admin can read every project; only the owner may publish one.
  if (!ctx.userId || row.user_id !== ctx.userId) {
    throw Object.assign(new Error('Only the project owner can publish it as a template.'), { status: 403, code: 'FORBIDDEN' });
  }
  const meta = metadataFromRow(row);
  const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
  const name = text(body.name, 200);
  const author = text(body.author, 300);
  const year = text(body.year, 20);
  if (!name || !author || !year) {
    throw Object.assign(new Error('name, author and year are required.'), { status: 400, code: 'TEMPLATE_FIELDS_REQUIRED' });
  }
  const showOnLanding = body.showOnLanding !== false;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => text(t, 60)).filter(Boolean).slice(0, 30)
    : null;

  let existing = null;
  let templateId;
  if (body.templateId != null && body.templateId !== '') {
    templateId = String(body.templateId).trim();
    if (templateId.length > 96 || !TEMPLATE_ID_RE.test(templateId)) {
      throw Object.assign(new Error('templateId must be lowercase letters, digits and single hyphens.'), { status: 400, code: 'INVALID_TEMPLATE_ID' });
    }
    const rows = await supabaseRest(env, {
      path: '/rest/v1/templates',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(templateId)}&select=id,description,category,tags,paper_url,huggingface_dataset,preloaded_images`,
    });
    existing = Array.isArray(rows) ? rows[0] : null;
    if (!existing) throw Object.assign(new Error(`Template not found: ${templateId}`), { status: 404, code: 'TEMPLATE_NOT_FOUND' });
  } else {
    templateId = await reserveTemplateId(env, buildTemplateIdBase({ name, author, year }));
  }

  const ownerId = row.user_id;
  const plan = templateMediaPlan(
    row.preloaded_images,
    projectMediaPrefix(ownerId, projectId),
    templateMediaPrefix(templateId),
    env.R2_PUBLIC_URL,
  );
  if (plan.copies.length) {
    if (!isR2Ready(env)) {
      throw Object.assign(new Error('R2 is not configured on this server, so the project media cannot be copied.'), { status: 503 });
    }
    // Copied in parallel; files copied by an earlier call are skipped, and no
    // new copy starts after the deadline, so a large library is copied over a
    // few calls that each answer well within the client's time limit.
    const copied = await copyObjects(env, plan.copies, {
      fromPrefix: projectMediaPrefix(ownerId, projectId),
      toPrefix: templateMediaPrefix(templateId),
      deadlineMs: Date.now() + TEMPLATE_COPY_BUDGET_MS,
    });
    if (copied.error) {
      // Copied files stay, so calling again only copies what is missing.
      throw Object.assign(new Error(`Copying the project media to the template failed (${copied.error}). Nothing was published; call again to retry (files already copied are kept and skipped).`), { status: 502, code: 'TEMPLATE_MEDIA_COPY_FAILED' });
    }
    if (copied.remaining > 0) {
      return {
        success: true,
        templateId,
        status: 'copying',
        published: false,
        mediaTotal: plan.copies.length,
        mediaDone: plan.copies.length - copied.remaining,
        remaining: copied.remaining,
        message: `Copied ${plan.copies.length - copied.remaining} of ${plan.copies.length} media files; the template is not published yet. Call template_publish again with the same arguments: files already copied are skipped, and the template is published once all are there.`,
      };
    }
  }

  const now = new Date().toISOString();
  const fields = {
    name,
    description: body.description != null ? text(body.description, 5000) : (existing?.description ?? String(row.description || '').trim()),
    author,
    year,
    category: text(body.category, 120) || existing?.category || meta.category || 'Custom',
    tags: tags || existing?.tags || meta.tags || [],
    paper_url: body.paperUrl != null ? (text(body.paperUrl, 1000) || null) : (existing?.paper_url || meta.website || null),
    huggingface_dataset: existing?.huggingface_dataset || meta.huggingfaceDataset || null,
    // As in the browser: no credentials and no researcher-owned response database.
    survey_config: stripOwnResponseSupabase(stripSecrets(draftConfig(row))),
    preloaded_images: plan.entries,
    preloaded_at: plan.entries.length ? now : null,
    preloaded_source: plan.entries.length ? 'project' : null,
    image_dataset_config: sanitizeMediaFolderConfig(row.image_dataset_config || {}),
    is_approved: true,
    show_on_landing: showOnLanding,
    is_active: showOnLanding,
    updated_at: now,
  };
  if (existing) {
    await supabaseRest(env, {
      path: '/rest/v1/templates',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(templateId)}`,
      body: fields,
    });
  } else {
    await supabaseRest(env, {
      path: '/rest/v1/templates',
      method: 'POST',
      serviceRole: true,
      body: { id: templateId, ...fields, user_id: ownerId, is_pinned: false, created_at: now },
    });
  }
  const origin = String(env.APP_URL || (request ? new URL(request.url).origin : '') || 'https://sp-survey.org').replace(/\/$/, '');
  return {
    success: true,
    templateId,
    created: !existing,
    status: 'published',
    showOnLanding,
    mediaCount: plan.entries.length,
    url: `${origin}/`,
    message: showOnLanding
      ? 'Template published. It is approved and shown in the homepage template library; it is stored online, so no repository sync is needed.'
      : 'Template published and approved, but not shown on the homepage (showOnLanding: false). It is stored online, so no repository sync is needed.',
  };
}

/**
 * Admin only: delete a template for good. Papers that link to it are unlinked
 * (they stay in the paper library), its media under templates/<id>/ is removed,
 * then the template row. Projects made from it keep their own questions and any
 * media they imported. Templates that exist only as repository files are not touched.
 * Order: unlink papers, delete media, delete the row, so a call cut short can be run again.
 */
export async function deleteTemplate(env, ctx, templateId) {
  if (!(await isPlatformAdmin(env, ctx.userId))) {
    throw Object.assign(new Error('Only platform admins can delete templates.'), { status: 403, code: 'ADMIN_ONLY' });
  }
  const id = String(templateId ?? '').trim();
  if (!id || id.length > 96 || !TEMPLATE_ID_RE.test(id)) {
    throw Object.assign(new Error('templateId must be lowercase letters, digits and single hyphens.'), { status: 400, code: 'INVALID_TEMPLATE_ID' });
  }
  const q = `?id=eq.${encodeURIComponent(id)}`;
  const found = await supabaseRest(env, { path: '/rest/v1/templates', serviceRole: true, query: `${q}&select=id,name` });
  const tpl = Array.isArray(found) ? found[0] : null;
  if (!tpl) throw Object.assign(new Error(`Template not found: ${id}`), { status: 404, code: 'TEMPLATE_NOT_FOUND' });

  const linked = `?template_id=eq.${encodeURIComponent(id)}`;
  const papers = await supabaseRest(env, { path: '/rest/v1/research_papers', serviceRole: true, query: `${linked}&select=id,title` });
  if (Array.isArray(papers) && papers.length) {
    await supabaseRest(env, {
      path: '/rest/v1/research_papers',
      method: 'PATCH',
      serviceRole: true,
      query: linked,
      body: { template_id: null, updated_at: new Date().toISOString() },
    });
  }
  const projects = await supabaseRest(env, { path: '/rest/v1/projects', serviceRole: true, query: `${linked}&select=id` });

  let media = { configured: false, deleted: 0 };
  if (isR2Ready(env)) media = await deletePrefixMedia(env, templateMediaPrefix(id));

  await supabaseRest(env, { path: '/rest/v1/templates', method: 'DELETE', serviceRole: true, query: q });
  const projectCount = Array.isArray(projects) ? projects.length : 0;
  return {
    success: true,
    templateId: id,
    name: tpl.name || '',
    deleted: true,
    mediaDeleted: media.deleted,
    papersUnlinked: (papers || []).map((p) => ({ id: p.id, title: p.title || '' })),
    projectsFromTemplate: projectCount,
    message: `Template ${id} deleted${media.configured ? ` with ${media.deleted} media file(s)` : ''}.`
      + ((papers || []).length ? ` ${(papers || []).length} paper(s) were unlinked and stay in the paper library; link them to another template with paper_save if needed.` : '')
      + (projectCount ? ` ${projectCount} project(s) made from it keep their own questions and imported media.` : ''),
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

const IMPORT_COPY_BUDGET_MS = 35000;

/**
 * Media-library entries for files copied from a template. Each file keeps the
 * name the template lists it under (the name it was uploaded with, which the
 * template's page asks for), not its stored object name
 * ("<name with unsafe characters replaced>__<id>.<ext>").
 */
export function copiedMediaEntries(files, templateImages, projectPrefix) {
  const names = new Map();
  (Array.isArray(templateImages) ? templateImages : []).forEach((entry) => {
    if (entry?.key && entry?.name) names.set(String(entry.key), String(entry.name));
  });
  return (Array.isArray(files) ? files : []).map((f) => {
    const rel = String(f.to || '').startsWith(projectPrefix)
      ? String(f.to).slice(projectPrefix.length)
      : String(f.name || '');
    const parts = rel.split('/').filter(Boolean);
    const stored = parts.pop() || f.name;
    const folder = parts.join('/');
    return { url: f.url, name: siteMediaName(names.get(String(f.from)) || stored), key: f.to, folder };
  });
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
  // Stop starting new copies well before the MCP client gives up (60 s), so the
  // files copied so far are always registered; a second call copies the rest.
  const copy = await copyPrefixMedia(
    env,
    templateMediaPrefix(templateId),
    projectMediaPrefix(ownerId, projectId),
    { deadlineMs: Date.now() + IMPORT_COPY_BUDGET_MS },
  );
  const now = new Date().toISOString();
  const templateRows = await supabaseRest(env, {
    path: '/rest/v1/templates',
    accessToken: ctx.accessToken,
    serviceRole: ctx.serviceRole,
    query: `?id=eq.${encodeURIComponent(templateId)}&select=preloaded_images`,
  }).catch(() => []);
  const preloaded = copiedMediaEntries(copy.files, templateRows?.[0]?.preloaded_images, projectMediaPrefix(ownerId, projectId));
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
  const { files, ...summary } = copy;
  return {
    success: true,
    projectId,
    templateId,
    ...summary,
    registered: preloaded.length,
    done: copy.remaining === 0 && !copy.errors?.length,
    next: copy.remaining > 0
      ? `${copy.remaining} file(s) not copied yet: call media_import_from_template again with the same projectId and templateId; files already copied are skipped.`
      : 'All template media is in the project media library. Publish again so the participant link uses it.',
  };
}

/** The storage key of a media-library entry (its key, else read from its public URL). */
export function mediaEntryKey(entry, env) {
  if (typeof entry === 'string') return mediaEntryKey({ url: entry }, env);
  if (entry?.key) return String(entry.key);
  const url = String(entry?.url || '');
  const bases = [env?.R2_PUBLIC_URL, ...String(env?.R2_LEGACY_PUBLIC_URLS || '').split(',')]
    .map((base) => String(base || '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  const base = bases.find((b) => url.startsWith(`${b}/`));
  return base ? decodeURIComponent(url.slice(base.length + 1).split('?')[0]) : '';
}

/**
 * Delete media of an owned project: the listed `keys`, or every file in
 * `folder` (to replace a folder: delete it, then upload or import the new
 * files). The deleted files also leave the project's media library, so
 * participants are never drawn an image that no longer exists.
 */
export async function deleteProjectMedia(env, ctx, projectId, body = {}) {
  const keys = Array.isArray(body.keys) ? body.keys.map(String).filter(Boolean) : [];
  const folder = body.folder != null ? normalizeFolderPath(String(body.folder)) : '';
  if (!keys.length && !folder) {
    throw Object.assign(new Error('Pass keys (files to delete) or folder (delete every file in that folder).'), { status: 400 });
  }
  if (folder.includes('..')) throw Object.assign(new Error('Invalid folder.'), { status: 400 });
  const row = await loadOwned(env, { ...ctx, projectId });
  const ownerId = ctx.userId || row.user_id;
  const prefix = projectMediaPrefix(ownerId, projectId);
  if (!isR2Ready(env)) {
    throw Object.assign(new Error('R2 is not configured on this server.'), { status: 503 });
  }
  const targets = new Set(keys.filter((k) => k.startsWith(prefix)));
  if (folder) {
    const listed = await listPrefixMedia(env, `${prefix}${folder}/`);
    (listed.objects || []).forEach((o) => targets.add(o.key));
  }
  const library = Array.isArray(row.preloaded_images) ? row.preloaded_images : [];
  const inFolder = (key) => folder && key.startsWith(`${prefix}${folder}/`);
  const kept = library.filter((entry) => {
    const key = mediaEntryKey(entry, env);
    return !(key && (targets.has(key) || inFolder(key)));
  });
  const result = await deletePrefixMedia(env, prefix, [...targets]);
  const removed = library.length - kept.length;
  if (removed) {
    const now = new Date().toISOString();
    await supabaseRest(env, {
      path: '/rest/v1/projects',
      method: 'PATCH',
      accessToken: ctx.accessToken,
      serviceRole: Boolean(ctx.serviceRole),
      query: ctx.serviceRole
        ? `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(ownerId)}`
        : `?id=eq.${encodeURIComponent(projectId)}`,
      body: { preloaded_images: kept, preloaded_at: now, updated_at: now },
    });
  }
  return {
    success: true,
    projectId,
    ...result,
    libraryRemoved: removed,
    libraryCount: kept.length,
    ...(row.release_managed && removed
      ? { next: 'The published version still lists the deleted files: publish again (survey_publish) so the participant link stops using them.' }
      : {}),
  };
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
