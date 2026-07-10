/**
 * liveSurveyManager.js
 *
 * Public "Live Surveys" listings with apply → admin approve + time window.
 * Parallel to templateManager.js (templates), but participants always load the
 * live project via /survey?project=… (no survey_config snapshot).
 *
 * Required Supabase SQL (run once in the platform project):
 * ─────────────────────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS live_survey_listings (
 *   id              TEXT PRIMARY KEY,
 *   project_id      TEXT NOT NULL,
 *   user_id         UUID REFERENCES auth.users(id),
 *   submitter_email TEXT,
 *   title           TEXT NOT NULL,
 *   description     TEXT DEFAULT '',
 *   thumbnail_url   TEXT,
 *   category        TEXT DEFAULT 'Custom',
 *   tags            JSONB DEFAULT '[]'::jsonb,
 *   author          TEXT,
 *   online_start    TIMESTAMPTZ,
 *   online_end      TIMESTAMPTZ,
 *   pending_online_start TIMESTAMPTZ,
 *   pending_online_end   TIMESTAMPTZ,
 *   has_pending_window_change BOOLEAN DEFAULT false,
 *   status          TEXT NOT NULL DEFAULT 'pending'
 *                   CHECK (status IN ('pending', 'approved', 'revoked')),
 *   show_on_live    BOOLEAN DEFAULT true,
 *   admin_note      TEXT,
 *   reviewed_at     TIMESTAMPTZ,
 *   reviewed_by     TEXT,
 *   created_at      TIMESTAMPTZ DEFAULT now(),
 *   updated_at      TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS live_survey_listings_project_idx
 *   ON live_survey_listings (project_id);
 * CREATE INDEX IF NOT EXISTS live_survey_listings_status_idx
 *   ON live_survey_listings (status, show_on_live);
 *
 * -- RLS outline (adjust to your admins table / policies):
 * -- Public SELECT where status='approved' AND show_on_live=true
 * -- Authenticated INSERT for own user_id
 * -- Authenticated UPDATE own rows (apply / window-change)
 * -- Admin full access via admins email list + RLS
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from './supabase';

export function computeLiveStatus(listing, now = new Date()) {
  if (!listing) return 'closed';
  const start = listing.online_start ? new Date(listing.online_start) : null;
  const end = listing.online_end ? new Date(listing.online_end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'closed';
  }
  const t = now.getTime();
  if (t < start.getTime()) return 'upcoming';
  if (t > end.getTime()) return 'closed';
  return 'online';
}

function rowToListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    submitter_email: row.submitter_email,
    title: row.title || '',
    description: row.description || '',
    thumbnail_url: row.thumbnail_url || null,
    category: row.category || 'Custom',
    tags: row.tags || [],
    author: row.author || '',
    online_start: row.online_start,
    online_end: row.online_end,
    pending_online_start: row.pending_online_start,
    pending_online_end: row.pending_online_end,
    has_pending_window_change: !!row.has_pending_window_change,
    status: row.status || 'pending',
    show_on_live: row.show_on_live !== false,
    admin_note: row.admin_note || null,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    livePhase: computeLiveStatus(row),
  };
}

function slugId(projectId) {
  const base = String(projectId || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'project';
  return `live-${base}-${Date.now().toString(36)}`;
}

function toIso(localDateTime) {
  if (!localDateTime) return null;
  const d = new Date(localDateTime);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function validateWindow(startIso, endIso) {
  if (!startIso || !endIso) throw new Error('Online start and end are required');
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid online window dates');
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error('Online end must be after online start');
  }
}

/** Public: approved listings for /live (includes upcoming + closed for grey cards). */
export async function listPublicLiveSurveys() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('live_survey_listings')
      .select('*')
      .eq('status', 'approved')
      .eq('show_on_live', true)
      .order('online_start', { ascending: false });
    if (error) {
      console.error('listPublicLiveSurveys:', error);
      return [];
    }
    return (data || []).map(rowToListing);
  } catch (err) {
    console.error('listPublicLiveSurveys exception:', err);
    return [];
  }
}

