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

export function compareSeriesToBaseline(subsetRows = [], baselineRows = []) {
  const baseMap = new Map((baselineRows || []).map((r) => [r.id, r]));
  const ids = new Set([
    ...(subsetRows || []).map((r) => r.id),
    ...(baselineRows || []).map((r) => r.id),
  ]);
  return [...ids]
    .map((id) => {
      const sub = (subsetRows || []).find((r) => r.id === id);
      const base = baseMap.get(id);
      const count = sub?.count || 0;
      const share = sub?.share || 0;
      const baselineShare = base?.share || 0;
      return {
        id,
        label: sub?.label || base?.label || id,
        dimension: sub?.dimension || base?.dimension,
        count,
        share,
        corpusShare: share,
        taggedShare: sub?.taggedShare,
        eligibleTotal: sub?.eligibleTotal,
        taggedTotal: sub?.taggedTotal,
        baselineCount: base?.count || 0,
        baselineShare,
        deltaPp: (share - baselineShare) * 100,
      };
    })
    .filter((r) => r.count > 0 || r.baselineCount > 0)
    .sort((a, b) => b.share - a.share || b.count - a.count || a.label.localeCompare(b.label));
}

export function buildCoOccurrenceMatrix(
  papers = [],
  rowField,
  colField,
  {
    rowDimension,
    colDimension,
    maxRows = 8,
    maxCols = 8,
    humanOnly = false,
  } = {},
) {
  const list = humanOnly ? humanEvaluationPapers(papers) : (papers || []);
  const rowTerms = TAXONOMY[rowField] || [];
  const colTerms = TAXONOMY[colField] || [];
  const rowCounts = new Map(rowTerms.map((t) => [t.id, 0]));
  const colCounts = new Map(colTerms.map((t) => [t.id, 0]));
  const cellCounts = new Map();
  let bothTagged = 0;

  for (const paper of list) {
    const meta = ensureAnalysisMeta(paper);
    const rows = meta[rowField] || [];
    const cols = meta[colField] || [];
    if (rows.length && cols.length) bothTagged += 1;
    for (const r of rows) rowCounts.set(r, (rowCounts.get(r) || 0) + 1);
    for (const c of cols) colCounts.set(c, (colCounts.get(c) || 0) + 1);
    for (const r of rows) {
      for (const c of cols) {
        const key = `${r}|${c}`;
        cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
      }
    }
  }

  const topRows = [...rowCounts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRows)
    .map(([id]) => id);
  const topCols = [...colCounts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCols)
    .map(([id]) => id);

  let max = 0;
  const cells = [];
  for (const r of topRows) {
    const rowTotal = rowCounts.get(r) || 0;
    for (const c of topCols) {
      const count = cellCounts.get(`${r}|${c}`) || 0;
      if (count > max) max = count;
      cells.push({
        rowId: r,
        colId: c,
        count,
        rowShare: rowTotal ? count / rowTotal : 0,
        rowDimension,
        colDimension,
        rowLabel: taxonomyLabel(rowField, r),
        colLabel: taxonomyLabel(colField, c),
      });
    }
  }

  return {
    rowField,
    colField,
    rowDimension,
    colDimension,
    humanOnly,
    effectiveN: bothTagged,
    cohortSize: list.length,
    rows: topRows.map((id) => ({
      id,
      label: taxonomyLabel(rowField, id),
      count: rowCounts.get(id) || 0,
    })),
    cols: topCols.map((id) => ({
      id,
      label: taxonomyLabel(colField, id),
      count: colCounts.get(id) || 0,
    })),
    cells,
    max,
    total: list.length,
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

export function buildLibrarySpotlights(analytics, { scopeLabel = 'Library' } = {}) {
  if (!analytics?.total) return [];
  const spots = [];
  const topPerception = analytics.perception?.[0];
  const topSource = analytics.visualSource?.[0];
  const topProtocol = analytics.responseProtocol?.[0];

  if (topPerception) {
    spots.push({
      id: 'perception',
      eyebrow: `${scopeLabel} · top construct`,
      title: topPerception.label,
      detail: `${topPerception.count} papers · ${Math.round(topPerception.share * 100)}%`,
      filter: { dimension: 'perception', id: topPerception.id, label: topPerception.label },
      tone: 'teal',
    });
  }
  if (topSource) {
    spots.push({
      id: 'visualSource',
      eyebrow: `${scopeLabel} · visual source`,
      title: topSource.label,
      detail: `${topSource.count} papers · ${Math.round(topSource.share * 100)}%`,
      filter: { dimension: 'visualSource', id: topSource.id, label: topSource.label },
      tone: 'amber',
    });
  }
  if (topProtocol) {
    spots.push({
      id: 'responseProtocol',
      eyebrow: `${scopeLabel} · response protocol`,
      title: topProtocol.label,
      detail: `${topProtocol.count} papers · ${Math.round(topProtocol.share * 100)}%`,
      filter: { dimension: 'responseProtocol', id: topProtocol.id, label: topProtocol.label },
      tone: 'moss',
    });
  }

  const byYear = analytics.byYear || [];
  const maxYear = analytics.maxYear ?? currentAnalyticsYear();
  const windowStart = maxYear - 4;
  const recent = byYear.filter((r) => {
    const y = Number(r.id);
    return y >= windowStart && y <= maxYear;
  });
  if (recent.length) {
    const recentCount = recent.reduce((s, r) => s + r.count, 0);
    const denom = byYear.reduce((s, r) => s + r.count, 0) || analytics.total;
    const share = denom ? recentCount / denom : 0;
    spots.push({
      id: 'tempo',
      eyebrow: `${scopeLabel} · tempo`,
      title: `${Math.round(share * 100)}% in ${windowStart}–${maxYear}`,
      detail: `${recentCount} of ${denom} dated papers`,
      filter: null,
      tone: 'ink',
    });
  }

  return spots.slice(0, 4);
}

function buildTrendsBundle(papers) {
  return {
    responseProtocol: buildYearShareTrends(papers, 'response_protocols', {
      dimension: 'responseProtocol',
      topN: 5,
    }),
    perception: buildYearShareTrends(papers, 'perception_constructs', {
      dimension: 'perception',
      topN: 5,
    }),
    methods: buildYearShareTrends(papers, 'research_methods', {
      dimension: 'researchMethods',
      topN: 4,
    }),
  };
}

export function buildLibraryDashboard(allPapers = [], subsetPapers = null) {
  const library = allPapers || [];
  const subset = subsetPapers == null ? library : subsetPapers;
  const baseline = buildPaperLibraryAnalytics(library);
  const focused = buildPaperLibraryAnalytics(subset);
  const isSubset = subset.length !== library.length;
  const humanFocused = humanEvaluationPapers(subset);
  const humanLibrary = humanEvaluationPapers(library);

  return {
    baseline,
    focused,
    isSubset,
    subsetTotal: subset.length,
    libraryTotal: library.length,
    humanFocusedTotal: humanFocused.length,
    humanLibraryTotal: humanLibrary.length,
    spotlights: buildLibrarySpotlights(
      isSubset ? focused : baseline,
      { scopeLabel: isSubset ? 'Focused subset' : 'Library' },
    ),
    compared: {
      perception: compareSeriesToBaseline(focused.perception, baseline.perception),
      visualSource: compareSeriesToBaseline(focused.visualSource, baseline.visualSource),
      presentation: compareSeriesToBaseline(focused.presentation, baseline.presentation),
      scale: compareSeriesToBaseline(focused.scale, baseline.scale),
      responseProtocol: compareSeriesToBaseline(focused.responseProtocol, baseline.responseProtocol),
      measurementChannel: compareSeriesToBaseline(focused.measurementChannel, baseline.measurementChannel),
      recruitment: compareSeriesToBaseline(focused.recruitment, baseline.recruitment),
      researchMethods: compareSeriesToBaseline(focused.researchMethods, baseline.researchMethods),
      countries: compareSeriesToBaseline(focused.countries, baseline.countries),
      regions: compareSeriesToBaseline(focused.regions, baseline.regions),
    },
    matrices: {
      perceptionByProtocol: buildCoOccurrenceMatrix(
        subset,
        'perception_constructs',
        'response_protocols',
        {
          rowDimension: 'perception',
          colDimension: 'responseProtocol',
          maxRows: 8,
          maxCols: 6,
          humanOnly: true,
        },
      ),
      sourceByScale: buildCoOccurrenceMatrix(
        subset,
        'visual_data_sources',
        'spatial_scales',
        {
          rowDimension: 'visualSource',
          colDimension: 'scale',
          maxRows: 6,
          maxCols: 6,
          humanOnly: false,
        },
      ),
    },
    trends: {
      focused: buildTrendsBundle(subset),
      baseline: buildTrendsBundle(library),
    },
    reporting: focused.reporting,
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
    const field = DIMENSION_FIELD[f.dimension] || f.dimension;
    const ids = meta[field] || [];
    return ids.includes(f.id);
  });
}

export function filterLabel(filter) {
  if (!filter) return '';
  if (filter.dimension === 'year') return `Year ${filter.id}`;
  if (filter.dimension === 'venue') return filter.id;
  if (filter.dimension === 'sample_size') {
    return `Sample ${taxonomyLabel('sample_size', filter.id) || filter.id}`;
  }
  const field = DIMENSION_FIELD[filter.dimension] || filter.dimension;
  return taxonomyLabel(field, filter.id) || filter.label || filter.id;
}
