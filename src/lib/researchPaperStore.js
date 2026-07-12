/**
 * Supabase store for research_papers / research_paper_scans (admin RLS).
 */
import { supabase } from './supabase';
import { ensureAnalysisMeta } from './researchPaperMeta.mjs';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

function isMissingAnalysisMetaColumn(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('analysis_meta') && (
    msg.includes('does not exist')
    || msg.includes('could not find')
    || msg.includes('schema cache')
    || error?.code === '42703'
    || error?.code === 'PGRST204'
  );
}

function rowToPaper(row) {
  if (!row) return null;
  const paper = {
    id: row.id,
    doi: row.doi,
    title: row.title,
    authors: row.authors || [],
    year: row.year,
    abstract: row.abstract || '',
    venue: row.venue || '',
    paper_url: row.paper_url,
    s2_paper_id: row.s2_paper_id,
    crossref_doi: row.crossref_doi,
    keywords: row.keywords || [],
    relevance_score: row.relevance_score || 0,
    status: row.status,
    template_fit: row.template_fit || 'unknown',
    template_id: row.template_id || null,
    sources: row.sources || [],
    raw_meta: row.raw_meta || {},
    analysis_meta: row.analysis_meta || {},
    scan_id: row.scan_id || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  paper.analysis_meta = ensureAnalysisMeta(paper);
  return paper;
}

/** Create a scan audit row; returns scan id. */
export async function createResearchScan({
  query,
  preset = null,
  yearFrom = null,
  yearTo = null,
  mode = 'latest',
  hitCount = 0,
  sourcesUsed = [],
  errorSummary = null,
} = {}) {
  const db = requireSupabase();
  const { data: { user } } = await db.auth.getUser();
  const { data, error } = await db
    .from('research_paper_scans')
    .insert({
      query: query || '',
      preset,
      year_from: yearFrom,
      year_to: yearTo,
      mode,
      hit_count: hitCount,
      sources_used: sourcesUsed,
      executed_by: user?.id || null,
      error_summary: errorSummary,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Upsert papers by DOI (primary dedupe key).
 * - Existing DOI: never insert a second row; lightly refresh meta; keep status
 *   (approved/rejected/candidate) unchanged unless opts.forceStatus is set.
 * - New DOI / no-DOI: insert with p.status || opts.defaultStatus (default 'candidate').
 * - opts.onProgress({ current, total, inserted, updated, skipped }) called periodically.
 */
export async function upsertResearchCandidates(papers, {
  scanId = null,
  defaultStatus = 'candidate',
  onProgress = null,
} = {}) {
  const db = requireSupabase();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const list = papers || [];
  const total = list.length;

  const report = (current) => {
    if (typeof onProgress !== 'function') return;
    onProgress({ current, total, inserted, updated, skipped });
  };

  report(0);

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p?.title) {
      skipped += 1;
      if (i === 0 || (i + 1) % 5 === 0 || i + 1 === total) report(i + 1);
      continue;
    }
    const doi = p.doi ? String(p.doi).toLowerCase().trim() : null;
    const wantStatus = p.status || defaultStatus || 'candidate';
    let existing = null;
    if (doi) {
      const { data } = await db
        .from('research_papers')
        .select('id, status, sources, abstract, s2_paper_id, crossref_doi, keywords, relevance_score, template_fit')
        .ilike('doi', doi)
        .maybeSingle();
      existing = data;
    } else {
      // No DOI: dedupe by exact title + year when possible
      let q = db
        .from('research_papers')
        .select('id, status, sources, abstract, s2_paper_id, crossref_doi, keywords, relevance_score, template_fit')
        .eq('title', p.title)
        .limit(1);
      if (p.year) q = q.eq('year', p.year);
      const { data } = await q.maybeSingle();
      existing = data;
    }

    const analysis_meta = ensureAnalysisMeta({
      ...p,
      abstract: p.abstract || '',
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
    });

    const base = {
      doi,
      title: p.title,
      authors: Array.isArray(p.authors) ? p.authors : [],
      year: p.year || null,
      abstract: p.abstract || '',
      venue: p.venue || '',
      paper_url: p.paper_url || null,
      s2_paper_id: p.s2_paper_id || null,
      crossref_doi: p.crossref_doi || doi,
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
      relevance_score: p.relevance_score || 0,
      template_fit: p.template_fit || 'unknown',
      sources: Array.isArray(p.sources) ? p.sources : [],
      raw_meta: p.raw_meta || {},
      analysis_meta,
      scan_id: scanId,
      updated_at: new Date().toISOString(),
    };

    const updateExisting = async (withMeta) => {
      const patch = {
        abstract: existing.abstract || base.abstract,
        sources: [...new Set([...(existing.sources || []), ...base.sources])],
        s2_paper_id: existing.s2_paper_id || base.s2_paper_id,
        crossref_doi: existing.crossref_doi || base.crossref_doi,
        relevance_score: Math.max(existing.relevance_score || 0, base.relevance_score || 0),
        template_fit: existing.template_fit === 'unknown' && base.template_fit !== 'unknown'
          ? base.template_fit
          : existing.template_fit,
        keywords: (existing.keywords?.length ? existing.keywords : base.keywords),
        updated_at: base.updated_at,
      };
      if (withMeta) patch.analysis_meta = base.analysis_meta;
      return db.from('research_papers').update(patch).eq('id', existing.id);
    };

    const insertNew = async (withMeta) => {
      const row = { ...base, status: wantStatus };
      if (!withMeta) delete row.analysis_meta;
      return db.from('research_papers').insert(row);
    };

    if (existing) {
      // Duplicate: keep row, refresh meta only; do not change review status
      let { error } = await updateExisting(true);
      if (error && isMissingAnalysisMetaColumn(error)) {
        ({ error } = await updateExisting(false));
      }
      if (error) errors.push(error.message);
      else updated += 1; // existing DOI/title — refreshed, not duplicated
    } else {
      let { error } = await insertNew(true);
      if (error && isMissingAnalysisMetaColumn(error)) {
        ({ error } = await insertNew(false));
      }
      if (error) {
        if (error.code === '23505') skipped += 1;
        else errors.push(error.message);
      } else {
        inserted += 1;
      }
    }

    if (i === 0 || (i + 1) % 5 === 0 || i + 1 === total) report(i + 1);
  }

  report(total);
  return { inserted, updated, skipped, errors };
}

export async function listResearchPapers({
  status = null,
  statusIn = null,
  search = '',
  limit = 1000,
  offset = 0,
} = {}) {
  const db = requireSupabase();
  // Stable order: year → score → title → id (avoids reshuffle after approve/reload)
  const from = Math.max(0, offset);
  const to = from + Math.max(1, limit) - 1;
  let q = db
    .from('research_papers')
    .select('*')
    .order('year', { ascending: false, nullsFirst: false })
    .order('relevance_score', { ascending: false })
    .order('title', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);

  if (statusIn?.length) q = q.in('status', statusIn);
  else if (status) q = q.eq('status', status);

  if (search?.trim()) {
    const s = search.trim().replace(/%/g, '');
    q = q.or(`title.ilike.%${s}%,doi.ilike.%${s}%,venue.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(rowToPaper);
}

/** Page through all matching rows (Supabase/PostgREST often caps ~1000 per request). */
export async function listAllResearchPapers(opts = {}) {
  const pageSize = Math.min(opts.pageSize || 1000, 1000);
  const all = [];
  let offset = 0;
  for (;;) {
    const batch = await listResearchPapers({ ...opts, limit: pageSize, offset });
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    // allow large libraries (thousands+)
    if (offset > 200000) break;
  }
  return all;
}

const PUBLIC_PAPER_COLS_WITH_META =
  'id, doi, title, authors, year, abstract, venue, paper_url, keywords, relevance_score, sources, analysis_meta, template_id, created_at';

const PUBLIC_PAPER_COLS_BASE =
  'id, doi, title, authors, year, abstract, venue, paper_url, keywords, relevance_score, sources, template_id, created_at';

/**
 * Public browse: approved papers only (needs RLS policy
 * "Public read approved research_papers").
 * Falls back to a select without analysis_meta if that column is not migrated yet;
 * client-side ensureAnalysisMeta still fills tags for charts.
 */
export async function listPublicResearchPapers({ pageSize = 1000 } = {}) {
  const db = requireSupabase();
  const size = Math.min(pageSize || 1000, 1000);

  const fetchAll = async (cols) => {
    const all = [];
    let offset = 0;
    for (;;) {
      const from = offset;
      const to = offset + size - 1;
      const { data, error } = await db
        .from('research_papers')
        .select(cols)
        .eq('status', 'approved')
        .order('year', { ascending: false, nullsFirst: false })
        .order('relevance_score', { ascending: false })
        .order('title', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw error;
      const batch = (data || []).map(rowToPaper);
      all.push(...batch);
      if (batch.length < size) break;
      offset += size;
      if (offset > 200000) break;
    }
    return all;
  };

  try {
    return await fetchAll(PUBLIC_PAPER_COLS_WITH_META);
  } catch (err) {
    if (!isMissingAnalysisMetaColumn(err)) throw err;
    return fetchAll(PUBLIC_PAPER_COLS_BASE);
  }
}

/** Count rows for a status (admin RLS). */
export async function countResearchPapers({ status = null, search = '' } = {}) {
  const db = requireSupabase();
  let q = db
    .from('research_papers')
    .select('id', { count: 'exact', head: true });
  if (status) q = q.eq('status', status);
  if (search?.trim()) {
    const s = search.trim().replace(/%/g, '');
    q = q.or(`title.ilike.%${s}%,doi.ilike.%${s}%,venue.ilike.%${s}%`);
  }
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/** Batch-update status (and reviewer) for many paper ids. */
export async function updateResearchPapersStatus(ids, status) {
  const db = requireSupabase();
  if (!ids?.length) return { updated: 0 };
  const { data: { user } } = await db.auth.getUser();
  const { data, error } = await db
    .from('research_papers')
    .update({
      status,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .select('id');
  if (error) throw error;
  return { updated: (data || []).length };
}

export async function updateResearchPaper(id, updates) {
  const db = requireSupabase();
  const { data: { user } } = await db.auth.getUser();
  const row = {
    updated_at: new Date().toISOString(),
  };
  if ('status' in updates) {
    row.status = updates.status;
    row.reviewed_by = user?.id || null;
    row.reviewed_at = new Date().toISOString();
  }
  if ('template_fit' in updates) row.template_fit = updates.template_fit;
  if ('template_id' in updates) row.template_id = updates.template_id;
  if ('abstract' in updates) row.abstract = updates.abstract;

  const { data, error } = await db
    .from('research_papers')
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Paper not updated (0 rows) — check admin RLS');
  return rowToPaper(data);
}

/** Permanently delete a research paper row (admin RLS). */
export async function deleteResearchPaper(id) {
  const db = requireSupabase();
  if (!id) throw new Error('Paper id is required');
  const { error } = await db.from('research_papers').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function listRecentScans(limit = 20) {
  const db = requireSupabase();
  const { data, error } = await db
    .from('research_paper_scans')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
