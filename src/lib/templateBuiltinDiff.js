/**
 * Diff helpers for「导入内置模板」preview: compare static builtin JSON
 * against the live Supabase template row (what seed would overwrite).
 */

import { sanitizeMediaFolderConfig } from './mediaUtils';

/** Stable JSON for deep equality (sorted object keys). */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Tags as seed would write them (always includes `official`). */
export function normalizeBuiltinCompareTags(tags) {
  const list = Array.isArray(tags) ? tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
  if (!list.includes('official')) list.push('official');
  return [...new Set(list)].sort();
}

/** Tags currently stored online (do not invent `official`). */
export function normalizeOnlineCompareTags(tags) {
  const list = Array.isArray(tags) ? tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
  return [...new Set(list)].sort();
}

function truncate(text, max = 80) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function summarizeScalar(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  return truncate(value);
}

function countQuestions(config) {
  const pages = config?.pages;
  if (!Array.isArray(pages)) return 0;
  let n = 0;
  pages.forEach((page) => {
    const qs = page?.questions || page?.elements || [];
    if (Array.isArray(qs)) n += qs.length;
  });
  return n;
}

function summarizeConfig(config) {
  const pages = Array.isArray(config?.pages) ? config.pages.length : 0;
  const questions = countQuestions(config);
  const title = config?.title ? truncate(config.title, 48) : '—';
  return `${pages} 页 / ${questions} 题 · title: ${title}`;
}

const SECRET_KEY_RE = /token|secret|password|passwd|api[_-]?key|credential|authorization|private[_-]?key|access[_-]?key/i;

function stripSecretKeys(value) {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach((k) => {
    if (SECRET_KEY_RE.test(k)) return;
    out[k] = stripSecretKeys(value[k]);
  });
  return out;
}

/**
 * Template `image_dataset_config` as carried through builtin export/import:
 * every key is kept (minus secret-looking ones, since builtin JSON is public),
 * and the folder/tag subset is normalized like sanitizeMediaFolderConfig.
 */
export function normalizeTemplateImageDatasetConfig(cfg) {
  const base = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? stripSecretKeys(cfg) : {};
  return { ...base, ...sanitizeMediaFolderConfig(base) };
}

function summarizeImageDatasetConfig(cfg) {
  const clean = sanitizeMediaFolderConfig(cfg || {});
  const folders = Array.isArray(clean.mediaFolders) ? clean.mediaFolders : [];
  const tags = clean.mediaFolderTags || {};
  const extra = Object.keys(cfg || {})
    .filter((k) => k !== 'mediaFolders' && k !== 'mediaFolderTags')
    .sort();
  if (!folders.length && !Object.keys(tags).length && !extra.length) return '（空）';
  const parts = [`${folders.length} folders · ${Object.keys(tags).length} tags`];
  if (extra.length) parts.push(truncate(extra.join(', '), 60));
  return parts.join(' · ');
}

/** Collect up to `limit` JSON path differences (builtin vs online). */
export function collectJsonPathDiffs(builtin, online, { limit = 8, path = '$' } = {}) {
  const out = [];
  const walk = (a, b, p) => {
    if (out.length >= limit) return;
    if (stableStringify(a) === stableStringify(b)) return;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb || (typeof a !== 'object' || a === null) || (typeof b !== 'object' || b === null)) {
      out.push({
        path: p,
        online: truncate(typeof b === 'object' ? JSON.stringify(b) : String(b), 100),
        builtin: truncate(typeof a === 'object' ? JSON.stringify(a) : String(a), 100),
      });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        out.push({ path: p, online: `len ${b.length}`, builtin: `len ${a.length}` });
        if (out.length >= limit) return;
      }
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i += 1) {
        walk(a[i], b[i], `${p}[${i}]`);
        if (out.length >= limit) return;
      }
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a)) {
        out.push({ path: `${p}.${k}`, online: truncate(JSON.stringify(b[k]), 100), builtin: '（无）' });
      } else if (!(k in b)) {
        out.push({ path: `${p}.${k}`, online: '（无）', builtin: truncate(JSON.stringify(a[k]), 100) });
      } else {
        walk(a[k], b[k], `${p}.${k}`);
      }
      if (out.length >= limit) return;
    }
  };
  walk(builtin, online, path);
  return out;
}

