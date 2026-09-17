import { supabaseRest } from '../supabaseUserClient.mjs';
import { listPrefixMedia } from '../agent/r2AgentMedia.mjs';

export const PREVIEW_MEDIA_PREFIX = 'skill-preview/';

function folderFromKey(key = '') {
  const trimmed = String(key || '').replace(/^skill-preview\//, '');
  const parts = trimmed.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export async function loadPreviewMediaLibrary(env) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/preview_media_library',
      serviceRole: true,
      query: '?id=eq.shared&select=revision,preloaded_images,image_dataset_config',
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    const images = Array.isArray(row?.preloaded_images) ? row.preloaded_images.filter((img) => img?.url) : [];
    if (Number(row?.revision) > 0 && images.length) {
      return {
        images,
        dataset: row.image_dataset_config || {},
        revision: row.revision,
      };
    }
  } catch {
    // Preview library table may be missing locally; fall back to the R2 prefix.
  }
  try {
    const listed = await listPrefixMedia(env, PREVIEW_MEDIA_PREFIX);
    const images = (listed?.objects || [])
      .filter((item) => item?.url)
      .map((item) => ({
        url: item.url,
        name: item.name || String(item.key || '').split('/').pop(),
        key: item.key,
        folder: folderFromKey(item.key),
      }));
    return { images, dataset: {}, revision: 0 };
  } catch {
    return { images: [], dataset: {}, revision: 0 };
  }
}
