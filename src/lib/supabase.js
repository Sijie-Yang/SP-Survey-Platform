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
    if (!supabase) {
      // Fallback: save via local Express backend
      const responseData = {
        participant_id: generateParticipantId(),
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
        participant_id: generateParticipantId(),
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

// ── Image storage ─────────────────────────────────────────────────────────────

export async function uploadImage(file) {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const ext = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
    const { error } = await supabase.storage
      .from('survey-images')
      .upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage
      .from('survey-images')
      .getPublicUrl(fileName);
    return { success: true, url: publicUrl, path: fileName, isLocal: false };
  } catch (error) {
    console.error('uploadImage:', error);
    return { success: false, error, isLocal: false, message: error.message };
  }
}

export async function deleteImage(imagePath) {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.storage.from('survey-images').remove([imagePath]);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

export async function syncImagesFromSupabase() {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data: files, error } = await supabase.storage
      .from('survey-images')
      .list('', { limit: 10000, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    const images = files.map((file) => {
      const { data: { publicUrl } } = supabase.storage
        .from('survey-images')
        .getPublicUrl(file.name);
      return {
        id: file.id || Date.now() + Math.random(),
        name: file.name,
        url: publicUrl,
        path: file.name,
        size: file.metadata?.size || 0,
        type: 'cloud',
        uploadDate: file.created_at || new Date().toISOString(),
        tags: [],
        isLocal: false,
      };
    });
    return { success: true, images };
  } catch (error) {
    return { success: false, error, images: [] };
  }
}

export async function getAllImagesFromSupabase(bucketPath = 'survey-images') {
  try {
    if (!supabase) return { success: false, images: [], message: 'Supabase not configured' };
    const parts = bucketPath.split('/');
    const bucketName = parts[0];
    const folderPath = parts.slice(1).join('/');
    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list(folderPath, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });
    if (error) return { success: false, images: [], message: error.message };
    const imageFiles = files.filter(
      (f) => f.name && !f.name.endsWith('/') && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name)
    );
    const images = imageFiles.map((file) => {
      const filePath = folderPath ? `${folderPath}/${file.name}` : file.name;
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
      return {
        name: file.name,
        path: filePath,
        url: urlData.publicUrl,
        size: file.metadata?.size || 0,
        lastModified: file.updated_at || file.created_at,
      };
    });
    return { success: true, images, message: `Found ${images.length} images` };
  } catch (error) {
    return { success: false, images: [], message: error.message };
  }
}

export async function checkImageFolderStatus() {
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data: buckets, error: be } = await supabase.storage.listBuckets();
    if (be) throw be;
    const bucket = buckets.find((b) => b.name === 'survey-images');
    if (!bucket) return { success: true, connected: true, bucketExists: false, imageCount: 0 };
    const { data: files, error: fe } = await supabase.storage
      .from('survey-images')
      .list('', { limit: 10000 });
    if (fe) throw fe;
    const imageFiles = files.filter(
      (f) => f.name && !f.name.endsWith('/') && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name)
    );
    return { success: true, connected: true, bucketExists: true, imageCount: imageFiles.length };
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
