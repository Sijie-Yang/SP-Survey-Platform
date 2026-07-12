/**
 * Semantic Scholar + Crossref providers for Urban Perception Deep Search.
 * Node (CommonJS) — used by Express server.js only.
 */

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const CROSSREF_BASE = 'https://api.crossref.org';

const URBAN_PERCEPTION_TERMS = [
  'streetscape', 'street view', 'urban perception', 'visual preference',
  'perceived safety', 'walkability', 'place pulse', 'thermal comfort',
  'aesthetics', 'beauty', 'greenness', 'urban design', 'visual assessment',
  'image rating', 'pairwise comparison', 'crowdsourc', 'human perception',
];

const PRESET_QUERIES = {
  streetscape_perception: 'streetscape perception visual assessment',
  visual_preference: 'street view visual preference ranking',
  place_pulse: 'Place Pulse urban perception safety beautiful',
  thermal_visual: 'thermal comfort visual streetscape perception',
  perceived_safety: 'perceived safety streetscape street view',
  urban_aesthetics: 'urban aesthetics visual quality streetscape',
};

function normalizeDoi(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  s = s.replace(/^doi:\s*/i, '');
  s = s.toLowerCase().trim();
  return s || null;
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreRelevance({ title, abstract, venue, keywords }) {
  const blob = `${title || ''} ${abstract || ''} ${venue || ''} ${(keywords || []).join(' ')}`.toLowerCase();
  let score = 0;
  URBAN_PERCEPTION_TERMS.forEach((term) => {
    if (blob.includes(term.toLowerCase())) score += 1;
  });
  // Soft boost for survey / questionnaire methods
  if (/\b(survey|questionnaire|likert|rating|ranking|pairwise)\b/i.test(blob)) score += 1.5;
  if (/\b(image|photo|street view|gsv)\b/i.test(blob)) score += 1;
  return Math.round(score * 10) / 10;
}

function inferTemplateFit({ title, abstract, relevance_score }) {
  const blob = `${title || ''} ${abstract || ''}`.toLowerCase();
  if (!abstract) return 'unknown';
  const hasMethod = /\b(survey|questionnaire|participants|respondents|rating|ranking|pairwise|likert)\b/.test(blob);
  const hasVisual = /\b(image|photo|street view|streetscape|visual)\b/.test(blob);
  if (relevance_score >= 3 && hasMethod && hasVisual) return 'likely';
  if (relevance_score < 1.5) return 'unlikely';
  return 'unknown';
}

function authorsFromS2(authors) {
  return (authors || []).map((a) => a.name).filter(Boolean);
}

function authorsFromCrossref(author) {
  return (author || []).map((a) => {
    const given = a.given || '';
    const family = a.family || '';
    return `${given} ${family}`.trim() || a.name || '';
  }).filter(Boolean);
}

async function fetchJson(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const msg = body?.message || body?.error || text.slice(0, 200) || res.statusText;
      const err = new Error(`${res.status} ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function searchSemanticScholar({ query, limit = 20, yearFrom, yearTo, apiKey }) {
  const params = new URLSearchParams({
    query,
    limit: String(Math.min(100, Math.max(1, limit))),
    fields: 'paperId,title,abstract,year,authors,venue,externalIds,url,citationCount,publicationDate',
  });
  if (yearFrom || yearTo) {
    const y0 = yearFrom || 1900;
    const y1 = yearTo || new Date().getFullYear();
    params.set('year', `${y0}-${y1}`);
  }
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const data = await fetchJson(`${S2_BASE}/paper/search?${params}`, { headers });
  const papers = data?.data || [];
  return papers.map((p) => {
    const doi = normalizeDoi(p.externalIds?.DOI);
    const title = p.title || 'Untitled';
    const abstract = p.abstract || '';
    const venue = p.venue || '';
    const relevance_score = scoreRelevance({ title, abstract, venue });
    return {
      doi,
      title,
      authors: authorsFromS2(p.authors),
      year: p.year || null,
      abstract,
      venue,
      paper_url: p.url || (doi ? `https://doi.org/${doi}` : null),
      s2_paper_id: p.paperId || null,
      crossref_doi: null,
      keywords: [],
      relevance_score,
      template_fit: inferTemplateFit({ title, abstract, relevance_score }),
      sources: ['semantic_scholar'],
      raw_meta: {
        citationCount: p.citationCount,
        publicationDate: p.publicationDate,
        externalIds: p.externalIds,
      },
    };
  });
}

