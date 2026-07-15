/**
 * Admin store for survey_design_requests (RLS: is_platform_admin).
 */
import { supabase } from './supabase';

export const SURVEY_DESIGN_STATUSES = ['pending', 'in_progress', 'done', 'declined'];

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

export function isMissingSurveyDesignTable(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('survey_design_requests')
    && (
      msg.includes('does not exist')
      || msg.includes('could not find')
      || msg.includes('schema cache')
      || error?.code === '42P01'
      || error?.code === 'PGRST205'
    )
  );
}

function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    contactName: row.contact_name,
    email: row.email,
    affiliation: row.affiliation || '',
    studyTitle: row.study_title,
    researchBrief: row.research_brief || '',
    stimulusTypes: Array.isArray(row.stimulus_types) ? row.stimulus_types : [],
    timeline: row.timeline || '',
    relatedUrl: row.related_url || '',
    notes: row.notes || '',
    mediaFiles: Array.isArray(row.media_files) ? row.media_files : [],
    supplementaryFiles: Array.isArray(row.supplementary_files) ? row.supplementary_files : [],
    status: row.status || 'pending',
    adminNotes: row.admin_notes || '',
    editKey: row.edit_key,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSurveyDesignRequests() {
  const db = requireSupabase();
  const { data, error } = await db
    .from('survey_design_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    const err = new Error(error.message || String(error));
    err.code = error.code;
    err.missingTable = isMissingSurveyDesignTable(error);
    throw err;
  }
  return (data || []).map(rowToRequest);
}

export async function updateSurveyDesignRequest(id, updates = {}) {
  const db = requireSupabase();
  const patch = { updated_at: new Date().toISOString() };
  if ('status' in updates) {
    patch.status = updates.status;
    if (updates.status && updates.status !== 'pending') {
      patch.reviewed_at = updates.reviewedAt || new Date().toISOString();
    }
  }
  if ('adminNotes' in updates) patch.admin_notes = updates.adminNotes;
  if ('reviewedAt' in updates) patch.reviewed_at = updates.reviewedAt;

  const { data, error } = await db
    .from('survey_design_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return rowToRequest(data);
}

export async function deleteSurveyDesignRequest(id) {
  const db = requireSupabase();
  const { error } = await db
    .from('survey_design_requests')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
