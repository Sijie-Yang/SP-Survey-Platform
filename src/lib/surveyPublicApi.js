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
        // No μ from the server means no rating yet; adaptive sampling then balances exposure.
        mu: row.mu != null && Number.isFinite(Number(row.mu)) ? Number(row.mu) : null,
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
 * Anonymous RPC: the design version done least often, recorded as started.
 * null when the RPC is missing or fails; the caller then picks a version itself.
 */
export async function claimDesignVersion(projectId, designId, versions) {
  if (!supabase || !projectId || !designId || !versions) return null;
  try {
    const { data, error } = await supabase.rpc('claim_design_version', {
      p_project_id: projectId,
      p_design_id: designId,
      p_versions: versions,
    });
    if (error) throw error;
    const version = Number(data?.version);
    if (!Number.isInteger(version) || version < 0 || version >= versions) return null;
    return { version, claimId: data?.claim_id ? String(data.claim_id) : null };
  } catch (err) {
    console.warn('claimDesignVersion failed:', err.message);
    return null;
  }
}
