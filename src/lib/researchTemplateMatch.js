/**
 * Match research_papers to existing templates via DOI / paper_url / title.
 */

export function normalizeDoi(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  s = s.replace(/^doi:\s*/i, '');
  // Prefer extracting an embedded DOI if the string is a longer URL/path
  const embedded = s.match(/10\.\d{4,9}\/[^\s"'<>#?]+/i);
  if (embedded) s = embedded[0];
  s = s.toLowerCase().replace(/\/+$/, '').trim();
  return s || null;
}

export function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract DOI from template website/paper_url or explicit doi field. */
export function templateDoi(template) {
  if (!template) return null;
  return normalizeDoi(template.doi)
    || normalizeDoi(template.website)
    || normalizeDoi(template.paper_url)
    || null;
}

export function paperDoi(paper) {
  if (!paper) return null;
  return normalizeDoi(paper.doi)
    || normalizeDoi(paper.crossref_doi)
    || normalizeDoi(paper.paper_url)
    || null;
}

function titleYearKey(title, year) {
  const t = normalizeTitleKey(title);
  if (!t) return null;
  const y = year ? String(year) : '';
  return `${t}|${y}`;
}

/**
 * Build match proposals between papers and templates.
 *
 * Priority:
 * 1. Exact DOI (confidence: doi) — default selected
 * 2. Exact normalized title + year (confidence: title_year) — default selected when unique
 * 3. Exact normalized title only (confidence: title) — suggested, not selected by default
 *
 * Does not overwrite papers that already have template_id (listed under alreadyLinked / conflicts).
 *
 * @returns {{
 *   doiMatches: object[],
 *   titleMatches: object[],
 *   alreadyLinked: object[],
 *   conflicts: object[],
 *   templatesWithDoi: number,
 *   templatesTotal: number,
 * }}
 */
export function matchPapersToTemplates(papers = [], templates = []) {
  const paperByDoi = new Map();
  const paperByTitleYear = new Map();
  const paperByTitle = new Map();

  for (const paper of papers) {
    const doi = paperDoi(paper);
    if (doi && !paperByDoi.has(doi)) paperByDoi.set(doi, paper);
    const ty = titleYearKey(paper.title, paper.year);
    if (ty && !paperByTitleYear.has(ty)) paperByTitleYear.set(ty, paper);
    const tOnly = normalizeTitleKey(paper.title);
    if (tOnly) {
      if (!paperByTitle.has(tOnly)) paperByTitle.set(tOnly, []);
      paperByTitle.get(tOnly).push(paper);
    }
  }

  const doiMatches = [];
  const titleMatches = [];
  const alreadyLinked = [];
  const conflicts = [];
  const usedPaperIds = new Set();
  const usedTemplateIds = new Set();

  let templatesWithDoi = 0;

  const consider = (template, paper, confidence) => {
    if (!template?.id || !paper?.id) return;
    if (usedTemplateIds.has(template.id) || usedPaperIds.has(paper.id)) return;

    const entry = {
      paperId: paper.id,
      paperTitle: paper.title,
      paperDoi: paperDoi(paper),
      paperYear: paper.year,
      templateId: template.id,
      templateName: template.name,
      templateApproved: !!template.is_approved,
      confidence,
      selected: confidence === 'doi' || confidence === 'title_year',
    };

    if (paper.template_id) {
      if (paper.template_id === template.id) {
        alreadyLinked.push(entry);
      } else {
        conflicts.push({
          ...entry,
          existingTemplateId: paper.template_id,
        });
      }
      return;
    }

    usedPaperIds.add(paper.id);
    usedTemplateIds.add(template.id);
    if (confidence === 'doi') doiMatches.push(entry);
    else titleMatches.push(entry);
  };

  // Pass 1: DOI
  for (const template of templates) {
    const doi = templateDoi(template);
    if (doi) templatesWithDoi += 1;
    if (!doi) continue;
    const paper = paperByDoi.get(doi);
    if (paper) consider(template, paper, 'doi');
  }

  // Pass 2: title + year
  for (const template of templates) {
    if (usedTemplateIds.has(template.id)) continue;
    const ty = titleYearKey(template.name, template.year);
    if (!ty) continue;
    const paper = paperByTitleYear.get(ty);
    if (paper) consider(template, paper, 'title_year');
  }

  // Pass 3: title only when unique on both sides
  for (const template of templates) {
    if (usedTemplateIds.has(template.id)) continue;
    const tOnly = normalizeTitleKey(template.name);
    if (!tOnly) continue;
    const candidates = (paperByTitle.get(tOnly) || []).filter((p) => !usedPaperIds.has(p.id) && !p.template_id);
    if (candidates.length === 1) consider(template, candidates[0], 'title');
  }

  const sortFn = (a, b) => String(a.paperTitle || '').localeCompare(String(b.paperTitle || ''));
  doiMatches.sort(sortFn);
  titleMatches.sort(sortFn);
  alreadyLinked.sort(sortFn);
  conflicts.sort(sortFn);

  return {
    doiMatches,
    titleMatches,
    alreadyLinked,
    conflicts,
    templatesWithDoi,
    templatesTotal: templates.length,
  };
}

/** Flatten selected proposals for apply. */
export function selectedMatchRows(matchResult, overrides = {}) {
  const rows = [
    ...(matchResult?.doiMatches || []),
    ...(matchResult?.titleMatches || []),
  ];
  return rows.filter((row) => {
    if (Object.prototype.hasOwnProperty.call(overrides, row.paperId)) {
      return !!overrides[row.paperId];
    }
    return !!row.selected;
  });
}

/**
 * Rank templates for one paper (manual picker suggestions).
 * Returns [{ template, confidence, score }] sorted best-first.
 */
export function suggestTemplatesForPaper(paper, templates = [], { limit = 25 } = {}) {
  if (!paper) return [];
  const pDoi = paperDoi(paper);
  const pTitle = normalizeTitleKey(paper.title);
  const pTy = titleYearKey(paper.title, paper.year);
  const scored = [];

  for (const template of templates) {
    if (!template?.id) continue;
    const tDoi = templateDoi(template);
    const tTitle = normalizeTitleKey(template.name);
    const tTy = titleYearKey(template.name, template.year);
    let confidence = null;
    let score = 0;

    if (pDoi && tDoi && pDoi === tDoi) {
      confidence = 'doi';
      score = 100;
    } else if (pTy && tTy && pTy === tTy) {
      confidence = 'title_year';
      score = 80;
    } else if (pTitle && tTitle && pTitle === tTitle) {
      confidence = 'title';
      score = 60;
    } else if (pTitle && tTitle && (tTitle.includes(pTitle) || pTitle.includes(tTitle)) && pTitle.length > 12) {
      confidence = 'title_partial';
      score = 30;
    } else {
      continue;
    }

    scored.push({
      template,
      templateId: template.id,
      templateName: template.name,
      templateApproved: !!template.is_approved,
      templateDoi: tDoi,
      confidence,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || String(a.templateName).localeCompare(String(b.templateName)));
  return scored.slice(0, limit);
}

/** Client-side filter of templates by free text (id/name/doi/year). */
export function filterTemplatesByQuery(templates = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return templates.slice(0, 40);
  return templates.filter((t) => {
    const hay = [
      t.id,
      t.name,
      t.author,
      t.year,
      t.website,
      t.paper_url,
      templateDoi(t),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  }).slice(0, 40);
}
