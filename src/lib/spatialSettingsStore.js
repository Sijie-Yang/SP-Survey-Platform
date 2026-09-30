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

async function loadRawUserSettings(userId) {
  const { data, error } = await supabase
    .from('user_spatial_settings')
    .select('settings_json')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.settings_json;
  return raw && typeof raw === 'object' ? raw : {};
}

/** Upsert user-level spatial settings, keeping other keys (e.g. the Mapillary token). */
export async function saveUserSpatialSettings(userId, spatial) {
  if (!supabase || !userId) return { success: false, skipped: true };
  try {
    const existing = await loadRawUserSettings(userId).catch(() => ({}));
    const settings = { ...existing, ...pickSpatialSettings(spatial) };
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

const MAPILLARY_LOCAL_KEY = 'sp-mapillary-token';

/**
 * Mapillary client token lives on the user row (RLS: owner only), never in project
 * data, because project image_dataset_config is readable by participants.
 * Without Supabase (local dev) it falls back to this browser's localStorage.
 */
export async function loadUserMapillaryToken(userId) {
  if (!supabase || !userId) {
    try { return localStorage.getItem(MAPILLARY_LOCAL_KEY) || ''; } catch { return ''; }
  }
  try {
    const raw = await loadRawUserSettings(userId);
    return String(raw.mapillaryAccessToken || '').trim();
  } catch (err) {
    console.warn('loadUserMapillaryToken:', err.message || err);
    return '';
  }
}

export async function saveUserMapillaryToken(userId, token) {
  const value = String(token || '').trim();
  if (!supabase || !userId) {
    try { localStorage.setItem(MAPILLARY_LOCAL_KEY, value); } catch { /* ignore */ }
    return { success: true, local: true };
  }
  try {
    const existing = await loadRawUserSettings(userId).catch(() => ({}));
    const { error } = await supabase.from('user_spatial_settings').upsert({
      user_id: userId,
      settings_json: { ...existing, mapillaryAccessToken: value },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn('saveUserMapillaryToken:', err.message || err);
    return { success: false, error: err.message || String(err) };
  }
}
