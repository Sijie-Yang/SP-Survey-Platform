/**
 * Normalize project.metadata for Agent / MCP / Admin persistence.
 */

const META_KEYS = ['author', 'year', 'category', 'tags', 'website', 'huggingfaceDataset'];

export function normalizeProjectMetadata(input = {}, existing = {}) {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? { ...existing }
    : {};
  const src = input && typeof input === 'object' ? input : {};

  const pick = (key, transform) => {
    if (src[key] === undefined && src.metadata?.[key] === undefined) return;
    const raw = src[key] !== undefined ? src[key] : src.metadata[key];
    base[key] = transform(raw);
  };

  pick('author', (v) => String(v || '').trim());
  pick('year', (v) => String(v || '').trim());
  pick('category', (v) => String(v || '').trim());
  pick('website', (v) => String(v || '').trim());
  pick('huggingfaceDataset', (v) => String(v || '').trim());
  if (src.tags !== undefined || src.metadata?.tags !== undefined) {
    const raw = src.tags !== undefined ? src.tags : src.metadata.tags;
    if (Array.isArray(raw)) {
      base.tags = raw.map((t) => String(t || '').trim()).filter(Boolean);
    } else {
      base.tags = String(raw || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  // Drop empty strings / empty arrays for cleanliness
  META_KEYS.forEach((key) => {
    if (base[key] === '' || (Array.isArray(base[key]) && !base[key].length)) {
      delete base[key];
    }
  });
  return base;
}

export function metadataFromRow(row) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    author: meta.author || '',
    year: meta.year || '',
    category: meta.category || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    website: meta.website || '',
    huggingfaceDataset: meta.huggingfaceDataset || '',
  };
}

export function projectCardFromRow(row) {
  const meta = metadataFromRow(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    ...meta,
    templateId: row.template_id || null,
    lastModified: row.updated_at || null,
    draftUpdatedAt: row.draft_updated_at || row.updated_at || null,
    publishedAt: row.published_at || null,
    publishedVersion: row.published_version || 0,
  };
}
