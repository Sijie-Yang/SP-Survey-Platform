/**
 * Sync between the paper library file (public/research/library.json, built by
 * scripts/build-research-library.py) and the online table research_papers.
 *
 * The file is the source of truth, as public/project_templates/ is for templates:
 * - File → online: planLibrarySync() lists rows to insert, rows to update
 *   (status, template link, inclusion record) and approved online rows that the
 *   file does not have. Nothing is deleted; the admin chooses which of those to archive.
 * - Online → file: buildLibraryOverridesExport() turns papers added or relinked
 *   online into research/library/overrides.json entries, which are then merged
 *   with scripts/merge-library-overrides.mjs and rebuilt into the file.
 */
import { normalizeDoi } from './researchTemplateMatch';

export const LIBRARY_FILE_URL = '/research/library.json';
export const LIBRARY_FORMAT = 'sp-survey-paper-library';
export const OVERRIDES_EXPORT_FORMAT = 'sp-survey-library-overrides-export';

/** Same key as scripts/build-research-library.py: DOI, else normalized title + year. */
export function libraryKey(paper) {
  const doi = normalizeDoi(paper?.doi);
  if (doi) return `doi:${doi}`;
  const title = String(paper?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!title) return null;
  return `title:${title}|${paper?.year || ''}`;
}

function sameInclusion(a, b) {
  return (a?.via || null) === (b?.via || null) && (a?.reason || null) === (b?.reason || null);
}

/**
 * @param {object[]} filePapers  papers from library.json
 * @param {object[]} onlineRows  research_papers rows of every status
 * @returns {{
 *   toInsert: object[],
 *   toUpdate: Array<{ id, title, key, changes: object, patch: object }>,
 *   onlineOnly: object[],
 *   unchanged: number,
 *   duplicateOnline: Array<{ key, ids: string[] }>,
 *   duplicateFile: string[],
 * }}
 */
export function planLibrarySync(filePapers = [], onlineRows = []) {
  const online = new Map();
  const duplicateOnline = new Map();
  for (const row of onlineRows) {
    const key = libraryKey(row);
    if (!key) continue;
    if (online.has(key)) {
      if (!duplicateOnline.has(key)) duplicateOnline.set(key, [online.get(key).id]);
      duplicateOnline.get(key).push(row.id);
      continue;
    }
    online.set(key, row);
  }

  const seenFile = new Set();
  const duplicateFile = [];
  const toInsert = [];
  const toUpdate = [];
  let unchanged = 0;

  for (const paper of filePapers) {
    const key = libraryKey(paper);
    if (!key) continue;
    if (seenFile.has(key)) {
      duplicateFile.push(key);
      continue;
    }
    seenFile.add(key);

    const row = online.get(key);
    if (!row) {
      toInsert.push(paper);
      continue;
    }

    const changes = {};
    const patch = {};
    if (row.status !== 'approved') {
      changes.status = { from: row.status, to: 'approved' };
      patch.status = 'approved';
    }
    const fileTemplate = paper.template_id || null;
    const onlineTemplate = row.template_id || null;
    if (fileTemplate !== onlineTemplate) {
      changes.template_id = { from: onlineTemplate, to: fileTemplate };
      patch.template_id = fileTemplate;
      if (fileTemplate) patch.template_fit = 'likely';
    }
    const onlineInclusion = row.raw_meta?.library || null;
    if (paper.inclusion && !sameInclusion(paper.inclusion, onlineInclusion)) {
      changes.inclusion = { from: onlineInclusion?.via || null, to: paper.inclusion.via };
      patch.raw_meta = { ...(row.raw_meta || {}), library: paper.inclusion };
    }
    if (!row.abstract && paper.abstract) {
      changes.abstract = { from: '', to: 'filled' };
      patch.abstract = paper.abstract;
    }

    if (Object.keys(patch).length) {
      toUpdate.push({ id: row.id, title: row.title, key, changes, patch });
    } else {
      unchanged += 1;
    }
  }

  const onlineOnly = [];
  for (const [key, row] of online) {
    if (row.status === 'approved' && !seenFile.has(key)) onlineOnly.push(row);
  }
  onlineOnly.sort((a, b) => (b.year || 0) - (a.year || 0)
    || String(a.title || '').localeCompare(String(b.title || '')));

  return {
    toInsert,
    toUpdate,
    onlineOnly,
    unchanged,
    duplicateOnline: [...duplicateOnline].map(([key, ids]) => ({ key, ids })),
    duplicateFile,
  };
}

