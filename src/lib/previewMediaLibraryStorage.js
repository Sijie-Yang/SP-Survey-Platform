import { supabase } from './supabase';
import { sanitizeMediaFolderConfig } from './mediaUtils';
import { serializeMediaLibraryEntry } from './mediaLibrarySync';

const PREFIX = 'skill-preview/';
export const LEGACY_PREVIEW_CONFIG_KEY = 'sp-preview-media-library-config';

export function previewLibraryStorageError(error) {
  const code = error?.code;
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) {
    return new Error('预览媒体库云端存储尚未初始化，请先在 Supabase 运行 supabase/preview_media_library.sql，然后重试。');
  }
  if (code === '40001') return new Error('媒体库已在其他页面更新，本次修改未保存。请重新加载云端记录后重试。');
  return new Error(error?.message || '无法保存预览媒体库，请重试。');
}

function requireStorage() {
  if (!supabase) throw new Error('尚未配置 Supabase，无法读取或保存预览媒体库。');
}

export function previewLibraryOwner(row) {
  return {
    id: 'preview-media',
    revision: row.revision,
    preloadedImages: row.preloaded_images || [],
    imageDatasetConfig: sanitizeMediaFolderConfig(row.image_dataset_config),
    preloadedSource: 'r2',
    preloadedAt: row.updated_at,
  };
}

export async function loadPreviewMediaLibrary() {
  requireStorage();
  const { data, error } = await supabase.from('preview_media_library')
    .select('revision,preloaded_images,image_dataset_config,updated_at').eq('id', 'shared').single();
  if (error) throw previewLibraryStorageError(error);
  return previewLibraryOwner(data);
}

export async function savePreviewMediaLibrary(owner, payload) {
  requireStorage();
  const images = payload.preloaded_images ?? owner.preloadedImages;
  const config = payload.image_dataset_config ?? owner.imageDatasetConfig;
  const { data, error } = await supabase.rpc('save_preview_media_library', {
    p_expected_revision: owner.revision,
    p_images: images.map((entry) => serializeMediaLibraryEntry(entry, PREFIX)),
    p_config: sanitizeMediaFolderConfig(config),
  });
  if (error) throw previewLibraryStorageError(error);
  return previewLibraryOwner(data);
}

/** Only an uninitialized cloud library may inherit this browser's legacy tags. */
export function withLegacyPreviewConfig(owner) {
  if (owner.revision !== 0) return owner;
  try {
    const raw = localStorage.getItem(LEGACY_PREVIEW_CONFIG_KEY);
    return raw ? { ...owner, imageDatasetConfig: sanitizeMediaFolderConfig(JSON.parse(raw)) } : owner;
  } catch { return owner; }
}
