import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { filterMediaByType, inferMediaType } from './mediaUtils';
import { listPreviewMedia } from './previewMediaLibrary';
import { supabase } from './supabase';

export const DEFAULT_TEMPLATE_COVER = '/hero/streetscape-poster.jpg';
export const TEMPLATE_COVER_DIR = '/project_templates/cover_images';

/** Stable hash so the same template keeps the same fallback cover across reloads. */
export function hashString(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function collectImageUrls(preloadedImages) {
  if (!Array.isArray(preloadedImages)) return [];
  const urls = [];
  for (const entry of preloadedImages) {
    const url = entry?.url;
    if (!url) continue;
    const type = entry.type || inferMediaType(entry.name || url);
    if (type === 'image') urls.push(url);
  }
  return urls;
}

/**
 * Cover file, then the template's chosen thumbnail, then one image from its
 * own media library, then bundled extras, then the shared preview library.
 * Picks are stable per template id.
 */
export function resolveTemplateCover(template, {
  coverFile,
  extraLibraryUrls = [],
  presetUrls = [],
} = {}) {
  if (coverFile) {
    return String(coverFile).startsWith('/') ? coverFile : `${TEMPLATE_COVER_DIR}/${coverFile}`;
  }
  const chosen = template?.thumbnail_url || template?.thumbnailUrl;
  if (chosen) return chosen;
  const own = collectImageUrls(template?.preloaded_images || template?.preloadedImages);
  const bundled = extraLibraryUrls.filter(Boolean);
  // Keep the template's own images ahead of bundled extras. Hashing them as one
  // pool let a bundled URL replace a stored library image (id "study" picks index 1).
  const pool = own.length ? own : (bundled.length ? bundled : presetUrls);
  if (!pool.length) return DEFAULT_TEMPLATE_COVER;
  return pool[hashString(template?.id || template?.name) % pool.length] || DEFAULT_TEMPLATE_COVER;
}

let coverIndexPromise;
export function loadCoverIndex() {
  if (!coverIndexPromise) {
    coverIndexPromise = fetch(`${TEMPLATE_COVER_DIR}/index.json`)
      .then((res) => (res.ok ? res.json() : { covers: {} }))
      .then((data) => (data && typeof data.covers === 'object' && data.covers) || {})
      .catch(() => ({}));
  }
  return coverIndexPromise;
}

const manifestCache = new Map();

export async function loadBundledMediaEntries(id) {
  if (!id) return [];
  if (!manifestCache.has(id)) {
    manifestCache.set(id, (async () => {
      try {
        const res = await fetch(`/project_templates/${id}/images.json`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.images)) return [];
        return data.images.filter(Boolean).map((rel) => {
          const parts = String(rel).split('/').filter(Boolean);
          const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          return {
            url: `/project_templates/${id}/${rel}`,
            name: parts[parts.length - 1] || String(rel),
            key: `builtin/${id}/${rel}`,
            type: 'image',
            ...(folder ? { folder } : {}),
          };
        });
      } catch {
        return [];
      }
    })());
  }
  return manifestCache.get(id);
}

let presetPromise;
function loadPresetUrls() {
  if (!presetPromise) {
    presetPromise = listPreviewMedia()
      .then((items) => filterMediaByType(items, 'image').map((img) => img.url).filter(Boolean))
      .catch(() => []);
  }
  return presetPromise;
}

function uniqueUrls(urls) {
  const seen = new Set();
  const list = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    list.push(url);
  }
  return list;
}

/** Ordered covers: dedicated file, saved thumbnail, template library, bundled files, preset. */
export async function coverCandidatesForTemplate(template, presetUrls = [], coverIndex = {}) {
  const id = template?.id;
  const coverFile = coverIndex?.[id];
  const own = collectImageUrls(template?.preloaded_images || template?.preloadedImages);
  const bundledEntries = coverFile ? [] : await loadBundledMediaEntries(id);
  const bundled = bundledEntries.map((entry) => entry.url);
  const stable = (urls) => (urls.length ? urls[hashString(id || template?.name) % urls.length] : '');
  return uniqueUrls([
    coverFile ? (String(coverFile).startsWith('/') ? coverFile : `${TEMPLATE_COVER_DIR}/${coverFile}`) : '',
    template?.thumbnail_url || template?.thumbnailUrl || '',
    stable(own),
    stable(bundled),
    stable(presetUrls),
    DEFAULT_TEMPLATE_COVER,
  ]);
}

export async function resolveCovers(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const [coverIndex, presetUrls] = await Promise.all([loadCoverIndex(), loadPresetUrls()]);
  const online = {};
  if (supabase && list.length) {
    try {
      const { data, error } = await supabase
        .from('templates')
        .select('id, thumbnail_url, preloaded_images')
        .in('id', list);
      if (!error) {
        for (const row of data || []) online[row.id] = row;
      }
    } catch {
      // Covers still resolve from cover files and the bundled library.
    }
  }
  const covers = {};
  await Promise.all(list.map(async (id) => {
    const row = online[id] || {};
    covers[id] = await coverCandidatesForTemplate({
      id,
      thumbnail_url: row.thumbnail_url,
      preloaded_images: row.preloaded_images,
    }, presetUrls, coverIndex);
  }));
  return covers;
}

export function TemplateCoverImage({ candidates, alt, sx }) {
  const { src, onError } = useCoverCandidate(candidates);
  return <Box component="img" src={src} alt={alt || ''} onError={onError} sx={sx} />;
}

export function useCoverCandidate(candidates) {
  const list = candidates?.length ? candidates : [DEFAULT_TEMPLATE_COVER];
  const key = list.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [key]);
  const src = list[Math.min(index, list.length - 1)];
  const onError = () => setIndex((current) => (current + 1 < list.length ? current + 1 : current));
  return { src, onError };
}

export function useResolvedCovers(ids) {
  const key = (ids || []).filter(Boolean).join('|');
  const [covers, setCovers] = useState({});
  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split('|') : [];
    if (!list.length) return undefined;
    resolveCovers(list).then((next) => { if (!cancelled) setCovers(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [key]);
  return covers;
}
