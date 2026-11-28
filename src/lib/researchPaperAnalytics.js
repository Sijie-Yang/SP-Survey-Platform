/**
 * Aggregate paper-library analysis_meta (taxonomy v4) into chart-ready series.
 */
import {
  ensureAnalysisMeta,
  sampleSizeBins,
  taxonomyLabel,
  TAXONOMY,
  REPORTING_SIGNALS,
  isHumanEvaluationMeta,
} from './researchPaperMeta.mjs';
import { PAPER_FACET_KEYS, paperFacets } from './paperFacets';
import { CONCEPT_GROUPS, FACET_DIMENSIONS, conceptGroup, facetLabel } from './templateFacets';

/** Canonical chart/filter dimension → analysis_meta field */
export const DIMENSION_FIELD = {
  perception: 'perception_constructs',
  visualSource: 'visual_data_sources',
  presentation: 'presentation_modes',
  viewContext: 'view_contexts',
  scale: 'spatial_scales',
  responseProtocol: 'response_protocols',
  measurementChannel: 'measurement_channels',
  recruitment: 'recruitment_modes',
  researchMethods: 'research_methods',
  countries: 'study_countries',
  regions: 'study_regions',
  perception_constructs: 'perception_constructs',
  visual_data_sources: 'visual_data_sources',
  presentation_modes: 'presentation_modes',
  view_contexts: 'view_contexts',
  spatial_scales: 'spatial_scales',
  response_protocols: 'response_protocols',
  measurement_channels: 'measurement_channels',
  recruitment_modes: 'recruitment_modes',
  research_methods: 'research_methods',
  study_countries: 'study_countries',
  study_regions: 'study_regions',
};

export const FIELD_DIMENSION = {
  perception_constructs: 'perception',
  visual_data_sources: 'visualSource',
  presentation_modes: 'presentation',
  view_contexts: 'viewContext',
  spatial_scales: 'scale',
  response_protocols: 'responseProtocol',
  measurement_channels: 'measurementChannel',
  recruitment_modes: 'recruitment',
  research_methods: 'researchMethods',
  study_countries: 'countries',
  study_regions: 'regions',
};

export const LOCATION_CHART_MIN_COVERAGE = 0.08;

export function currentAnalyticsYear(now = new Date()) {
  return now.getFullYear();
}

export function humanEvaluationPapers(papers = []) {
  return (papers || []).filter((p) => isHumanEvaluationMeta(ensureAnalysisMeta(p)));
}

