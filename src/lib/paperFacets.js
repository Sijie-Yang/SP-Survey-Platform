/*
 * Paper facets: the paper library uses the same vocabulary as templates
 * (templateFacets.js), minus "source", plus "survey" (did the paper ask
 * people?) and the research team's institutions and countries.
 *
 * Two ways a paper gets facets:
 *  - reviewed: an admin read the paper and saved them (analysis_meta.facets);
 *    these always win and survive re-extraction;
 *  - rules: until then they are guessed from the keyword tags in analysis_meta.
 * A reviewed paper with an empty dimension means "not stated", never "guess".
 *
 * Sample size: save the number of people as sample_n and the bucket follows
 * from it, so buckets can change later without reading the papers again.
 */
import { FACET_DIMENSIONS, sampleBucket, upgradeFacets } from './templateFacets.js';
import { ensureAnalysisMeta, isHumanEvaluationMeta } from './researchPaperMeta.mjs';

export const PAPER_FACET_KEYS = FACET_DIMENSIONS.filter((d) => !d.templatesOnly).map((d) => d.key);
export const SURVEY_VALUES = ['yes', 'no'];
const OPEN_MAX = 12;
const VALUE_MAX = { team_org: 120 };

const DIMS = Object.fromEntries(FACET_DIMENSIONS.map((d) => [d.key, d]));

/** One spelling per country or region, so "United Kingdom" and "UK" count together. */
const COUNTRY_ALIASES = {
  'united kingdom': 'UK',
  britain: 'UK',
  'great britain': 'UK',
  england: 'UK',
  scotland: 'UK',
  wales: 'UK',
  'united states': 'USA',
  'united states of america': 'USA',
  us: 'USA',
  'u.s.': 'USA',
  'u.s.a.': 'USA',
  korea: 'South Korea',
  'republic of korea': 'South Korea',
  "people's republic of china": 'China',
  'mainland china': 'China',
  macao: 'Macau',
  'united arab emirates': 'UAE',
  czechia: 'Czech Republic',
  'türkiye': 'Turkey',
  turkiye: 'Turkey',
  'the netherlands': 'Netherlands',
};

export function normalizeCountry(name) {
  const s = String(name || '').trim();
  return COUNTRY_ALIASES[s.toLowerCase()] || s;
}

const isCountryKey = (key) => key === 'country' || key === 'team_country';

/**
 * Checked facets from admin input; unknown values are reported, not saved.
 * Ids of the earlier vocabulary are accepted and saved as today's ids.
 */
export function cleanPaperFacets(input) {
  const problems = [];
  const facets = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { facets: null, problems: ['facets must be an object like {"survey":"yes","task":["pairwise"],"sample_n":120}'] };
  }
  for (const key of Object.keys(input)) {
    if (key !== 'survey' && key !== 'sample_n' && !PAPER_FACET_KEYS.includes(key)) problems.push(`unknown facet "${key}"`);
  }
  if ('survey' in input) {
    if (!SURVEY_VALUES.includes(input.survey)) problems.push('survey must be "yes" or "no"');
    else facets.survey = input.survey;
  }
  const given = Object.fromEntries(PAPER_FACET_KEYS.filter((key) => key in input).map((key) => [key, input[key]]));
  const { facets: upgraded, added } = upgradeFacets(given);
  for (const key of PAPER_FACET_KEYS) {
    if (!(key in upgraded) && !(key in added)) continue;
    const dim = DIMS[key];
    const values = [];
    for (const v of [...(upgraded[key] || []), ...(added[key] || [])]) {
      let value = String(v ?? '').trim().slice(0, VALUE_MAX[key] || 60);
      if (!value) continue;
      if (isCountryKey(key)) value = normalizeCountry(value);
      if (!dim.open && !dim.values.some((x) => x.id === value)) {
        problems.push(`${key}: "${value}" is not one of ${dim.values.map((x) => x.id).join(', ')}`);
        continue;
      }
      if (!values.includes(value)) values.push(value);
    }
    facets[key] = dim.single ? values.slice(0, 1) : values.slice(0, OPEN_MAX);
  }
  if ('sample_n' in input && input.sample_n !== null && input.sample_n !== '') {
    const n = Number(input.sample_n);
    if (!Number.isInteger(n) || n < 1) problems.push('sample_n must be a whole number of people, 1 or more');
    else {
      facets.sample_n = n;
      facets.sample = [sampleBucket(n)];
    }
  }
  return { facets, problems };
}

