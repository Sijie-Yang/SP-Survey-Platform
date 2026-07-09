import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true },
      })
    : null;

// No-op kept for any legacy callers
export const reinitializeSupabase = () => supabase;

export const isSupabaseConfigured = () => supabase !== null;

// ── Auth helpers ──────────────────────────────────────────────────────────────

export const signUp = (email, password) =>
  supabase?.auth.signUp({ email, password });

export const signIn = (email, password) =>
  supabase?.auth.signInWithPassword({ email, password });

export const signOut = () => supabase?.auth.signOut();

export const getSession = () => supabase?.auth.getSession();

export const onAuthStateChange = (callback) =>
  supabase?.auth.onAuthStateChange(callback);

// ── Survey responses ──────────────────────────────────────────────────────────

function generateParticipantId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export async function saveSurveyResponse(completeData) {
  try {
    const participantId = completeData.participant_id || generateParticipantId();
    if (!supabase) {
      const responseData = {
        participant_id: participantId,
        project_id: completeData.project_id || null,
        responses: completeData.responses,
        displayed_images: completeData.displayed_images,
        survey_metadata: completeData.survey_metadata,
        saved_at: new Date().toISOString(),
      };
      const res = await fetch('http://localhost:3001/api/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseData),
      });
      if (res.ok) return { success: true, data: responseData, storage: 'file' };
      throw new Error('File save failed');
    }

    const { data, error } = await supabase.from('survey_responses').insert([
      {
        participant_id: participantId,
        project_id: completeData.project_id || null,
        responses: completeData.responses,
        displayed_images: completeData.displayed_images,
        survey_metadata: completeData.survey_metadata,
      },
    ]);

    if (error) throw error;
    return { success: true, data, storage: 'supabase' };
  } catch (error) {
    console.error('Error saving survey response:', error);
    return { success: false, error };
  }
}

// ── Image storage (Cloudflare R2) ─────────────────────────────────────────────
// These helpers delegate to R2 via the server API.
// The old Supabase Storage bucket ("survey-images") is no longer used.

export async function uploadImage(file) {
  try {
    const { uploadImageToR2 } = await import('./r2');
    const ext = file.name.split('.').pop();
    const key = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
    const result = await uploadImageToR2(file, key);
    if (!result.success) throw new Error(result.error);
    return { success: true, url: result.url, path: result.key, isLocal: false };
  } catch (error) {
    console.error('uploadImage:', error);
    return { success: false, error, isLocal: false, message: error.message };
  }
}

export async function deleteImage(imagePath) {
  try {
    const { deleteImagesFromR2 } = await import('./r2');
    return await deleteImagesFromR2([imagePath]);
  } catch (error) {
    return { success: false, error };
  }
}

export async function syncImagesFromSupabase() {
  try {
    const { listImagesFromR2 } = await import('./r2');
    const result = await listImagesFromR2('');
    if (!result.success) throw new Error(result.error);
    const images = result.images.map((img) => ({
      id: img.key,
      name: img.name,
      url: img.url,
      path: img.key,
      size: img.size || 0,
      type: 'cloud',
      uploadDate: img.lastModified || new Date().toISOString(),
      tags: [],
      isLocal: false,
    }));
    return { success: true, images };
  } catch (error) {
    return { success: false, error, images: [] };
  }
}

// bucketPath here is used as a folder prefix (the bucket-name segment is ignored
// since R2 uses a single bucket configured on the server).
export async function getAllImagesFromSupabase(bucketPath = '') {
  try {
    const { listImagesFromR2 } = await import('./r2');
    // Strip leading bucket-name segment (legacy format: "bucketName/folder/...")
    const parts = bucketPath.split('/');
    const prefix = parts.length > 1 ? parts.slice(1).join('/') : bucketPath;
    const result = await listImagesFromR2(prefix);
    if (!result.success) return { success: false, images: [], message: result.error };
    const images = result.images.map((img) => ({
      name: img.name,
      path: img.key,
      url: img.url,
      size: img.size || 0,
      lastModified: img.lastModified,
    }));
    return { success: true, images, message: `Found ${images.length} images` };
  } catch (error) {
    return { success: false, images: [], message: error.message };
  }
}

export async function checkImageFolderStatus() {
  try {
    const { checkR2Status } = await import('./r2');
    const status = await checkR2Status();
    if (!status.configured) {
      return { success: false, connected: false, bucketExists: false, imageCount: 0, error: 'R2 not configured' };
    }
    return {
      success: status.connected,
      connected: status.connected,
      bucketExists: status.connected,
      imageCount: status.imageCount || 0,
      error: status.error,
    };
  } catch (error) {
    return { success: false, connected: false, bucketExists: false, imageCount: 0, error: error.message };
  }
}

// ── Street images (legacy) ────────────────────────────────────────────────────
export async function getStreetImages() {
  try {
    if (!supabase) return { success: true, data: [] };
    const { data, error } = await supabase.from('street_images').select('*').eq('active', true);
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error };
  }
}
