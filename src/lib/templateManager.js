/**
 * templateManager.js
 *
 * All Supabase-side template & project operations used by:
 *   - ProjectSidebar  (list / save templates)
 *   - AdminDashboard  (manage all templates + view all projects)
 *   - LandingPage     (show_on_landing templates)
 *
 * Self-hosted mode (no Supabase):
 *   Functions return empty arrays / throw – callers fall back to
 *   fileSystemManager.js logic.
 *
 * Required Supabase SQL additions (run once — see also supabase/template_pin.sql):
 * ─────────────────────────────────────────────────────────────────────
 * ALTER TABLE templates
 *   ADD COLUMN IF NOT EXISTS preloaded_images JSONB DEFAULT '[]'::jsonb,
 *   ADD COLUMN IF NOT EXISTS preloaded_at     TIMESTAMPTZ,
 *   ADD COLUMN IF NOT EXISTS preloaded_source TEXT,
 *   ADD COLUMN IF NOT EXISTS is_pinned        BOOLEAN NOT NULL DEFAULT false;
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from './supabase';
import {
  isR2Configured, listImagesFromR2, copyImagesInR2, deleteImagesFromR2,
} from './r2';
import { normalizeMediaEntry } from './mediaUtils';

export function templateImagePrefix(templateId) {
  return `templates/${templateId}/`;
}

/** Normalize admin-entered template id to lowercase slug form. */
export function normalizeTemplateId(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function isValidTemplateId(id) {
  if (!id || id.length > 96) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function applyTemplateFieldUpdates(row, updates) {
  if ('is_approved'     in updates) row.is_approved     = updates.is_approved;
  if ('is_pinned'       in updates) row.is_pinned       = updates.is_pinned;
  if ('show_on_landing' in updates) {
    row.show_on_landing = updates.show_on_landing;
    row.is_active       = updates.show_on_landing;
  }
  if ('name'        in updates) row.name        = updates.name;
  if ('description' in updates) row.description = updates.description;
  if ('author'      in updates) row.author      = updates.author;
  if ('year'        in updates) row.year        = updates.year;
  if ('category'    in updates) row.category    = updates.category;
  if ('tags'        in updates) row.tags        = updates.tags;
  if ('paper_url'     in updates) row.paper_url     = updates.paper_url;
  if ('survey_config' in updates) row.survey_config = updates.survey_config;
  if ('huggingface_dataset' in updates) row.huggingface_dataset = updates.huggingface_dataset;
  if ('preloaded_images' in updates) row.preloaded_images = updates.preloaded_images;
  if ('preloaded_at'     in updates) row.preloaded_at     = updates.preloaded_at;
  if ('preloaded_source' in updates) row.preloaded_source = updates.preloaded_source;
  return row;
}

// ── Row ↔ App object mapping ─────────────────────────────────────────────────

function rowToTemplate(row) {
  return {
    id:                row.id,
    name:              row.name               || '',
    description:       row.description        || '',
    author:            row.author             || '',
    year:              row.year               || '',
    category:          row.category           || 'Custom',
    tags:              row.tags               || [],
    website:           row.paper_url          || null,
    huggingfaceDataset: row.huggingface_dataset || row.dataset || null,
    // survey_config is the full SurveyJS config stored as JSONB
    config:            row.survey_config      || {},
    // Template image folder (mirrors the per-project preloadedImages contract)
    preloadedImages:   row.preloaded_images   || [],
    preloadedAt:       row.preloaded_at       || null,
    preloadedSource:   row.preloaded_source   || null,
    // submitter info
    user_id:           row.user_id            || null,
    submitter_email:   row.submitter_email    || null,
    // review flags
    is_approved:       row.is_approved        ?? false,
    show_on_landing:   row.show_on_landing    ?? false,
    is_pinned:         row.is_pinned          ?? false,
    // timestamps
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

// ── ID generation ─────────────────────────────────────────────────────────────

/**
 * Build the base template id from author + name + year. Format:
 *   `${year}-${authorFirstWord}-${nameFirstWord}`
 * Lower-cased, stripped to a-z0-9 per segment.
 *
 * Used by the "Save as Template" flow so ids are human readable AND
 * predictably namespaced. Collisions are resolved by appending -2, -3, …
 * (see findAvailableTemplateId below).
 */
export function buildTemplateIdBase({ name, author, year }) {
  const safeYear = (year || String(new Date().getFullYear())).toString().trim();
  const firstWord = (s, fallback) => {
    const word = (s || fallback).trim().split(/\s+/)[0]
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    return word || fallback;
  };
  const authorWord = firstWord(author, 'user');
  const nameWord   = firstWord(name,   'template');
  return `${safeYear}-${authorWord}-${nameWord}`;
}

/**
 * Resolve a unique template id by appending -2, -3, … to the base when it
 * collides with an existing row. Best-effort: does a single SELECT to fetch
 * any rows whose id starts with the base, then picks the lowest free suffix.
 *
 * NOTE: there is a tiny TOCTOU window between this SELECT and the eventual
 * INSERT. saveTemplateToSupabase mitigates that by switching upsert→insert
 * and retrying on unique-violation.
 */
export async function findAvailableTemplateId(baseId) {
  if (!supabase) return baseId;
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('id')
      .like('id', `${baseId}%`);
    if (error) { console.warn('findAvailableTemplateId select error:', error); return baseId; }
    const taken = new Set((data || []).map(r => r.id));
    if (!taken.has(baseId)) return baseId;
    let n = 2;
    while (taken.has(`${baseId}-${n}`)) n++;
    return `${baseId}-${n}`;
  } catch (err) {
    console.warn('findAvailableTemplateId exception:', err);
    return baseId;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List templates visible to a regular user:
 *   - all is_approved=true templates
 *   - plus the user's own (pending) templates so they can see their submissions
 *
 * RLS enforces the same rule on the server side.
 */
export async function listTemplates(userId) {
  if (!supabase) return [];
  try {
    let query = supabase
      .from('templates')
      .select(
        'id, name, description, author, year, category, tags, paper_url, ' +
        'huggingface_dataset, dataset, survey_config, user_id, submitter_email, ' +
        'is_approved, show_on_landing, is_pinned, preloaded_images, preloaded_at, ' +
        'preloaded_source, created_at, updated_at'
      )
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.or(`is_approved.eq.true,user_id.eq.${userId}`);
    } else {
      query = query.eq('is_approved', true);
    }

    const { data, error } = await query;
    if (error) { console.error('listTemplates:', error); return []; }
    return (data || []).map(rowToTemplate);
  } catch (err) {
    console.error('listTemplates exception:', err);
    return [];
  }
}

/**
 * Fetch a single template by id. Used by the Image Dataset page to
 * decide whether to show an "Import Template Images" button when a
 * project was created from a template (project.template_id is set).
 *
 * Returns null when Supabase isn't configured, the id is missing, the
 * row doesn't exist, or RLS hides it from the caller — callers should
 * treat any of those the same way (just don't show the button).
 */
export async function getTemplateById(id) {
  if (!supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from('templates')
      .select(
        'id, name, description, author, year, category, tags, paper_url, ' +
        'huggingface_dataset, dataset, survey_config, user_id, submitter_email, ' +
        'is_approved, show_on_landing, is_pinned, preloaded_images, preloaded_at, ' +
        'preloaded_source, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return rowToTemplate(data);
  } catch (err) {
    console.error('getTemplateById exception:', err);
    return null;
  }
}

/**
 * Admin-only: list ALL templates without any filter.
 * Requires the caller's user_id to exist in the `admins` table (RLS).
 */
export async function listAllTemplates() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) { console.error('listAllTemplates:', error); return []; }
    return (data || []).map(rowToTemplate);
  } catch (err) {
    console.error('listAllTemplates exception:', err);
    return [];
  }
}

/**
 * Save a new template to Supabase.
 * Sets is_approved=false and show_on_landing=false by default.
 * The `template` object should already have sensitive fields stripped.
 */
export async function saveTemplateToSupabase(template) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const year   = template.year || String(new Date().getFullYear());
  const author = template.author || user.email || 'User';
  // Caller can pre-compute the id (so it knows where to put R2 images
  // before the row exists). Otherwise we derive one from author + name.
  const baseId = template.id || buildTemplateIdBase({
    name: template.name, author, year,
  });

  const buildRow = (id) => ({
    id,
    name:                template.name        || 'Untitled Template',
    description:         template.description || '',
    author,
    year,
    category:            template.category    || 'Custom',
    tags:                Array.isArray(template.tags) ? template.tags : [],
    paper_url:           template.website     || null,
    huggingface_dataset: template.huggingfaceDataset || null,
    survey_config:       template.config      || {},
    preloaded_images:    Array.isArray(template.preloadedImages) ? template.preloadedImages : [],
    preloaded_at:        template.preloadedAt || null,
    preloaded_source:    template.preloadedSource || null,
    user_id:             user.id,
    submitter_email:     user.email           || null,
    is_approved:         false,
    show_on_landing:     false,
    is_pinned:           false,
    is_active:           false,
    created_at:          new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  });

  // Use insert (NOT upsert) so a duplicate id surfaces as a real error
  // rather than silently overwriting another template's data/images.
  // On unique_violation (Postgres 23505) we bump a numeric suffix and retry
  // a few times — covers the TOCTOU race between findAvailableTemplateId's
  // SELECT and this INSERT.
  let attemptId = baseId;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = buildRow(attemptId);
    const { error } = await supabase.from('templates').insert(row);
    if (!error) {
      return { success: true, template: rowToTemplate(row) };
    }
    if (error.code === '23505') {
      const m = /^(.+?)(?:-(\d+))?$/.exec(attemptId);
      const stem = m ? m[1] : attemptId;
      const next = (m && m[2]) ? parseInt(m[2], 10) + 1 : 2;
      attemptId = `${stem}-${next}`;
      console.warn(`Template id "${baseId}" already taken, retrying with "${attemptId}"…`);
      continue;
    }
    throw error;
  }
  throw new Error(`Could not allocate a unique template id (last tried: ${attemptId})`);
}