const CONCEPT_FROM_RULE = {
  safety: 'safety',
  greenness: 'greenery',
  walkability: 'walkability',
  aesthetics: 'beauty',
  thermal: 'thermal_comfort',
  comfort: 'comfort',
  preference: 'preference',
  enclosure: 'enclosure',
  liveliness: 'liveliness',
  restorativeness: 'restoration',
  complexity: 'complexity',
  oppressiveness: 'depressing',
  emotion: 'emotion',
  soundscape: 'sound',
  place_identity: 'sense_of_place',
};

const TASK_FROM_RULE = {
  rating_scale: 'rating',
  pairwise: 'pairwise',
  ranking: 'choose_from_set',
  discrete_choice: 'choose_from_set',
  open_ended: 'open_ended',
};

const PARTICIPANTS_FROM_RULE = {
  crowdsourced: 'public',
};

export const COUNTRY_FROM_RULE = {
  china: 'China',
  usa: 'USA',
  uk: 'UK',
  japan: 'Japan',
  korea: 'South Korea',
  singapore: 'Singapore',
  australia: 'Australia',
  netherlands: 'Netherlands',
  germany: 'Germany',
  france: 'France',
  spain: 'Spain',
  italy: 'Italy',
  sweden: 'Sweden',
  austria: 'Austria',
};

function sampleFacet(meta) {
  const bucket = sampleBucket(meta.sample_size?.value);
  return bucket ? [bucket] : [];
}

function mapped(ids, table) {
  return [...new Set((ids || []).map((id) => table[id]).filter(Boolean))];
}

function modalityFromRules(meta) {
  const src = meta.visual_data_sources || [];
  const pres = meta.presentation_modes || [];
  const out = [];
  if (src.some((id) => /street_view$/.test(id))) out.push('street_view');
  if (src.includes('researcher_photos') || pres.includes('static_2d')) out.push('scene_photo');
  if (src.includes('rendered_synthetic')) out.push('rendered');
  if (pres.includes('video')) out.push('video');
  return out;
}

function sceneFromRules(meta) {
  const out = [];
  if ((meta.view_contexts || []).includes('window_view')) out.push('window_view');
  if ((meta.spatial_scales || []).includes('indoor')) out.push('indoor');
  return out;
}

function settingFromRules(meta) {
  const pres = meta.presentation_modes || [];
  const recruit = meta.recruitment_modes || [];
  const out = [];
  if (recruit.includes('crowdsourced')) out.push('online');
  if (recruit.includes('lab_convenience')) out.push('lab');
  if (pres.includes('immersive_vr')) out.push('vr');
  if (pres.includes('on_site')) out.push('in_situ');
  return out;
}

/** Facets guessed from the keyword tags (used until an admin reviews the paper). */
export function ruleFacets(meta = {}) {
  return {
    survey: isHumanEvaluationMeta(meta) ? 'yes' : null,
    concept: mapped(meta.perception_constructs, CONCEPT_FROM_RULE),
    scene: sceneFromRules(meta),
    modality: modalityFromRules(meta),
    task: mapped(meta.response_protocols, TASK_FROM_RULE),
    setting: settingFromRules(meta),
    participants: mapped(meta.recruitment_modes, PARTICIPANTS_FROM_RULE),
    sample: sampleFacet(meta),
    country: mapped(meta.study_countries, COUNTRY_FROM_RULE),
    city: [],
    team_org: [],
    team_country: [],
  };
}

export function isReviewed(paper) {
  const f = paper?.analysis_meta?.facets;
  return !!(f && typeof f === 'object' && f.reviewed_at);
}

/**
 * The facets the library shows: reviewed ones when present, else the rule
 * guess. Facets saved in the earlier vocabulary are shown as today's tags.
 */
export function paperFacets(paper) {
  if (isReviewed(paper)) {
    const f = paper.analysis_meta.facets;
    const stored = Object.fromEntries(PAPER_FACET_KEYS.map((key) => [key, Array.isArray(f[key]) ? f[key] : []]));
    const { facets: upgraded, added } = upgradeFacets(stored);
    const out = { survey: f.survey || null, reviewed: true };
    if (Number.isInteger(f.sample_n) && f.sample_n > 0) out.sample_n = f.sample_n;
    for (const key of PAPER_FACET_KEYS) {
      const dim = DIMS[key];
      let values = [...(upgraded[key] || []), ...(added[key] || [])];
      if (isCountryKey(key)) values = values.map(normalizeCountry);
      if (!dim.open) values = values.filter((v) => dim.values.some((x) => x.id === v));
      out[key] = [...new Set(values)];
    }
    if (out.sample_n) out.sample = [sampleBucket(out.sample_n)];
    return out;
  }
  return { ...ruleFacets(ensureAnalysisMeta(paper)), reviewed: false };
}
