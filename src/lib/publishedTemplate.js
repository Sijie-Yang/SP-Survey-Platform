import { supabase } from './supabase';
import { loadBundledMediaEntries } from './templateCover';

/** Shape shared by the bundled JSON files and the wiki preview. */
export function publishedTemplateFromRow(row) {
  if (!row?.survey_config?.pages) return null;
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    author: row.author || '',
    year: row.year || '',
    category: row.category || '',
    website: row.paper_url || null,
    huggingfaceDataset: row.huggingface_dataset || row.dataset || null,
    thumbnail_url: row.thumbnail_url || null,
    thumbnailUrl: row.thumbnail_url || null,
    config: row.survey_config,
    preloadedImages: Array.isArray(row.preloaded_images) ? row.preloaded_images : [],
    imageDatasetConfig: row.image_dataset_config || {},
    source: 'online',
  };
}

async function fetchOnlineTemplate(id) {
  if (!supabase || !id) return null;
  try {
    const query = supabase
      .from('templates')
      .select('id, name, description, author, year, category, paper_url, dataset, huggingface_dataset, thumbnail_url, survey_config, preloaded_images, image_dataset_config')
      .eq('id', id)
      .eq('is_approved', true)
      .maybeSingle();
    const result = await Promise.race([
      query,
      new Promise((resolve) => { setTimeout(() => resolve(null), 8000); }),
    ]);
    if (!result || result.error) return null;
    return publishedTemplateFromRow(result.data);
  } catch {
    return null;
  }
}

/**
 * Live approved template first, including its media library.
 * The bundled JSON is the fallback when that row is missing.
 */
export async function fetchPublishedTemplate(id, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const online = await fetchOnlineTemplate(id);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (online) return online;
  const res = await fetch(`/project_templates/${id}.json`, { signal, cache: 'no-store' });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) throw new Error('Template unavailable');
  const template = await res.json();
  if (!template?.config?.pages) throw new Error('Invalid template');
  const preloadedImages = Array.isArray(template.preloadedImages) ? template.preloadedImages : [];
  const bundled = preloadedImages.length ? [] : await loadBundledMediaEntries(id);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return {
    ...template,
    preloadedImages: preloadedImages.length ? preloadedImages : bundled,
    source: 'bundled',
  };
}