async function searchCrossref({ query, limit = 20, yearFrom, yearTo, mailto }) {
  const params = new URLSearchParams({
    query,
    rows: String(Math.min(100, Math.max(1, limit))),
    select: 'DOI,title,author,published-print,published-online,container-title,abstract,URL,subject,type',
  });
  const filters = [];
  if (yearFrom) filters.push(`from-pub-date:${yearFrom}`);
  if (yearTo) filters.push(`until-pub-date:${yearTo}`);
  if (filters.length) params.set('filter', filters.join(','));

  const headers = {
    Accept: 'application/json',
    'User-Agent': `SP-Survey-Platform/1.0 (mailto:${mailto || 'research@sp-survey.org'})`,
  };

  const data = await fetchJson(`${CROSSREF_BASE}/works?${params}`, { headers });
  const items = data?.message?.items || [];
  return items.map((item) => {
    const doi = normalizeDoi(item.DOI);
    const title = Array.isArray(item.title) ? (item.title[0] || 'Untitled') : (item.title || 'Untitled');
    // Crossref abstracts often contain JATS XML tags
    const abstract = String(item.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const venue = Array.isArray(item['container-title'])
      ? (item['container-title'][0] || '')
      : (item['container-title'] || '');
    const yearParts = item['published-print']?.['date-parts']?.[0]
      || item['published-online']?.['date-parts']?.[0]
      || [];
    const year = yearParts[0] || null;
    const keywords = Array.isArray(item.subject) ? item.subject : [];
    const relevance_score = scoreRelevance({ title, abstract, venue, keywords });
    return {
      doi,
      title,
      authors: authorsFromCrossref(item.author),
      year,
      abstract,
      venue,
      paper_url: item.URL || (doi ? `https://doi.org/${doi}` : null),
      s2_paper_id: null,
      crossref_doi: doi,
      keywords,
      relevance_score,
      template_fit: inferTemplateFit({ title, abstract, relevance_score }),
      sources: ['crossref'],
      raw_meta: { type: item.type },
    };
  });
}

function mergeCandidates(lists) {
  const byDoi = new Map();
  const byTitle = new Map();
  const out = [];

  const mergeInto = (existing, incoming) => {
    existing.sources = [...new Set([...(existing.sources || []), ...(incoming.sources || [])])];
    if (!existing.doi && incoming.doi) existing.doi = incoming.doi;
    if (!existing.abstract && incoming.abstract) existing.abstract = incoming.abstract;
    if (!existing.venue && incoming.venue) existing.venue = incoming.venue;
    if (!existing.s2_paper_id && incoming.s2_paper_id) existing.s2_paper_id = incoming.s2_paper_id;
    if (!existing.crossref_doi && incoming.crossref_doi) existing.crossref_doi = incoming.crossref_doi;
    if ((!existing.authors || !existing.authors.length) && incoming.authors?.length) {
      existing.authors = incoming.authors;
    }
    if ((!existing.keywords || !existing.keywords.length) && incoming.keywords?.length) {
      existing.keywords = incoming.keywords;
    }
    existing.relevance_score = Math.max(existing.relevance_score || 0, incoming.relevance_score || 0);
    existing.template_fit = inferTemplateFit(existing);
    existing.raw_meta = { ...(existing.raw_meta || {}), ...(incoming.raw_meta || {}) };
    if (!existing.paper_url && incoming.paper_url) existing.paper_url = incoming.paper_url;
    return existing;
  };

  lists.flat().forEach((paper) => {
    if (!paper?.title) return;
    const doi = normalizeDoi(paper.doi);
    if (doi && byDoi.has(doi)) {
      mergeInto(byDoi.get(doi), paper);
      return;
    }
    const tKey = `${normalizeTitleKey(paper.title)}|${paper.year || ''}`;
    if (!doi && byTitle.has(tKey)) {
      mergeInto(byTitle.get(tKey), paper);
      return;
    }
    const entry = { ...paper, doi };
    if (doi) byDoi.set(doi, entry);
    byTitle.set(tKey, entry);
    out.push(entry);
  });

  return out.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
}

async function searchBothProviders(opts = {}) {
  const {
    query,
    limit = 20,
    yearFrom = null,
    yearTo = null,
    semanticScholarApiKey = (typeof process !== 'undefined' && process.env?.SEMANTIC_SCHOLAR_API_KEY) || '',
    crossrefMailto = (typeof process !== 'undefined' && process.env?.CROSSREF_MAILTO) || '',
  } = opts;

  if (!query || !String(query).trim()) {
    throw new Error('query is required');
  }

  const errors = [];
  const results = await Promise.allSettled([
    searchSemanticScholar({
      query,
      limit,
      yearFrom,
      yearTo,
      apiKey: semanticScholarApiKey || undefined,
    }),
    searchCrossref({
      query,
      limit,
      yearFrom,
      yearTo,
      mailto: crossrefMailto || undefined,
    }),
  ]);

  const lists = [];
  const sourcesUsed = [];
  if (results[0].status === 'fulfilled') {
    lists.push(results[0].value);
    sourcesUsed.push('semantic_scholar');
  } else {
    errors.push(`semantic_scholar: ${results[0].reason?.message || results[0].reason}`);
  }
  if (results[1].status === 'fulfilled') {
    lists.push(results[1].value);
    sourcesUsed.push('crossref');
  } else {
    errors.push(`crossref: ${results[1].reason?.message || results[1].reason}`);
  }

  if (!lists.length) {
    const err = new Error(errors.join('; ') || 'Both providers failed');
    err.errors = errors;
    throw err;
  }

  return {
    papers: mergeCandidates(lists),
    sourcesUsed,
    errors,
  };
}

module.exports = {
  PRESET_QUERIES,
  URBAN_PERCEPTION_TERMS,
  normalizeDoi,
  scoreRelevance,
  inferTemplateFit,
  searchSemanticScholar,
  searchCrossref,
  mergeCandidates,
  searchBothProviders,
};