/** Count updates by kind of change for the preview. */
export function summarizeSyncPlan(plan) {
  const counts = { status: 0, template_id: 0, inclusion: 0, abstract: 0 };
  for (const u of plan?.toUpdate || []) {
    for (const field of Object.keys(u.changes)) {
      if (field in counts) counts[field] += 1;
    }
  }
  return {
    insert: plan?.toInsert?.length || 0,
    update: plan?.toUpdate?.length || 0,
    onlineOnly: plan?.onlineOnly?.length || 0,
    unchanged: plan?.unchanged || 0,
    ...counts,
  };
}

/** Library row → research_papers insert payload (status approved, inclusion kept in raw_meta). */
export function libraryPaperToRow(paper) {
  const doi = normalizeDoi(paper.doi);
  return {
    doi,
    title: paper.title,
    authors: Array.isArray(paper.authors) ? paper.authors : [],
    year: paper.year || null,
    abstract: paper.abstract || '',
    venue: paper.venue || '',
    paper_url: paper.paper_url || (doi ? `https://doi.org/${doi}` : null),
    crossref_doi: paper.crossref_doi || doi,
    keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
    relevance_score: paper.relevance_score || 0,
    status: 'approved',
    template_fit: paper.template_id ? 'likely' : (paper.template_fit || 'unknown'),
    template_id: paper.template_id || null,
    sources: Array.isArray(paper.sources) ? paper.sources : [],
    raw_meta: { ...(paper.raw_meta || {}), ...(paper.inclusion ? { library: paper.inclusion } : {}) },
    analysis_meta: paper.analysis_meta || {},
  };
}

/**
 * Online → file: papers approved online but missing from the file, and template
 * links that differ from the file, as overrides.json entries.
 */
export function buildLibraryOverridesExport(onlineRows = [], filePapers = [], { date } = {}) {
  const day = date || new Date().toISOString().slice(0, 10);
  const fileByKey = new Map();
  for (const p of filePapers) {
    const key = libraryKey(p);
    if (key) fileByKey.set(key, p);
  }

  const include = [];
  const templateLinks = [];
  const exclude = [];
  const seen = new Set();
  for (const row of onlineRows) {
    const key = libraryKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const filePaper = fileByKey.get(key);
    const doi = normalizeDoi(row.doi);
    const ref = doi ? { doi } : { title: row.title, year: row.year || null };

    if (!filePaper) {
      if (row.status !== 'approved') continue;
      include.push({
        ...ref,
        title: row.title,
        via: 'admin_added',
        added: day,
        reason: `Added in the online paper library (Admin); exported ${day}.`,
        paper: {
          title: row.title,
          authors: row.authors || [],
          year: row.year || null,
          venue: row.venue || '',
          abstract: row.abstract || '',
          keywords: row.keywords || [],
          paper_url: row.paper_url || null,
          sources: row.sources?.length ? row.sources : ['manual'],
          relevance_score: row.relevance_score || 0,
          template_fit: row.template_fit || 'unknown',
        },
      });
      if (row.template_id) {
        templateLinks.push({ ...ref, title: row.title, template_id: row.template_id, reason: `Linked online; exported ${day}.` });
      }
      continue;
    }

    if (row.status === 'archived' || row.status === 'rejected') {
      exclude.push({ ...ref, title: row.title, reason: `Marked ${row.status} online; exported ${day}.` });
      continue;
    }
    if (row.template_id && row.template_id !== (filePaper.template_id || null)) {
      templateLinks.push({
        ...ref,
        title: row.title,
        template_id: row.template_id,
        reason: `Linked online (file has ${filePaper.template_id || 'no template'}); exported ${day}.`,
      });
    }
  }

  return {
    format: OVERRIDES_EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    note: 'Merge into research/library/overrides.json with `node scripts/merge-library-overrides.mjs <this file>`, then `npm run research:library`.',
    include,
    exclude,
    template_links: templateLinks,
  };
}
