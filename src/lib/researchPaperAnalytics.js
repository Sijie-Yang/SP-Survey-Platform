/**
 * Aggregate paper-library analysis_meta into small chart-ready series.
 */
import { ensureAnalysisMeta, sampleSizeBins, taxonomyLabel, TAXONOMY } from './researchPaperMeta.mjs';

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

function seriesFromTaxonomy(dimension, countsMap, total) {
  const terms = TAXONOMY[dimension] || [];
  return terms
    .map((t) => ({
      id: t.id,
      label: t.label,
      count: countsMap.get(t.id) || 0,
      share: total > 0 ? (countsMap.get(t.id) || 0) / total : 0,
      dimension,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function yearSeries(papers) {
  const counts = new Map();
  for (const p of papers) {
    const y = Number(p.year);
    if (!Number.isFinite(y)) continue;
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({
      id: String(year),
      label: String(year),
      count,
      share: papers.length ? count / papers.length : 0,
      dimension: 'year',
    }));
}

function venueSeries(papers, limit = 12) {
  const counts = new Map();
  for (const p of papers) {
    const v = String(p.venue || '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([venue, count]) => ({
      id: venue,
      label: venue,
      count,
      share: papers.length ? count / papers.length : 0,
      dimension: 'venue',
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
      dimension: 'sample_size',
    }))
    .filter((r) => r.count > 0);
  const sortedVals = [...values].sort((a, b) => a - b);
  const median = sortedVals.length
    ? sortedVals[Math.floor(sortedVals.length / 2)]
    : null;
  return { series, tagged, median, min: sortedVals[0] || null, max: sortedVals[sortedVals.length - 1] || null };
}

/**
 * Build analytics snapshot for the full library (charts use this; filters are separate).
 * @param {object[]} papers
 */
export function buildPaperLibraryAnalytics(papers = []) {
  const list = papers || [];
  const total = list.length;
  const years = list.map((p) => Number(p.year)).filter((y) => Number.isFinite(y));
  const yearMin = years.length ? Math.min(...years) : null;
  const yearMax = years.length ? Math.max(...years) : null;

  const perception = countIds(list, 'perception_dimensions');
  const imagery = countIds(list, 'imagery_sources');
  const scale = countIds(list, 'spatial_scales');
  const survey = countIds(list, 'survey_methods');
  const location = countIds(list, 'study_locations');
  const methods = countIds(list, 'research_methods');
  const sample = sampleSizeSeries(list);

  const coverage = {
    total,
    perception: perception.tagged,
    imagery: imagery.tagged,
    scale: scale.tagged,
    survey: survey.tagged,
    sample_size: sample.tagged,
    location: location.tagged,
    methods: methods.tagged,
  };

  return {
    total,
    yearMin,
    yearMax,
    coverage,
    byYear: yearSeries(list),
    perception: seriesFromTaxonomy('perception_dimensions', perception.counts, total),
    imagery: seriesFromTaxonomy('imagery_sources', imagery.counts, total),
    scale: seriesFromTaxonomy('spatial_scales', scale.counts, total),
    survey: seriesFromTaxonomy('survey_methods', survey.counts, total),
    researchMethods: seriesFromTaxonomy('research_methods', methods.counts, total),
    locations: seriesFromTaxonomy('study_locations', location.counts, total),
    sampleSize: sample,
    venues: venueSeries(list),
  };
}

/**
 * Does a paper match active metadata filters?
 * filters: { dimension, id }[] — AND across filters
 */
export function paperMatchesMetaFilters(paper, filters = []) {
  if (!filters?.length) return true;
  const meta = ensureAnalysisMeta(paper);
  return filters.every((f) => {
    if (!f?.dimension || !f?.id) return true;
    if (f.dimension === 'year') return String(paper.year) === String(f.id);
    if (f.dimension === 'venue') return String(paper.venue || '') === String(f.id);
    if (f.dimension === 'sample_size') return meta.sample_size?.bin === f.id;
    const fieldMap = {
      perception_dimensions: 'perception_dimensions',
      imagery_sources: 'imagery_sources',
      spatial_scales: 'spatial_scales',
      survey_methods: 'survey_methods',
      research_methods: 'research_methods',
      study_locations: 'study_locations',
      // chart-facing aliases
      perception: 'perception_dimensions',
      imagery: 'imagery_sources',
      scale: 'spatial_scales',
      survey: 'survey_methods',
      locations: 'study_locations',
      researchMethods: 'research_methods',
    };
    const field = fieldMap[f.dimension] || f.dimension;
    const ids = meta[field] || [];
    return ids.includes(f.id);
  });
}

export function filterLabel(filter) {
  if (!filter) return '';
  if (filter.dimension === 'year') return `Year ${filter.id}`;
  if (filter.dimension === 'venue') return filter.id;
  if (filter.dimension === 'sample_size') return `Sample ${taxonomyLabel('sample_size', filter.id) || filter.id}`;
  const dimMap = {
    perception: 'perception_dimensions',
    imagery: 'imagery_sources',
    scale: 'spatial_scales',
    survey: 'survey_methods',
    locations: 'study_locations',
    researchMethods: 'research_methods',
  };
  const dim = dimMap[filter.dimension] || filter.dimension;
  return taxonomyLabel(dim, filter.id) || filter.label || filter.id;
}

/** Locations chart only when enough papers are tagged. */
export const LOCATION_CHART_MIN_COVERAGE = 0.15;