function countIds(papers, field) {
  const counts = new Map();
  let tagged = 0;
  for (const paper of papers) {
    const meta = ensureAnalysisMeta(paper);
    const ids = meta[field] || [];
    if (ids.length) tagged += 1;
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { counts, tagged };
}

function buildDimensionSeries(papers, field, dimension) {
  const { counts, tagged } = countIds(papers, field);
  const eligibleTotal = papers.length;
  const terms = TAXONOMY[field] || [];
  return terms
    .map((t) => {
      const count = counts.get(t.id) || 0;
      return {
        id: t.id,
        label: t.label,
        count,
        corpusShare: eligibleTotal > 0 ? count / eligibleTotal : 0,
        taggedShare: tagged > 0 ? count / tagged : 0,
        share: eligibleTotal > 0 ? count / eligibleTotal : 0,
        eligibleTotal,
        taggedTotal: tagged,
        dimension,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function coverageFlagCount(papers, flag) {
  let n = 0;
  for (const paper of papers) {
    const meta = ensureAnalysisMeta(paper);
    if (meta.coverage_flags?.[flag]) n += 1;
  }
  return n;
}

function yearSeries(papers, { maxYear = currentAnalyticsYear() } = {}) {
  const counts = new Map();
  for (const p of papers) {
    const y = Number(p.year);
    if (!Number.isFinite(y) || y > maxYear) continue;
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  const eligible = papers.filter((p) => {
    const y = Number(p.year);
    return Number.isFinite(y) && y <= maxYear;
  }).length;
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({
      id: String(year),
      label: String(year),
      count,
      share: eligible ? count / eligible : 0,
      corpusShare: eligible ? count / eligible : 0,
      eligibleTotal: eligible,
      dimension: 'year',
    }));
}

function sampleSizeSeries(papers) {
  const bins = sampleSizeBins();
  const counts = new Map(bins.map((b) => [b.id, 0]));
  let tagged = 0;
  const values = [];
  for (const paper of papers) {
    const meta = ensureAnalysisMeta(paper);
    const sample = meta.sample_size;
    if (!sample?.bin) continue;
    tagged += 1;
    values.push(sample.value);
    counts.set(sample.bin, (counts.get(sample.bin) || 0) + 1);
  }
  const series = bins
    .map((b) => ({
      id: b.id,
      label: b.label,
      count: counts.get(b.id) || 0,
      share: tagged ? (counts.get(b.id) || 0) / tagged : 0,
      corpusShare: papers.length ? (counts.get(b.id) || 0) / papers.length : 0,
      taggedShare: tagged ? (counts.get(b.id) || 0) / tagged : 0,
      eligibleTotal: papers.length,
      taggedTotal: tagged,
      dimension: 'sample_size',
    }))
    .filter((r) => r.count > 0);
  const sortedVals = [...values].sort((a, b) => a - b);
  const median = sortedVals.length
    ? sortedVals[Math.floor(sortedVals.length / 2)]
    : null;
  return {
    series,
    tagged,
    median,
    min: sortedVals[0] || null,
    max: sortedVals[sortedVals.length - 1] || null,
  };
}

function reportingSeries(papers) {
  const total = papers.length;
  const counts = new Map(REPORTING_SIGNALS.map((s) => [s.id, 0]));
  let sampleTagged = 0;
  for (const paper of papers) {
    const meta = ensureAnalysisMeta(paper);
    if (meta.sample_size) sampleTagged += 1;
    for (const id of meta.reporting_signals || []) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const signals = REPORTING_SIGNALS.map((s) => ({
    id: s.id,
    label: s.label,
    count: counts.get(s.id) || 0,
    share: total ? (counts.get(s.id) || 0) / total : 0,
  }));
  const idx = signals.findIndex((s) => s.id === 'participant_sample');
  if (idx >= 0 && signals[idx].count < sampleTagged) {
    signals[idx] = {
      ...signals[idx],
      count: sampleTagged,
      share: total ? sampleTagged / total : 0,
    };
  }
  return { total, signals };
}

function scopeBreakdown(papers) {
  const counts = {
    human_evaluation: 0,
    computational_only: 0,
    review_conceptual: 0,
    uncertain: 0,
  };
  for (const paper of papers) {
    const scope = ensureAnalysisMeta(paper).analysis_scope || 'uncertain';
    counts[scope] = (counts[scope] || 0) + 1;
  }
  return counts;
}

export function buildPaperLibraryAnalytics(papers = [], opts = {}) {
  const maxYear = opts.maxYear ?? currentAnalyticsYear();
  const list = papers || [];
  const total = list.length;
  const human = humanEvaluationPapers(list);
  const years = list
    .map((p) => Number(p.year))
    .filter((y) => Number.isFinite(y) && y <= maxYear);
  const yearMin = years.length ? Math.min(...years) : null;
  const yearMax = years.length ? Math.max(...years) : null;

  const sample = sampleSizeSeries(list);
  const reporting = reportingSeries(list);
  const scopes = scopeBreakdown(list);

  const coverage = {
    total,
    human_evaluation: scopes.human_evaluation,
    perception: coverageFlagCount(list, 'perception'),
    visual_source: coverageFlagCount(list, 'visual_source'),
    presentation: coverageFlagCount(list, 'presentation'),
    view_context: coverageFlagCount(list, 'view_context'),
    scale: coverageFlagCount(list, 'scale'),
    response_protocol: coverageFlagCount(list, 'response_protocol'),
    measurement_channel: coverageFlagCount(list, 'measurement_channel'),
    recruitment: coverageFlagCount(list, 'recruitment'),
    sample_size: sample.tagged,
    country: coverageFlagCount(list, 'country'),
    region: coverageFlagCount(list, 'region'),
    methods: coverageFlagCount(list, 'methods'),
    reporting: coverageFlagCount(list, 'reporting'),
  };

  return {
    total,
    yearMin,
    yearMax,
    maxYear,
    scopes,
    coverage,
    humanEvaluationTotal: human.length,
    byYear: yearSeries(list, { maxYear }),
    perception: buildDimensionSeries(list, 'perception_constructs', 'perception'),
    visualSource: buildDimensionSeries(list, 'visual_data_sources', 'visualSource'),
    presentation: buildDimensionSeries(list, 'presentation_modes', 'presentation'),
    viewContext: buildDimensionSeries(list, 'view_contexts', 'viewContext'),
    scale: buildDimensionSeries(list, 'spatial_scales', 'scale'),
    responseProtocol: buildDimensionSeries(list, 'response_protocols', 'responseProtocol'),
    measurementChannel: buildDimensionSeries(list, 'measurement_channels', 'measurementChannel'),
    recruitment: buildDimensionSeries(list, 'recruitment_modes', 'recruitment'),
    researchMethods: buildDimensionSeries(list, 'research_methods', 'researchMethods'),
    countries: buildDimensionSeries(list, 'study_countries', 'countries'),
    regions: buildDimensionSeries(list, 'study_regions', 'regions'),
    sampleSize: sample,
    reporting,
  };
}

export function buildYearShareTrends(
  papers = [],
  field,
  {
    dimension,
    maxYear = currentAnalyticsYear(),
    windowYears = 8,
    topN = 5,
    minYearN = 8,
  } = {},
) {
  const terms = TAXONOMY[field] || [];
  const yearTotals = new Map();
  const yearTag = new Map();

  for (const paper of papers) {
    const y = Number(paper.year);
    if (!Number.isFinite(y) || y > maxYear) continue;
    yearTotals.set(y, (yearTotals.get(y) || 0) + 1);
    const meta = ensureAnalysisMeta(paper);
    const ids = meta[field] || [];
    if (!yearTag.has(y)) yearTag.set(y, new Map());
    const m = yearTag.get(y);
    for (const id of ids) m.set(id, (m.get(id) || 0) + 1);
  }

  const years = [...yearTotals.keys()].sort((a, b) => a - b);
  const recentYears = years.slice(-windowYears);
  if (!recentYears.length) {
    return { years: [], series: [], emerging: [], established: [], field, dimension };
  }

  const recentCounts = new Map();
  for (const y of recentYears) {
    const m = yearTag.get(y) || new Map();
    for (const [id, n] of m.entries()) {
      recentCounts.set(id, (recentCounts.get(id) || 0) + n);
    }
  }
  const topIds = [...recentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id]) => id);

  const series = topIds.map((id) => {
    const term = terms.find((t) => t.id === id);
    const points = recentYears.map((y) => {
      const total = yearTotals.get(y) || 0;
      const count = (yearTag.get(y) || new Map()).get(id) || 0;
      return {
        year: y,
        count,
        share: total ? count / total : 0,
        yearN: total,
        stable: total >= minYearN,
      };
    });
    const stablePoints = points.filter((p) => p.stable);
    const use = stablePoints.length >= 2 ? stablePoints : points;
    const first = use.slice(0, Math.max(1, Math.floor(use.length / 2)));
    const last = use.slice(Math.floor(use.length / 2));
    const avg = (arr) => (arr.length
      ? arr.reduce((s, p) => s + p.share, 0) / arr.length
      : 0);
    const slope = avg(last) - avg(first);
    return {
      id,
      label: term?.label || taxonomyLabel(field, id),
      dimension,
      points,
      slope,
      recentCount: recentCounts.get(id) || 0,
    };
  });

  const emerging = [...series]
    .filter((s) => s.slope > 0.02 && s.recentCount >= 5)
    .sort((a, b) => b.slope - a.slope)
    .slice(0, 4);
  const established = [...series]
    .sort((a, b) => b.recentCount - a.recentCount)
    .slice(0, 4);

  return {
    years: recentYears,
    series,
    emerging,
    established,
    field,
    dimension,
  };
}

/**
 * The cards on the public paper library page, in order. They use the same
 * facet vocabulary as templates (paperFacets.js): reviewed facets when an
 * admin has read the paper, otherwise a guess from the keyword tags.
 */
export const SIMPLE_CARDS = [
  // Perception shows every tag, laid out by its six groups.
  { dimension: 'concept', trend: true, grouped: true },
  { dimension: 'scene', trend: true },
  { dimension: 'modality', trend: true },
  { dimension: 'task', trend: true, lowCoverageNote: true },
  { dimension: 'setting', trend: true, lowCoverageNote: true },
  { dimension: 'participants', trend: false, lowCoverageNote: true },
  { dimension: 'sample', trend: false, lowCoverageNote: true, fixedOrder: true },
  { dimension: 'country', trend: false, lowCoverageNote: true },
  { dimension: 'city', trend: false, lowCoverageNote: true },
  { dimension: 'team_org', trend: false, wide: true, topN: 10 },
  { dimension: 'team_country', trend: false, wide: true, topN: 10 },
];

/** Years shown one by one; anything older goes into one "earlier" bar. */
export const SIMPLE_YEAR_SPAN = 12;

const FACET_DIMS = new Set(PAPER_FACET_KEYS);

export function isPaperFacetDimension(dimension) {
  return FACET_DIMS.has(dimension);
}

/**
 * Ids whose share of papers grew over the last years (same rule as before:
 * later half of the window beats the earlier half by > 2 points, ≥ 5 papers).
 */
function risingIds(list, idsOf, maxYear, windowYears = 8, minYearN = 8) {
  const totals = new Map();
  const tags = new Map();
  for (const p of list) {
    const y = Number(p.year);
    if (!Number.isFinite(y) || y > maxYear) continue;
    totals.set(y, (totals.get(y) || 0) + 1);
    if (!tags.has(y)) tags.set(y, new Map());
    const m = tags.get(y);
    for (const id of idsOf(p)) m.set(id, (m.get(id) || 0) + 1);
  }
  const years = [...totals.keys()].sort((a, b) => a - b).slice(-windowYears);
  const stable = years.filter((y) => totals.get(y) >= minYearN);
  const use = stable.length >= 2 ? stable : years;
  if (use.length < 2) return new Set();
  const ids = new Set();
  for (const y of years) for (const id of (tags.get(y) || new Map()).keys()) ids.add(id);
  const out = new Set();
  const half = Math.max(1, Math.floor(use.length / 2));
  for (const id of ids) {
    const share = (y) => ((tags.get(y) || new Map()).get(id) || 0) / totals.get(y);
    const avg = (arr) => arr.reduce((sum, y) => sum + share(y), 0) / arr.length;
    const recent = years.reduce((sum, y) => sum + ((tags.get(y) || new Map()).get(id) || 0), 0);
    if (avg(use.slice(Math.floor(use.length / 2))) - avg(use.slice(0, half)) > 0.02 && recent >= 5) out.add(id);
  }
  return out;
}

/**
 * Everything the simple library panel needs, computed on ONE paper set
 * (whatever the reader has filtered down to). No baseline overlay, no tabs.
 */
export function buildSimpleLibraryView(papers = [], { maxYear = currentAnalyticsYear(), topN = 6 } = {}) {
  const list = papers || [];
  const total = list.length;

  const yearCounts = new Map();
  let dated = 0;
  for (const p of list) {
    const y = Number(p.year);
    if (!Number.isFinite(y) || y > maxYear || y < 1900) continue;
    dated += 1;
    yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
  }
  const firstShown = maxYear - SIMPLE_YEAR_SPAN + 1;
  let earlier = 0;
  for (const [y, n] of yearCounts) if (y < firstShown) earlier += n;
  const years = [];
  if (earlier) years.push({ id: null, label: `≤${firstShown - 1}`, count: earlier, earlier: true });
  for (let y = firstShown; y <= maxYear; y += 1) {
    years.push({ id: String(y), label: String(y), count: yearCounts.get(y) || 0 });
  }
  const recentFrom = maxYear - 4;
  let recent = 0;
  for (const [y, n] of yearCounts) if (y >= recentFrom) recent += n;
  const allYears = [...yearCounts.keys()];

  const facetsOf = new Map(list.map((p) => [p, paperFacets(p)]));
  const reviewed = list.filter((p) => facetsOf.get(p).reviewed).length;

  const cards = SIMPLE_CARDS.map((card) => {
    const idsOf = (p) => facetsOf.get(p)[card.dimension] || [];
    const counts = new Map();
    let tagged = 0;
    for (const p of list) {
      const ids = idsOf(p);
      if (ids.length) tagged += 1;
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const rising = card.trend ? risingIds(list, idsOf, maxYear) : new Set();
    const order = (FACET_DIMENSIONS.find((d) => d.key === card.dimension)?.values || []).map((v) => v.id);
    const sorted = [...counts.entries()]
      .map(([id, count]) => ({
        id, label: facetLabel(card.dimension, id, false), count, rising: rising.has(id), dimension: card.dimension,
      }))
      .sort((a, b) => (card.fixedOrder
        ? order.indexOf(a.id) - order.indexOf(b.id)
        : b.count - a.count || a.label.localeCompare(b.label)));
    const rows = card.grouped ? sorted : sorted.slice(0, card.topN || topN);
    return {
      dimension: card.dimension,
      tagged,
      total,
      lowCoverage: !!card.lowCoverageNote && total > 0 && tagged / total < 0.3,
      wide: !!card.wide,
      rows,
      // Perception: the same rows split into the six groups, most used first inside each.
      groups: card.grouped
        ? CONCEPT_GROUPS.map((g) => ({ id: g.id, en: g.en, zh: g.zh, rows: sorted.filter((r) => conceptGroup(r.id) === g.id) }))
          .filter((g) => g.rows.length)
        : null,
    };
  });

  return {
    total,
    dated,
    reviewed,
    yearMin: allYears.length ? Math.min(...allYears) : null,
    yearMax: allYears.length ? Math.max(...allYears) : null,
    recentFrom,
    recentShare: dated ? recent / dated : 0,
    years,
    cards,
  };
}

export function canonicalFilterDimension(dimension) {
  if (!dimension) return dimension;
  if (dimension === 'year' || dimension === 'venue' || dimension === 'sample_size') {
    return dimension;
  }
  const field = DIMENSION_FIELD[dimension];
  if (!field) return dimension;
  return FIELD_DIMENSION[field] || dimension;
}

export function normalizeMetaFilters(filters = []) {
  const seenFields = new Set();
  const cleaned = [];
  for (const f of filters || []) {
    if (!f?.dimension || !f?.id) continue;
    const dim = canonicalFilterDimension(f.dimension);
    if (dim === 'year' || dim === 'venue' || dim === 'sample_size') {
      if (seenFields.has(dim)) continue;
      seenFields.add(dim);
      cleaned.push({ ...f, dimension: dim });
      continue;
    }
    const field = DIMENSION_FIELD[dim] || dim;
    if (seenFields.has(field)) continue;
    seenFields.add(field);
    cleaned.push({ ...f, dimension: dim });
  }
  return cleaned;
}

export function paperMatchesMetaFilters(paper, filters = []) {
  const normalized = normalizeMetaFilters(filters);
  if (!normalized.length) return true;
  const meta = ensureAnalysisMeta(paper);
  return normalized.every((f) => {
    if (!f?.dimension || !f?.id) return true;
    if (f.dimension === 'year') return String(paper.year) === String(f.id);
    if (f.dimension === 'venue') return String(paper.venue || '') === String(f.id);
    if (f.dimension === 'sample_size') return meta.sample_size?.bin === f.id;
    if (isPaperFacetDimension(f.dimension)) return (paperFacets(paper)[f.dimension] || []).includes(f.id);
    const field = DIMENSION_FIELD[f.dimension] || f.dimension;
    const ids = meta[field] || [];
    return ids.includes(f.id);
  });
}

export function filterLabel(filter) {
  if (!filter) return '';
  if (filter.dimension === 'year') return `Year ${filter.id}`;
  if (filter.dimension === 'venue') return filter.id;
  if (isPaperFacetDimension(filter.dimension)) return facetLabel(filter.dimension, filter.id, false);
  if (filter.dimension === 'sample_size') {
    return `Sample ${taxonomyLabel('sample_size', filter.id) || filter.id}`;
  }
  const field = DIMENSION_FIELD[filter.dimension] || filter.dimension;
  return taxonomyLabel(field, filter.id) || filter.label || filter.id;
}