/** Admin: all listings. */
export async function listAllLiveSurveys() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('live_survey_listings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('listAllLiveSurveys:', error);
      return [];
    }
    return (data || []).map(rowToListing);
  } catch (err) {
    console.error('listAllLiveSurveys exception:', err);
    return [];
  }
}

/** Owner: listings for one project (latest first). */
export async function getLiveListingForProject(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase
      .from('live_survey_listings')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('getLiveListingForProject:', error);
      return null;
    }
    return rowToListing(data);
  } catch (err) {
    console.error('getLiveListingForProject exception:', err);
    return null;
  }
}

/**
 * Gate for SurveyApp: if project has an approved listing with an online
 * window, participation is only allowed while inside that window.
 * Projects with no listing (or revoked-only) stay open by link.
 *
 * @returns {{ gated: boolean, allowed: boolean, listing: object|null, phase: string }}
 */
export async function getProjectLiveAccess(projectId, now = new Date()) {
  if (!supabase || !projectId) {
    return { gated: false, allowed: true, listing: null, phase: 'open' };
  }
  try {
    const { data, error } = await supabase
      .from('live_survey_listings')
      .select('id, project_id, online_start, online_end, status, show_on_live, title')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      return { gated: false, allowed: true, listing: null, phase: 'open' };
    }
    const listing = rowToListing(data);
    const phase = computeLiveStatus(listing, now);
    return {
      gated: true,
      allowed: phase === 'online',
      listing,
      phase,
    };
  } catch (err) {
    console.error('getProjectLiveAccess exception:', err);
    return { gated: false, allowed: true, listing: null, phase: 'open' };
  }
}

/**
 * Researcher: create or update a live listing application.
 * - New / revoked / previously pending: status → pending, window on online_*
 * - Already approved: keep online_* (active), store new window on pending_*,
 *   set has_pending_window_change (study stays online under the old window).
 */
export async function applyLiveListing({
  projectId,
  title,
  description = '',
  thumbnailUrl = null,
  category = 'Custom',
  tags = [],
  author = '',
  onlineStart,
  onlineEnd,
  refreshCardFromProject = true,
}) {
  if (!supabase) throw new Error('Supabase not configured — Live Surveys require the platform mode');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (!projectId) throw new Error('projectId is required');

  const startIso = toIso(onlineStart);
  const endIso = toIso(onlineEnd);
  validateWindow(startIso, endIso);

  const existing = await getLiveListingForProject(projectId);
  const nowIso = new Date().toISOString();
  const tagArr = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);

  const cardFields = refreshCardFromProject ? {
    title: title || 'Untitled Survey',
    description: description || '',
    thumbnail_url: thumbnailUrl || null,
    category: category || 'Custom',
    tags: tagArr,
    author: author || user.email || '',
  } : {};

  if (existing?.status === 'approved') {
    const row = {
      ...cardFields,
      pending_online_start: startIso,
      pending_online_end: endIso,
      has_pending_window_change: true,
      admin_note: null,
      updated_at: nowIso,
    };
    const { error } = await supabase
      .from('live_survey_listings')
      .update(row)
      .eq('id', existing.id);
    if (error) throw error;
    return {
      success: true,
      listing: rowToListing({ ...existing, ...row, id: existing.id, project_id: projectId }),
      mode: 'window_change',
    };
  }

  if (existing && (existing.status === 'pending' || existing.status === 'revoked')) {
    const row = {
      title: title || existing.title || 'Untitled Survey',
      description: description ?? existing.description ?? '',
      thumbnail_url: thumbnailUrl ?? existing.thumbnail_url,
      category: category || existing.category || 'Custom',
      tags: tagArr.length ? tagArr : (existing.tags || []),
      author: author || existing.author || user.email || '',
      online_start: startIso,
      online_end: endIso,
      pending_online_start: null,
      pending_online_end: null,
      has_pending_window_change: false,
      status: 'pending',
      show_on_live: true,
      admin_note: null,
      updated_at: nowIso,
      user_id: user.id,
      submitter_email: user.email || null,
    };
    const { error } = await supabase
      .from('live_survey_listings')
      .update(row)
      .eq('id', existing.id);
    if (error) throw error;
    return {
      success: true,
      listing: rowToListing({ ...existing, ...row, id: existing.id, project_id: projectId }),
      mode: 'reapply',
    };
  }

  const id = slugId(projectId);
  const row = {
    id,
    project_id: projectId,
    user_id: user.id,
    submitter_email: user.email || null,
    title: title || 'Untitled Survey',
    description: description || '',
    thumbnail_url: thumbnailUrl || null,
    category: category || 'Custom',
    tags: tagArr,
    author: author || user.email || '',
    online_start: startIso,
    online_end: endIso,
    pending_online_start: null,
    pending_online_end: null,
    has_pending_window_change: false,
    status: 'pending',
    show_on_live: true,
    admin_note: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { error } = await supabase.from('live_survey_listings').insert(row);
  if (error) throw error;
  return { success: true, listing: rowToListing(row), mode: 'create' };
}

