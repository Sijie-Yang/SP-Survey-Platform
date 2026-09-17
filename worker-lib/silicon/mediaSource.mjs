import { loadPreviewMediaLibrary } from './previewMedia.mjs';

export async function resolveSiliconMediaSnapshot(env, {
  projectImages,
  dataset,
  sourceKind = 'draft',
} = {}) {
  const images = Array.isArray(projectImages) ? projectImages.filter((img) => img && (img.url || img.path)) : [];
  if (images.length) {
    return {
      source: 'project',
      images,
      dataset: dataset || {},
      availableCount: images.length,
      revision: null,
    };
  }
  if (sourceKind === 'published') {
    return {
      source: 'published',
      images: [],
      dataset: dataset || {},
      availableCount: 0,
      revision: null,
    };
  }
  const preview = await loadPreviewMediaLibrary(env);
  return {
    source: preview.images.length ? 'preview_library' : 'none',
    images: preview.images,
    dataset: preview.dataset || dataset || {},
    availableCount: preview.images.length,
    revision: preview.revision ?? null,
  };
}
