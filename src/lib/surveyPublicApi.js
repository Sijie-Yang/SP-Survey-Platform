import { supabase } from './supabase';

/** Anonymous RPC: count completed responses for a project (quota check). */
export async function countProjectResponses(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('count_responses', { p_project_id: projectId });
    if (error) throw error;
    return typeof data === 'number' ? data : Number(data) || 0;
  } catch (err) {
    console.warn('countProjectResponses failed:', err.message);
    return null;
  }
}

/** Anonymous RPC: completed responses per condition; null when unavailable (falls back to weighted random). */
export async function fetchConditionCounts(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('count_condition_responses', { p_project_id: projectId });
    if (error) throw error;
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('fetchConditionCounts failed:', err.message);
    return null;
  }
}

/** Anonymous RPC: per-image exposure / win stats for balanced & adaptive sampling. */
export async function fetchPairStats(projectId) {
  if (!supabase || !projectId) return null;
  try {
    const { data, error } = await supabase.rpc('get_pair_stats', { p_project_id: projectId });
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      const key = row.image_key || row.imageKey;
      if (!key) return;
      map[key] = {
        exposures: Number(row.exposures) || 0,
        wins: Number(row.wins) || 0,
        losses: Number(row.losses) || 0,
        mu: row.mu != null ? Number(row.mu) : 25,
        sigma: row.sigma != null ? Number(row.sigma) : null,
      };
    });
    return map;
  } catch (err) {
    console.warn('fetchPairStats failed:', err.message);
    return null;
  }
}

/**
 * Anonymous RPC: has this recruitment-platform participant already completed the project?
 * null when the check is unavailable (supabase/recruitment.sql not run, offline); the
 * submission RPC still keeps only one response per platform id.
 */
export async function recruitmentParticipantDone(projectId, platform, participant) {
  if (!supabase || !projectId || !platform || !participant) return null;
  try {
    const { data, error } = await supabase.rpc('recruitment_participant_done', {
      p_project_id: projectId, p_platform: platform, p_participant: participant,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.warn('recruitmentParticipantDone failed:', err.message);
    return null;
  }
}