/** Admin: approve listing or pending window change. */
export async function approveLiveListing(id, reviewerEmail = null) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: existing, error: fetchErr } = await supabase
    .from('live_survey_listings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error('Listing not found');

  const nowIso = new Date().toISOString();
  const row = {
    status: 'approved',
    show_on_live: existing.show_on_live !== false,
    reviewed_at: nowIso,
    reviewed_by: reviewerEmail,
    admin_note: null,
    updated_at: nowIso,
    has_pending_window_change: false,
    pending_online_start: null,
    pending_online_end: null,
  };

  if (existing.has_pending_window_change
    && existing.pending_online_start
    && existing.pending_online_end) {
    row.online_start = existing.pending_online_start;
    row.online_end = existing.pending_online_end;
  }

  const { error } = await supabase.from('live_survey_listings').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
}

/** Admin: revoke (remove from live, not deleted). */
export async function revokeLiveListing(id, adminNote = null, reviewerEmail = null) {
  if (!supabase) throw new Error('Supabase not configured');
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('live_survey_listings')
    .update({
      status: 'revoked',
      show_on_live: false,
      has_pending_window_change: false,
      pending_online_start: null,
      pending_online_end: null,
      admin_note: adminNote,
      reviewed_at: nowIso,
      reviewed_by: reviewerEmail,
      updated_at: nowIso,
    })
    .eq('id', id);
  if (error) throw error;
  return { success: true };
}

/** Admin: reject a pending application (back to revoked-style, or keep pending with note). */
export async function rejectLiveListing(id, adminNote = null, reviewerEmail = null) {
  return revokeLiveListing(id, adminNote || 'Rejected by admin', reviewerEmail);
}

export async function updateLiveListing(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  const row = { updated_at: new Date().toISOString() };
  if ('show_on_live' in updates) row.show_on_live = !!updates.show_on_live;
  if ('admin_note' in updates) row.admin_note = updates.admin_note;
  if ('title' in updates) row.title = updates.title;
  if ('description' in updates) row.description = updates.description;
  if ('thumbnail_url' in updates) row.thumbnail_url = updates.thumbnail_url;
  if ('category' in updates) row.category = updates.category;
  if ('tags' in updates) row.tags = updates.tags;
  if ('online_start' in updates) row.online_start = updates.online_start;
  if ('online_end' in updates) row.online_end = updates.online_end;
  const { error } = await supabase.from('live_survey_listings').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function deleteLiveListing(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('live_survey_listings').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

/** Format for UI inputs (datetime-local). */
export function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLiveWindow(startIso, endIso) {
  const fmt = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}
