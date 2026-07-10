/**
 * Spatial Intelligence settings persistence:
 * 1) Project imageDatasetConfig (HF for SegFormer; fal for Media Dataset SAM pre-annotate)
 * 2) User-level user_spatial_settings (follows login across computers)
 * enableSamAssist is always forced false for live surveys.
 */
import { supabase } from './supabase';

export const SPATIAL_SETTINGS_KEYS = [
  'falApiKey',
  'huggingFaceToken',
  'enableSamAssist',
];

export function pickSpatialSettings(cfg = {}) {
  return {
    falApiKey: String(cfg.falApiKey || '').trim(),
    huggingFaceToken: String(cfg.huggingFaceToken || '').trim(),
    enableSamAssist: !!cfg.enableSamAssist,
  };
}

export function mergeSpatialIntoConfig(imageDatasetConfig, spatial) {
  return {
    ...(imageDatasetConfig || {}),
    ...pickSpatialSettings(spatial),
  };
}

/** Load user-level spatial settings (cross-device when logged into Supabase). */
export async function loadUserSpatialSettings(userId) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('user_spatial_settings')
      .select('settings_json')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    const raw = data?.settings_json;
    if (!raw || typeof raw !== 'object') return null;
    return pickSpatialSettings(raw);
  } catch (err) {
    // Table may not exist yet
    console.warn('loadUserSpatialSettings:', err.message || err);
    return null;
  }
}

/** Upsert user-level spatial settings. */
export async function saveUserSpatialSettings(userId, spatial) {
  if (!supabase || !userId) return { success: false, skipped: true };
  const settings = pickSpatialSettings(spatial);
  try {
    const { error } = await supabase.from('user_spatial_settings').upsert({
      user_id: userId,
      settings_json: settings,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('saveUserSpatialSettings:', err.message || err);
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Prefer project values when set; fill gaps from user-level defaults.
 */
export function coalesceSpatialSettings(projectCfg, userSettings) {
  const p = projectCfg || {};
  const u = userSettings || {};
  return {
    falApiKey: String(p.falApiKey || u.falApiKey || '').trim(),
    huggingFaceToken: String(p.huggingFaceToken || u.huggingFaceToken || '').trim(),
    enableSamAssist: p.enableSamAssist != null ? !!p.enableSamAssist : !!u.enableSamAssist,
  };
}