/**
 * Admin: update any fields on a template.
 * Passing is_approved=true / show_on_landing=true also keeps is_active in sync.
 */
export async function updateTemplate(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  const row = applyTemplateFieldUpdates({ updated_at: new Date().toISOString() }, updates);

  const { error } = await supabase.from('templates').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
}

/**
 * Admin: rename a template id and move its R2 image folder when present.
 * Also updates projects.template_id references.
 * @param {Function} [onProgress] - ({ label, current, total }) => void
 */
export async function renameTemplateId(oldId, newId, updates = {}, onProgress) {
  const report = (label, current = 0, total = 0) => {
    onProgress?.({ label, current, total });
  };

  if (!supabase) throw new Error('Supabase not configured');
  const normalized = normalizeTemplateId(newId);
  if (!isValidTemplateId(normalized)) {
    throw new Error('Invalid template id. Use lowercase letters, numbers, and hyphens (e.g. 2025-yang-thermal).');
  }
  if (normalized === oldId) {
    if (Object.keys(updates).length) {
      report('正在保存…');
      await updateTemplate(oldId, updates);
    }
    return { success: true, id: oldId, renamed: false };
  }

  report('正在检查模板 ID…');
  const { data: taken, error: takenErr } = await supabase
    .from('templates')
    .select('id')
    .eq('id', normalized)
    .maybeSingle();
  if (takenErr) throw takenErr;
  if (taken) throw new Error(`Template id "${normalized}" is already in use.`);

  const { data: row, error: fetchErr } = await supabase
    .from('templates')
    .select('*')
    .eq('id', oldId)
    .single();
  if (fetchErr || !row) throw new Error('Template not found');

  const oldPrefix = templateImagePrefix(oldId);
  const newPrefix = templateImagePrefix(normalized);
  let preloaded_images = Array.isArray(row.preloaded_images) ? [...row.preloaded_images] : [];

  if (isR2Configured()) {
    report('正在列举云端图片…');
    const listed = await listImagesFromR2(oldPrefix);
    if (!listed.success && listed.error) {
      throw new Error(`Could not list template images: ${listed.error}`);
    }
    const objects = listed.images || [];
    if (objects.length) {
      const copies = objects.map((img) => ({
        from: img.key,
        to: String(img.key).replace(oldPrefix, newPrefix),
      }));
      const total = copies.length;
      const BATCH_SIZE = 100;
      const copyErrors = [];
      report('正在复制图片到新路径…', 0, total);
      for (let i = 0; i < copies.length; i += BATCH_SIZE) {
        const batch = copies.slice(i, i + BATCH_SIZE);
        const copyResult = await copyImagesInR2(batch);
        if (!copyResult.success || copyResult.errors?.length) {
          if (copyResult.errors?.length) copyErrors.push(...copyResult.errors);
          else copyErrors.push({ error: copyResult.error || 'R2 copy failed' });
        }
        report('正在复制图片到新路径…', Math.min(i + batch.length, total), total);
      }
      if (copyErrors.length > 0) {
        const detail = copyErrors[0]?.error || 'R2 copy failed';
        throw new Error(`Failed to move template images: ${detail}`);
      }

      const keys = objects.map((img) => img.key);
      report('正在删除旧路径图片…', 0, total);
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        const deleteResult = await deleteImagesFromR2(batch, { allowTemplateKeys: true });
        if (!deleteResult.success) {
          throw new Error(deleteResult.error || 'Failed to remove old template image folder');
        }
        report('正在删除旧路径图片…', Math.min(i + batch.length, total), total);
      }

      if (!preloaded_images.length) {
        preloaded_images = objects.map((img) => normalizeMediaEntry({
          url: img.url,
          name: img.name,
          type: img.type,
        })).filter((m) => m?.url);
      }
    }
  }

  preloaded_images = preloaded_images.map((entry) => {
    const next = { ...entry };
    if (next.url) next.url = String(next.url).replace(oldPrefix, newPrefix);
    return normalizeMediaEntry(next);
  }).filter((m) => m?.url);

  report('正在更新数据库…');
  const newRow = applyTemplateFieldUpdates({
    ...row,
    id: normalized,
    preloaded_images,
    preloaded_source: preloaded_images.length ? (row.preloaded_source || 'r2') : row.preloaded_source,
    updated_at: new Date().toISOString(),
  }, updates);

  const { error: insertErr } = await supabase.from('templates').insert(newRow);
  if (insertErr) throw insertErr;

  const { error: projErr } = await supabase
    .from('projects')
    .update({ template_id: normalized, updated_at: new Date().toISOString() })
    .eq('template_id', oldId);
  if (projErr) throw projErr;

  const { error: delErr } = await supabase.from('templates').delete().eq('id', oldId);
  if (delErr) throw delErr;

  return { success: true, id: normalized, renamed: true };
}

