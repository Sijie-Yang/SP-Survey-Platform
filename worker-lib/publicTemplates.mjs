/**
 * Public, read-only view of the approved template library:
 *
 *   GET /api/public/templates          → every approved template: id, name, updatedAt
 *   GET /api/public/templates?id=<id>  → one template in the file format of
 *                                        public/project_templates/<id>.json,
 *                                        plus its paper
 *
 * The open-source SP-Survey repository mirrors the library from here
 * (scripts/sync-templates.mjs there). Only what the public /templates page
 * already shows is returned: no submitter, no account ids, no credentials.
 */
import { supabaseRest } from './supabaseUserClient.mjs';

const OWN_RESPONSE_KEYS = new Set(['ownresponsesupabase', 'own_response_supabase']);

/** Same rule as src/lib/ownResponseSupabase.js (that file needs the browser client). */
export function stripOwnResponseSupabase(value) {
  if (Array.isArray(value)) return value.map(stripOwnResponseSupabase);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([key, child]) => {
    if (OWN_RESPONSE_KEYS.has(String(key).toLowerCase())) return;
    out[key] = stripOwnResponseSupabase(child);
  });
  return out;
}

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ROW_COLUMNS = 'id,name,description,author,year,category,tags,paper_url,huggingface_dataset,dataset,survey_config,'
  + 'is_pinned,show_on_landing,preloaded_images,image_dataset_config,thumbnail_url,created_at,updated_at';

export function publicTemplateFromRow(row, paper = null) {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    author: row.author || '',
    year: row.year || '',
    category: row.category || 'Custom',
    tags: Array.isArray(row.tags) ? row.tags : [],
    isPinned: !!row.is_pinned,
    isApproved: true,
    showOnLanding: !!row.show_on_landing,
    thumbnailUrl: row.thumbnail_url || null,
    website: row.paper_url || null,
    huggingfaceDataset: row.huggingface_dataset || row.dataset || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    config: stripOwnResponseSupabase(row.survey_config || {}),
    imageDatasetConfig: stripOwnResponseSupabase(row.image_dataset_config || {}),
    preloadedImages: Array.isArray(row.preloaded_images) ? row.preloaded_images : [],
    paper: paper ? {
      title: paper.title || '',
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      year: paper.year || null,
      venue: paper.venue || '',
      doi: paper.doi || null,
      url: paper.paper_url || (paper.doi ? `https://doi.org/${paper.doi}` : null),
    } : null,
  };
}

export async function publicTemplates(url, env) {
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/templates',
      serviceRole: true,
      query: '?is_approved=eq.true&select=id,name,updated_at&order=id.asc',
    });
    return {
      status: 200,
      body: { success: true, templates: (rows || []).map((row) => ({ id: row.id, name: row.name || '', updatedAt: row.updated_at || null })) },
    };
  }
  if (!TEMPLATE_ID.test(id)) return { status: 400, body: { success: false, error: 'Invalid template id.' } };
  const rows = await supabaseRest(env, {
    path: '/rest/v1/templates',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(id)}&is_approved=eq.true&select=${ROW_COLUMNS}`,
  });
  if (!Array.isArray(rows) || !rows[0]) return { status: 404, body: { success: false, error: 'No approved template with this id.' } };
  const papers = await supabaseRest(env, {
    path: '/rest/v1/research_papers',
    serviceRole: true,
    query: `?template_id=eq.${encodeURIComponent(id)}&status=eq.approved&select=title,venue,year,doi,paper_url,authors&limit=1`,
  }).catch(() => []);
  return { status: 200, body: { success: true, template: publicTemplateFromRow(rows[0], Array.isArray(papers) ? papers[0] : null) } };
}
