/**
 * The paper library (Supabase research_papers) for platform admins over MCP,
 * and the weekly scan that adds new papers as candidates.
 *
 * Supabase is the only copy of the library: the /papers page shows rows with
 * status "approved"; "candidate" rows wait for an admin. A paper is linked to
 * its template by research_papers.template_id.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { ensureAnalysisMeta } from '../../src/lib/researchPaperMeta.mjs';
import { PRESET_QUERIES, searchBothProviders } from '../researchProviders.mjs';

export const PAPER_STATUSES = ['candidate', 'approved', 'rejected', 'archived'];
export const SAVE_MAX = 50;
const LIST_MAX = 200;

const LIST_COLUMNS = 'id,doi,title,authors,year,venue,paper_url,status,template_id,sources,keywords,relevance_score,template_fit,created_at,updated_at';

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeDoi(raw) {
  if (raw == null) return null;
  const doi = String(raw).trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function textList(value, max, each) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => text(item, each)).filter(Boolean).slice(0, max);
}

/**
 * The fields of one paper the caller set, checked and trimmed. Only fields
 * present in the input are returned, so an update never blanks the others.
 */
export function cleanPaperInput(input = {}) {
  const out = {};
  const problems = [];
  if ('doi' in input) {
    if (input.doi == null || input.doi === '') out.doi = null;
    else {
      out.doi = normalizeDoi(input.doi);
      if (!out.doi) problems.push(`doi "${text(input.doi, 80)}" is not a DOI (10.xxxx/...)`);
    }
  }
  if ('title' in input) {
    out.title = text(input.title, 500);
    if (!out.title) problems.push('title is empty');
  }
  if ('authors' in input) {
    const authors = textList(input.authors, 100, 200);
    if (!authors) problems.push('authors must be a list of names');
    else out.authors = authors;
  }
  if ('year' in input) {
    if (input.year == null || input.year === '') out.year = null;
    else {
      const year = Number(input.year);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) problems.push(`year "${text(input.year, 10)}" is not a year`);
      else out.year = year;
    }
  }
  if ('abstract' in input) out.abstract = text(input.abstract, 8000);
  if ('venue' in input) out.venue = text(input.venue, 300);
  if ('paperUrl' in input) {
    const url = text(input.paperUrl, 500);
    if (url && !/^https?:\/\//i.test(url)) problems.push('paperUrl must start with http:// or https://');
    else out.paper_url = url || null;
  }
  if ('keywords' in input) {
    const keywords = textList(input.keywords, 40, 80);
    if (!keywords) problems.push('keywords must be a list');
    else out.keywords = keywords;
  }
  if ('status' in input) {
    const status = text(input.status, 20);
    if (!PAPER_STATUSES.includes(status)) problems.push(`status must be one of ${PAPER_STATUSES.join(', ')}`);
    else out.status = status;
  }
  if ('templateId' in input) {
    out.template_id = input.templateId == null || input.templateId === '' ? null : text(input.templateId, 120);
  }
  return { fields: out, problems };
}

async function rows(env, path, query) {
  const result = await supabaseRest(env, { path, serviceRole: true, query });
  return Array.isArray(result) ? result : [];
}

