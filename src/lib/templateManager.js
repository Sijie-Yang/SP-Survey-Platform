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
 * Required Supabase SQL additions for template image folders (run once):
 * ─────────────────────────────────────────────────────────────────────
 * ALTER TABLE templates
 *   ADD COLUMN IF NOT EXISTS preloaded_images JSONB DEFAULT '[]'::jsonb,
 *   ADD COLUMN IF NOT EXISTS preloaded_at     TIMESTAMPTZ,
 *   ADD COLUMN IF NOT EXISTS preloaded_source TEXT;
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from './supabase';

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
        'is_approved, show_on_landing, preloaded_images, preloaded_at, ' +
        'preloaded_source, created_at, updated_at'
      )
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
        'is_approved, show_on_landing, preloaded_images, preloaded_at, ' +
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
  const row = { updated_at: new Date().toISOString() };
  if ('is_approved'     in updates) row.is_approved     = updates.is_approved;
  if ('show_on_landing' in updates) {
    row.show_on_landing = updates.show_on_landing;
    row.is_active       = updates.show_on_landing; // keep legacy is_active in sync
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

  const { error } = await supabase.from('templates').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
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

  const { error } = await supabase.from('projects').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
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

/**
 * Seed built-in templates from the static /project_templates/*.json files
 * into Supabase as approved, show-on-landing templates.
 * Intended for initial one-time setup via AdminDashboard.
 */
export async function seedBuiltinTemplates(onProgress) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch the index file listing all built-in template filenames
  const indexRes = await fetch('/project_templates/index.json');
  if (!indexRes.ok) throw new Error('Could not load template index');
  const { templates: filenames } = await indexRes.json();

  let imported = 0;
  let skipped  = 0;
  const errors = [];

  for (const filename of filenames) {
    try {
      const res = await fetch(`/project_templates/${filename}`);
      if (!res.ok) { errors.push(filename); continue; }
      const tpl = await res.json();
      if (!tpl.id || !tpl.name || !tpl.config) { skipped++; continue; }

      const row = {
        id:                  tpl.id,
        name:                tpl.name,
        description:         tpl.description  || '',
        author:              tpl.author       || '',
        year:                tpl.year         || '',
        category:            tpl.category     || 'Academic Research',
        tags:                Array.isArray(tpl.tags) ? tpl.tags : [],
        paper_url:           tpl.website      || null,
        huggingface_dataset: tpl.huggingfaceDataset || null,
        survey_config:       tpl.config       || {},
        preloaded_images:    Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages : [],
        preloaded_at:        tpl.preloadedAt  || null,
        preloaded_source:    tpl.preloadedSource || null,
        user_id:             user.id,
        submitter_email:     user.email       || null,
        is_approved:         true,
        show_on_landing:     true,
        is_active:           true,
        created_at:          tpl.createdAt    || new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      };

      const { error } = await supabase
        .from('templates')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: false });
      if (error) { errors.push(`${filename}: ${error.message}`); }
      else { imported++; }

      if (onProgress) onProgress({ imported, total: filenames.length, current: filename });
    } catch (err) {
      errors.push(`${filename}: ${err.message}`);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Check whether the current authenticated user is an admin.
 * Two-layer check:
 *   1. Frontend gate: email in REACT_APP_ADMIN_EMAILS env var
 *   2. (Rely on Supabase RLS for actual DB enforcement)
 */
export async function checkIsAdmin() {
  if (!supabase) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const adminEmails = (process.env.REACT_APP_ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);
    return adminEmails.includes(user.email);
  } catch {
    return false;
  }
}
