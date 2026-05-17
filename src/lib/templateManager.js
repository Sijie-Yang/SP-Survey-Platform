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
        'is_approved, show_on_landing, created_at, updated_at'
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

  const year      = template.year || String(new Date().getFullYear());
  const firstWord = (template.name || 'template').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const id        = template.id || `${year}-${firstWord}-${Date.now().toString(36)}`;

  const row = {
    id,
    name:                template.name        || 'Untitled Template',
    description:         template.description || '',
    author:              template.author      || user.email || 'User',
    year,
    category:            template.category    || 'Custom',
    tags:                Array.isArray(template.tags) ? template.tags : [],
    paper_url:           template.website     || null,
    huggingface_dataset: template.huggingfaceDataset || null,
    survey_config:       template.config      || {},
    user_id:             user.id,
    submitter_email:     user.email           || null,
    is_approved:         false,
    show_on_landing:     false,
    is_active:           false,
    created_at:          new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  };

  const { error } = await supabase.from('templates').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return { success: true, template: rowToTemplate(row) };
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

/**
 * Admin: list all projects across all users.
 * Requires the caller to be in the `admins` table (RLS).
 */
export async function listAllProjects() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, user_id, created_at, updated_at, template_id')
      .order('updated_at', { ascending: false });
    if (error) { console.error('listAllProjects:', error); return []; }
    return data || [];
  } catch (err) {
    console.error('listAllProjects exception:', err);
    return [];
  }
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