async function findExisting(env, { id, doi, title, year }) {
  if (id) return (await rows(env, '/rest/v1/research_papers', `?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null;
  if (doi) {
    // Older rows may keep a DOI in another letter case: ilike without wildcards
    // is a case-insensitive equality.
    const safe = doi.replace(/[%_*\\]/g, (c) => `\\${c}`);
    const hit = (await rows(env, '/rest/v1/research_papers', `?doi=ilike.${encodeURIComponent(safe)}&select=*&limit=1`))[0];
    if (hit) return hit;
  }
  if (title && !doi) {
    const yearPart = year ? `&year=eq.${year}` : '';
    return (await rows(env, '/rest/v1/research_papers', `?title=eq.${encodeURIComponent(title)}${yearPart}&select=*&limit=1`))[0] || null;
  }
  return null;
}

/** Admin list: filter by text in the title, DOI, status or template. */
export async function listPapers(env, args = {}) {
  const parts = [`select=${LIST_COLUMNS}`];
  const doi = args.doi ? normalizeDoi(args.doi) : null;
  if (args.doi && !doi) throw fail('doi is not a DOI (10.xxxx/...).');
  if (doi) parts.push(`doi=ilike.${encodeURIComponent(doi.replace(/[%_*\\]/g, (c) => `\\${c}`))}`);
  if (args.status) {
    if (!PAPER_STATUSES.includes(args.status)) throw fail(`status must be one of ${PAPER_STATUSES.join(', ')}`);
    parts.push(`status=eq.${args.status}`);
  }
  if (args.templateId) parts.push(`template_id=eq.${encodeURIComponent(text(args.templateId, 120))}`);
  if (args.linked === true) parts.push('template_id=not.is.null');
  if (args.linked === false) parts.push('template_id=is.null');
  const q = text(args.search, 200).replace(/[%*(),.]/g, ' ').trim();
  if (q) parts.push(`title=ilike.${encodeURIComponent(`*${q}*`)}`);
  const limit = Math.min(LIST_MAX, Math.max(1, Number(args.limit) || 50));
  const offset = Math.max(0, Number(args.offset) || 0);
  parts.push('order=year.desc.nullslast,title.asc', `limit=${limit}`, `offset=${offset}`);
  const papers = await rows(env, '/rest/v1/research_papers', `?${parts.join('&')}`);
  return {
    success: true,
    papers,
    count: papers.length,
    nextOffset: papers.length === limit ? offset + limit : null,
    note: 'The /papers page shows only status "approved". template_id links a paper to its template.',
  };
}

async function templateExists(env, templateId) {
  return (await rows(env, '/rest/v1/templates', `?id=eq.${encodeURIComponent(templateId)}&select=id`)).length > 0;
}

/**
 * Admin: add or update papers. Each paper is found by id, else DOI, else exact
 * title + year; found papers get only the fields given, new ones need a title
 * and start as "candidate" unless a status is given. A templateId must name an
 * existing template. Every paper is reported: inserted, updated or error.
 */
export async function savePapers(env, ctx, papers) {
  if (!Array.isArray(papers) || !papers.length) throw fail('papers must be a non-empty list.');
  if (papers.length > SAVE_MAX) throw fail(`At most ${SAVE_MAX} papers per call.`);
  const results = [];
  const knownTemplates = new Map();
  for (let i = 0; i < papers.length; i += 1) {
    const input = papers[i] || {};
    const { fields, problems } = cleanPaperInput(input);
    const label = fields.doi || fields.title || input.id || `#${i + 1}`;
    if (problems.length) {
      results.push({ index: i, paper: label, result: 'error', error: problems.join('; ') });
      continue;
    }
    try {
      if (fields.template_id) {
        if (!knownTemplates.has(fields.template_id)) knownTemplates.set(fields.template_id, await templateExists(env, fields.template_id));
        if (!knownTemplates.get(fields.template_id)) {
          results.push({ index: i, paper: label, result: 'error', error: `No template with id "${fields.template_id}".` });
          continue;
        }
      }
      const existing = await findExisting(env, { id: input.id ? text(input.id, 64) : null, doi: fields.doi, title: fields.title, year: fields.year });
      if (input.id && !existing) {
        results.push({ index: i, paper: label, result: 'error', error: `No paper with id "${text(input.id, 64)}".` });
        continue;
      }
      const now = new Date().toISOString();
      const review = fields.status && fields.status !== 'candidate'
        ? { reviewed_by: ctx.userId || null, reviewed_at: now }
        : {};
      if (existing) {
        if (input.id && fields.doi && normalizeDoi(existing.doi) !== fields.doi) {
          // Changing a DOI by id is allowed, but never onto another paper's DOI.
          const other = await findExisting(env, { doi: fields.doi });
          if (other && other.id !== existing.id) {
            results.push({ index: i, paper: label, result: 'error', error: `DOI ${fields.doi} already belongs to paper ${other.id}.` });
            continue;
          }
        }
        const patch = { ...fields, ...(fields.status && fields.status !== existing.status ? review : {}), updated_at: now };
        if ('title' in fields || 'abstract' in fields || 'keywords' in fields) {
          patch.analysis_meta = ensureAnalysisMeta({ ...existing, ...patch, analysis_meta: null });
        }
        await supabaseRest(env, {
          path: '/rest/v1/research_papers',
          method: 'PATCH',
          serviceRole: true,
          query: `?id=eq.${encodeURIComponent(existing.id)}`,
          body: patch,
          prefer: 'return=minimal',
        });
        results.push({ index: i, paper: label, result: 'updated', id: existing.id, status: fields.status || existing.status, templateId: 'template_id' in fields ? fields.template_id : existing.template_id || null });
        continue;
      }
      if (!fields.title) {
        results.push({ index: i, paper: label, result: 'error', error: 'A new paper needs a title.' });
        continue;
      }
      const row = {
        doi: fields.doi || null,
        title: fields.title,
        authors: fields.authors || [],
        year: fields.year ?? null,
        abstract: fields.abstract || '',
        venue: fields.venue || '',
        paper_url: fields.paper_url || (fields.doi ? `https://doi.org/${fields.doi}` : null),
        crossref_doi: fields.doi || null,
        keywords: fields.keywords || [],
        status: fields.status || 'candidate',
        template_id: fields.template_id || null,
        sources: ['mcp'],
        ...review,
        updated_at: now,
      };
      row.analysis_meta = ensureAnalysisMeta(row);
      const created = await supabaseRest(env, {
        path: '/rest/v1/research_papers',
        method: 'POST',
        serviceRole: true,
        body: row,
        prefer: 'return=representation',
      });
      const id = Array.isArray(created) ? created[0]?.id : created?.id;
      results.push({ index: i, paper: label, result: 'inserted', id: id || null, status: row.status, templateId: row.template_id });
    } catch (err) {
      results.push({ index: i, paper: label, result: 'error', error: err?.message || String(err) });
    }
  }
  const count = (kind) => results.filter((r) => r.result === kind).length;
  return {
    success: count('error') === 0,
    inserted: count('inserted'),
    updated: count('updated'),
    errors: count('error'),
    results,
  };
}

/**
 * Weekly scan (Worker cron): search Semantic Scholar + Crossref with the preset
 * queries for papers from last year on, and add the ones not in the library as
 * "candidate". Papers already in the library are left exactly as they are.
 */
export async function runWeeklyPaperScan(env, { now = new Date(), search = searchBothProviders, limit = 20 } = {}) {
  const yearFrom = now.getUTCFullYear() - 1;
  const queries = Object.values(PRESET_QUERIES);
  const found = [];
  const sourcesUsed = new Set();
  const warnings = [];
  for (const query of queries) {
    try {
      const result = await search({
        query,
        limit,
        yearFrom,
        yearTo: null,
        semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || '',
        crossrefMailto: env.CROSSREF_MAILTO || '',
      });
      found.push(...(result.papers || []));
      (result.sourcesUsed || []).forEach((s) => sourcesUsed.add(s));
      warnings.push(...(result.errors || []));
    } catch (err) {
      warnings.push(`${query}: ${err?.message || err}`);
    }
  }

  // One entry per DOI; papers without a DOI are skipped (they cannot be
  // de-duplicated reliably week after week).
  const byDoi = new Map();
  found.forEach((paper) => {
    const doi = normalizeDoi(paper?.doi);
    if (doi && paper?.title && !byDoi.has(doi)) byDoi.set(doi, { ...paper, doi });
  });

  let scanId = null;
  try {
    const scan = await supabaseRest(env, {
      path: '/rest/v1/research_paper_scans',
      method: 'POST',
      serviceRole: true,
      prefer: 'return=representation',
      body: {
        query: queries.join(' | ').slice(0, 2000),
        preset: 'weekly',
        year_from: yearFrom,
        mode: 'latest',
        hit_count: byDoi.size,
        sources_used: [...sourcesUsed],
        error_summary: warnings.length ? warnings.join('; ').slice(0, 2000) : null,
      },
    });
    scanId = (Array.isArray(scan) ? scan[0]?.id : scan?.id) || null;
  } catch (err) {
    warnings.push(`scan log: ${err?.message || err}`);
  }

  let added = 0;
  let known = 0;
  for (const paper of byDoi.values()) {
    try {
      if (await findExisting(env, { doi: paper.doi })) {
        known += 1;
        continue;
      }
      const row = {
        doi: paper.doi,
        title: text(paper.title, 500),
        authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 100) : [],
        year: Number.isInteger(paper.year) ? paper.year : null,
        abstract: text(paper.abstract, 8000),
        venue: text(paper.venue, 300),
        paper_url: paper.paper_url || `https://doi.org/${paper.doi}`,
        s2_paper_id: paper.s2_paper_id || null,
        crossref_doi: paper.doi,
        keywords: Array.isArray(paper.keywords) ? paper.keywords.slice(0, 40) : [],
        relevance_score: Number(paper.relevance_score) || 0,
        template_fit: paper.template_fit || 'unknown',
        sources: [...new Set(['weekly_scan', ...(paper.sources || [])])],
        raw_meta: paper.raw_meta || {},
        status: 'candidate',
        scan_id: scanId,
        updated_at: now.toISOString(),
      };
      row.analysis_meta = ensureAnalysisMeta(row);
      await supabaseRest(env, {
        path: '/rest/v1/research_papers',
        method: 'POST',
        serviceRole: true,
        body: row,
        prefer: 'return=minimal',
      });
      added += 1;
    } catch (err) {
      warnings.push(`${paper.doi}: ${err?.message || err}`);
    }
  }
  return { yearFrom, found: byDoi.size, added, known, scanId, warnings };
}