/**
 * Admin: permanently delete a template.
 */
export async function deleteTemplate(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

function rowToAdminProject(row) {
  return {
    id:              row.id,
    name:            row.name            || '',
    description:     row.description     || '',
    user_id:         row.user_id         || null,
    template_id:     row.template_id     || null,
    config:          row.survey_config   || {},
    preloadedImages: row.preloaded_images || [],
    preloadedAt:     row.preloaded_at    || null,
    preloadedSource: row.preloaded_source || null,
    created_at:      row.created_at,
    updated_at:      row.updated_at,
  };
}

/**
 * Admin: list all projects across all users.
 * Requires the caller to be in the `admins` table (RLS).
 */
export async function listAllProjects() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) { console.error('listAllProjects:', error); return []; }
    return (data || []).map(rowToAdminProject);
  } catch (err) {
    console.error('listAllProjects exception:', err);
    return [];
  }
}

/**
 * Admin: update any fields on a project without changing ownership.
 * Always .select() so RLS/no-op updates surface as errors (Supabase otherwise
 * returns success with 0 rows).
 */
export async function updateProjectAdmin(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  const row = { updated_at: new Date().toISOString() };
  if ('name'             in updates) row.name              = updates.name;
  if ('description'      in updates) row.description       = updates.description;
  if ('survey_config'    in updates) row.survey_config     = updates.survey_config;
  if ('preloaded_images' in updates) row.preloaded_images  = updates.preloaded_images;
  if ('preloaded_at'     in updates) row.preloaded_at      = updates.preloaded_at;
  if ('preloaded_source' in updates) row.preloaded_source  = updates.preloaded_source;

  const { data, error } = await supabase
    .from('projects')
    .update(row)
    .eq('id', id)
    .select('id, survey_config')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error(
      '保存失败：没有更新到任何项目行（可能是管理员 RLS 未允许更新他人项目）。请检查 Supabase projects 表的 UPDATE 策略。',
    );
  }
  return { success: true, project: data };
}