/** Same filter as syncBuiltinTemplateImages — cards stay on disk only. */
export function filterBuiltinSyncImagePaths(images = []) {
  return (images || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
    .filter((n) => !/-card\.(jpe?g|png|webp)$/i.test(n));
}

/**
 * Collect identity keys for an online preloaded image entry
 * (relative path, folder/name, basename, key suffix).
 */
export function onlineImageIdentityKeys(entry) {
  const keys = new Set();
  if (!entry) return keys;
  const name = String(entry.name || '').trim();
  const folder = String(entry.folder || '').replace(/^\/+|\/+$/g, '');
  if (folder && name) keys.add(`${folder}/${name}`);
  if (name) {
    keys.add(name);
    keys.add(name.split('/').pop());
  }
  const key = String(entry.key || '').replace(/^\/+/, '');
  if (key) {
    const m = key.match(/^(?:templates|builtin)\/[^/]+\/(.+)$/);
    if (m?.[1]) {
      keys.add(m[1]);
      keys.add(m[1].split('/').pop());
    }
  }
  const url = String(entry.url || '');
  if (url) {
    const m = url.match(/\/(?:templates|project_templates|builtin)\/[^/]+\/(.+?)(?:\?|$)/);
    if (m?.[1]) {
      const rel = decodeURIComponent(m[1]);
      keys.add(rel);
      keys.add(rel.split('/').pop());
    }
  }
  return keys;
}

/**
 * Which builtin pack paths are still missing from the online library.
 * @returns {{ bundledPaths: string[], missingPaths: string[], presentCount: number }}
 */
export function compareBuiltinImagesToOnline(bundledImages = [], onlinePreloaded = []) {
  const bundledPaths = filterBuiltinSyncImagePaths(bundledImages);
  if (!bundledPaths.length) {
    return { bundledPaths: [], missingPaths: [], presentCount: 0 };
  }
  const onlineKeys = new Set();
  (onlinePreloaded || []).forEach((entry) => {
    onlineImageIdentityKeys(entry).forEach((k) => onlineKeys.add(k));
  });
  const missingPaths = bundledPaths.filter((rel) => {
    const base = rel.split('/').pop();
    return !onlineKeys.has(rel) && !onlineKeys.has(base);
  });
  return {
    bundledPaths,
    missingPaths,
    presentCount: bundledPaths.length - missingPaths.length,
  };
}

/**
 * Snapshot of what「导入内置」would write for comparable fields.
 * @param {object} tpl
 * @param {{ bundledImages?: string[] }} [opts]
 */
export function buildBuiltinImportSnapshot(tpl, { bundledImages = [] } = {}) {
  const bundledPaths = filterBuiltinSyncImagePaths(bundledImages);
  return {
    name: tpl?.name || '',
    description: tpl?.description || '',
    author: tpl?.author || '',
    year: String(tpl?.year ?? ''),
    category: tpl?.category || 'Academic Research',
    tags: normalizeBuiltinCompareTags(tpl?.tags),
    website: tpl?.website || null,
    huggingfaceDataset: tpl?.huggingfaceDataset || null,
    config: tpl?.config || {},
    imageDatasetConfig: normalizeTemplateImageDatasetConfig(
      tpl?.imageDatasetConfig || tpl?.image_dataset_config || {},
    ),
    isPinned: !!(tpl?.isPinned ?? tpl?.is_pinned),
    // Legacy builtin JSON has no thumbnailUrl key; import then keeps the online cover.
    ...(tpl && 'thumbnailUrl' in tpl ? { thumbnailUrl: tpl.thumbnailUrl || null } : {}),
    bundledPaths,
    bundledImageCount: bundledPaths.length,
  };
}

/** Snapshot of current online template for the same comparable fields. */
export function buildOnlineImportSnapshot(template) {
  const preloaded = Array.isArray(template?.preloadedImages) ? template.preloadedImages : [];
  return {
    name: template?.name || '',
    description: template?.description || '',
    author: template?.author || '',
    year: String(template?.year ?? ''),
    category: template?.category || 'Academic Research',
    tags: normalizeOnlineCompareTags(template?.tags),
    website: template?.website || null,
    huggingfaceDataset: template?.huggingfaceDataset || null,
    config: template?.config || {},
    imageDatasetConfig: normalizeTemplateImageDatasetConfig(
      template?.imageDatasetConfigFull || template?.imageDatasetConfig || {},
    ),
    isPinned: !!(template?.is_pinned ?? template?.isPinned),
    thumbnailUrl: template?.thumbnail_url || template?.thumbnailUrl || null,
    onlineImageCount: preloaded.length,
    preloadedImages: preloaded,
  };
}

const FIELD_LABELS = {
  name: '名称',
  description: '描述',
  author: '作者',
  year: '年份',
  category: '分类',
  tags: '标签',
  website: '论文链接',
  huggingfaceDataset: 'HF 数据集',
  config: '问卷配置',
  imageDatasetConfig: '媒体设置',
  isPinned: '置顶',
  thumbnailUrl: '首页封面',
  images: '内置图包',
};

/** id → entry map from `_export/manifest.json` (empty for a missing/foreign manifest). */
export function indexBuiltinExportManifest(manifest) {
  const byId = new Map();
  if (!manifest || manifest.format !== 'sp-survey-builtin-templates') return byId;
  (Array.isArray(manifest.templates) ? manifest.templates : []).forEach((entry) => {
    const id = String(entry?.id || '').trim().toLowerCase();
    if (id) byId.set(id, entry);
  });
  return byId;
}

function toTime(value) {
  if (!value) return NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * The online row was edited after the export the builtin JSON came from.
 * @returns {{ exportedUpdatedAt: string, onlineUpdatedAt: string } | null}
 */
export function detectBuiltinExportConflict(manifestEntry, onlineUpdatedAt) {
  const exportedUpdatedAt = manifestEntry?.updated_at || null;
  const exported = toTime(exportedUpdatedAt);
  const online = toTime(onlineUpdatedAt);
  if (!Number.isFinite(exported) || !Number.isFinite(online) || online <= exported) return null;
  return { exportedUpdatedAt, onlineUpdatedAt };
}

/**
 * @returns {{ diffs: Array<{field,label,online,builtin,paths?}>, unchanged: boolean }}
 */
export function diffBuiltinImportSnapshots(builtinSnap, onlineSnap) {
  const diffs = [];
  // 置顶 / 首页展示 / 已批准 are managed online and never overwritten on update,
  // so they are not diffed. The cover is written, so it is.
  const scalarFields = [
    'name', 'description', 'author', 'year', 'category', 'tags',
    'website', 'huggingfaceDataset',
  ];
  if ('thumbnailUrl' in builtinSnap) scalarFields.push('thumbnailUrl');

  scalarFields.forEach((field) => {
    if (stableStringify(builtinSnap[field]) === stableStringify(onlineSnap[field])) return;
    diffs.push({
      field,
      label: FIELD_LABELS[field] || field,
      online: summarizeScalar(onlineSnap[field]),
      builtin: summarizeScalar(builtinSnap[field]),
    });
  });

  if (stableStringify(builtinSnap.config) !== stableStringify(onlineSnap.config)) {
    const paths = collectJsonPathDiffs(builtinSnap.config, onlineSnap.config, { limit: 8 });
    diffs.push({
      field: 'config',
      label: FIELD_LABELS.config,
      online: summarizeConfig(onlineSnap.config),
      builtin: summarizeConfig(builtinSnap.config),
      paths,
    });
  }

  if (stableStringify(builtinSnap.imageDatasetConfig)
      !== stableStringify(onlineSnap.imageDatasetConfig)) {
    diffs.push({
      field: 'imageDatasetConfig',
      label: FIELD_LABELS.imageDatasetConfig,
      online: summarizeImageDatasetConfig(onlineSnap.imageDatasetConfig),
      builtin: summarizeImageDatasetConfig(builtinSnap.imageDatasetConfig),
      paths: collectJsonPathDiffs(builtinSnap.imageDatasetConfig, onlineSnap.imageDatasetConfig, { limit: 8 }),
    });
  }

  const imageCmp = compareBuiltinImagesToOnline(
    builtinSnap.bundledPaths || [],
    onlineSnap.preloadedImages || [],
  );
  // Only flag image sync when the builtin pack has files the online library lacks.
  if (imageCmp.missingPaths.length > 0) {
    const sample = imageCmp.missingPaths.slice(0, 5).join(', ');
    const more = imageCmp.missingPaths.length > 5
      ? ` 等 ${imageCmp.missingPaths.length} 个`
      : '';
    diffs.push({
      field: 'images',
      label: FIELD_LABELS.images,
      online: `已有 ${imageCmp.presentCount}/${imageCmp.bundledPaths.length}（库内共 ${onlineSnap.onlineImageCount} 张）`,
      builtin: `缺 ${imageCmp.missingPaths.length} 张待同步：${sample}${more}`,
    });
  }

  return {
    diffs,
    unchanged: diffs.length === 0,
    willRefreshImages: imageCmp.missingPaths.length > 0,
    missingImageCount: imageCmp.missingPaths.length,
  };
}