/**
 * Admin: permanently delete a project.
 */
export async function deleteProjectAdmin(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

async function loadBuiltinTemplateFilenames() {
  const indexRes = await fetch('/project_templates/index.json');
  if (!indexRes.ok) throw new Error('Could not load template index');
  const { templates } = await indexRes.json();
  return [...new Set(templates || [])];
}

/** Resolve id for a built-in JSON template: prefer valid tpl.id, else derive from metadata. */
export function resolveBuiltinTemplateId(tpl) {
  const fromJson = normalizeTemplateId(tpl.id);
  if (fromJson && isValidTemplateId(fromJson)) return fromJson;
  return buildTemplateIdBase({
    name: tpl.name,
    author: tpl.author,
    year: tpl.year,
  });
}

function describeBuiltinTemplateEntry(tpl, filename) {
  const pages = tpl.config?.pages;
  return {
    filename,
    id: resolveBuiltinTemplateId(tpl),
    name: tpl.name || '',
    author: tpl.author || '',
    year: tpl.year || '',
    category: tpl.category || '',
    pageCount: Array.isArray(pages) ? pages.length : 0,
    imageCount: Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages.length : 0,
  };
}

/**
 * Preview which built-in templates would be imported vs skipped (existing id).
 * @param {string[]|null} existingIds - optional pre-fetched template ids
 */
export async function previewBuiltinTemplateImport(existingIds = null) {
  const filenames = await loadBuiltinTemplateFilenames();

  let existingSet;
  if (existingIds) {
    existingSet = new Set(existingIds);
  } else if (supabase) {
    const { data, error } = await supabase.from('templates').select('id');
    if (error) throw error;
    existingSet = new Set((data || []).map((r) => r.id));
  } else {
    existingSet = new Set();
  }

  const toInsert = [];
  const toSkip = [];
  const invalid = [];
  const errors = [];

  for (const filename of filenames) {
    try {
      const res = await fetch(`/project_templates/${filename}`);
      if (!res.ok) {
        errors.push({ filename, reason: '文件不存在或无法加载' });
        continue;
      }
      const tpl = await res.json();
      if (!tpl.name || !tpl.config) {
        invalid.push({ filename, reason: '缺少 name 或 config' });
        continue;
      }

      const meta = describeBuiltinTemplateEntry(tpl, filename);
      if (existingSet.has(meta.id)) {
        toSkip.push({ ...meta, reason: 'ID 已存在' });
      } else {
        toInsert.push(meta);
      }
    } catch (err) {
      errors.push({ filename, reason: err.message });
    }
  }

  const seenIds = new Set();
  const dedupedInsert = [];
  for (const item of toInsert) {
    if (seenIds.has(item.id)) {
      errors.push({ filename: item.filename, reason: `内置模板 ID 重复: ${item.id}` });
      continue;
    }
    seenIds.add(item.id);
    dedupedInsert.push(item);
  }

  return {
    toInsert: dedupedInsert,
    toSkip,
    invalid,
    errors,
    total: filenames.length,
  };
}

/**
 * Seed built-in templates from the static /project_templates/*.json files
 * into Supabase as approved, show-on-landing templates.
 * Skips templates whose id already exists (no update).
 */
export async function seedBuiltinTemplates({ onProgress, idsToImport } = {}) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const filenames = await loadBuiltinTemplateFilenames();
  const idFilter = idsToImport ? new Set(idsToImport) : null;
  let inserted = 0;
  let skipped  = 0;
  const errors = [];

  for (const filename of filenames) {
    try {
      const res = await fetch(`/project_templates/${filename}`);
      if (!res.ok) { errors.push(`${filename}: 无法加载`); continue; }
      const tpl = await res.json();
      if (!tpl.name || !tpl.config) { skipped++; continue; }

      const id = resolveBuiltinTemplateId(tpl);
      if (idFilter && !idFilter.has(id)) continue;

      const { data: existing, error: selectError } = await supabase
        .from('templates')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (selectError) {
        errors.push(`${filename}: ${selectError.message}`);
        continue;
      }

      if (existing) {
        skipped++;
        if (onProgress) {
          onProgress({ inserted, skipped, total: filenames.length, current: filename });
        }
        continue;
      }

      const tags = Array.isArray(tpl.tags) ? [...tpl.tags] : [];
      if (!tags.includes('official')) tags.push('official');

      const row = {
        id,
        name:                tpl.name,
        description:         tpl.description  || '',
        author:              tpl.author       || '',
        year:                tpl.year         || '',
        category:            tpl.category     || 'Academic Research',
        tags,
        paper_url:           tpl.website      || null,
        huggingface_dataset: tpl.huggingfaceDataset || null,
        survey_config:       tpl.config       || {},
        is_approved:         true,
        show_on_landing:     true,
        is_pinned:           !!(tpl.isPinned ?? tpl.is_pinned),
        is_active:           true,
        preloaded_images:    Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages : [],
        preloaded_at:        tpl.preloadedAt  || null,
        preloaded_source:    tpl.preloadedSource || null,
        user_id:             user.id,
        submitter_email:     user.email       || null,
        created_at:          tpl.createdAt    || new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      };

      const { error } = await supabase.from('templates').insert(row);
      if (error) errors.push(`${filename}: ${error.message}`);
      else inserted++;

      if (onProgress) {
        onProgress({ inserted, skipped, total: filenames.length, current: filename });
      }
    } catch (err) {
      errors.push(`${filename}: ${err.message}`);
    }
  }

  return { inserted, skipped, imported: inserted, errors };
}

/**
 * Check whether the current authenticated user is an admin.
 * 1) Supabase `admins` table (source of truth for RLS)
 * 2) Fallback: REACT_APP_ADMIN_EMAILS env allowlist (UI gate only)
 */
export async function checkIsAdmin() {
  if (!supabase) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Prefer DB registry — matches RLS is_platform_admin()
    const { data: adminRow } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (adminRow?.user_id) return true;

    const adminEmails = (process.env.REACT_APP_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    return adminEmails.includes(user.email);
  } catch {
    return false;
  }
}
