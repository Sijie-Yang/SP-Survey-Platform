/*
 * Paper facets: the paper library uses the same vocabulary as templates
 * (templateFacets.js), minus "source", plus "survey" (did the paper ask people?).
 *
 * Two ways a paper gets facets:
 *  - reviewed: an admin read the abstract and saved them (analysis_meta.facets);
 *    these always win and survive re-extraction;
 *  - rules: until then they are guessed from the keyword tags in analysis_meta.
 * A reviewed paper with an empty dimension means "not stated", never "guess".
 */
import { FACET_DIMENSIONS } from './templateFacets.js';
import { ensureAnalysisMeta, isHumanEvaluationMeta } from './researchPaperMeta.mjs';

export const PAPER_FACET_KEYS = ['concept', 'task', 'modality', 'participants', 'sample', 'country', 'city'];
export const SURVEY_VALUES = ['yes', 'no'];
const OPEN_MAX = 12;

const DIMS = Object.fromEntries(FACET_DIMENSIONS.map((d) => [d.key, d]));

/** Checked facets from admin input; unknown values are reported, not saved. */
export function cleanPaperFacets(input) {
  const problems = [];
  const facets = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { facets: null, problems: ['facets must be an object like {"survey":"yes","task":["pairwise"]}'] };
  }
  for (const key of Object.keys(input)) {
    if (key !== 'survey' && !PAPER_FACET_KEYS.includes(key)) problems.push(`unknown facet "${key}"`);
  }
  if ('survey' in input) {
    if (!SURVEY_VALUES.includes(input.survey)) problems.push('survey must be "yes" or "no"');
    else facets.survey = input.survey;
  }
  for (const key of PAPER_FACET_KEYS) {
    if (!(key in input)) continue;
    const raw = Array.isArray(input[key]) ? input[key] : [input[key]];
    const dim = DIMS[key];
    const values = [];
    for (const v of raw) {
      const value = String(v ?? '').trim().slice(0, 60);
      if (!value) continue;
      if (!dim.open && !dim.values.some((x) => x.id === value)) {
        problems.push(`${key}: "${value}" is not one of ${dim.values.map((x) => x.id).join(', ')}`);
        continue;
      }
      if (!values.includes(value)) values.push(value);
    }
    facets[key] = dim.single ? values.slice(0, 1) : values.slice(0, OPEN_MAX);
  }
  return { facets, problems };
}

const CONCEPT_FROM_RULE = {
  safety: 'safety',
  greenness: 'greenery',
  walkability: 'walkability',
  aesthetics: 'aesthetics',
  thermal: 'thermal_comfort',
  comfort: 'comfort',
  preference: 'preference',
  enclosure: 'enclosure',
  liveliness: 'liveliness',
  restorativeness: 'restoration',
  complexity: 'complexity',
  oppressiveness: 'oppressiveness',
  emotion: 'emotion',
  soundscape: 'soundscape',
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
  crowdsourced: 'crowd',
  lab_convenience: 'lab',
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

/** One spelling per country, so "United Kingdom" and "UK" count together. */
const COUNTRY_ALIASES = {
  'united kingdom': 'UK',
  britain: 'UK',
  england: 'UK',
  scotland: 'UK',
  'united states': 'USA',
  'united states of america': 'USA',
  us: 'USA',
  korea: 'South Korea',
  'republic of korea': 'South Korea',
  "people's republic of china": 'China',
};

export function normalizeCountry(name) {
  const s = String(name || '').trim();
  return COUNTRY_ALIASES[s.toLowerCase()] || s;
}

function sampleFacet(meta) {
  const n = Number(meta.sample_size?.value);
  if (!Number.isFinite(n) || n <= 0) return [];
  if (n < 100) return ['lt100'];
  if (n <= 1000) return ['100to1000'];
  return ['gt1000'];
}

function mapped(ids, table) {
  return [...new Set((ids || []).map((id) => table[id]).filter(Boolean))];
}

function modalityFromRules(meta) {
  const src = meta.visual_data_sources || [];
  const pres = meta.presentation_modes || [];
  const out = [];
  if (src.some((id) => /street_view$/.test(id))) out.push('street_view');
  if ((meta.view_contexts || []).includes('window_view')) out.push('window_view');
  if ((meta.spatial_scales || []).includes('indoor')) out.push('indoor');
  if (src.includes('researcher_photos') || pres.includes('static_2d')) out.push('scene_photo');
  if (pres.includes('panorama_360')) out.push('panorama');
  if (pres.includes('immersive_vr')) out.push('vr');
  if (src.includes('rendered_synthetic')) out.push('rendered');
  if (pres.includes('video')) out.push('video');
  if (pres.includes('on_site')) out.push('in_situ');
  return out;
}

/** Facets guessed from the keyword tags (used until an admin reviews the paper). */
export function ruleFacets(meta = {}) {
  return {
    survey: isHumanEvaluationMeta(meta) ? 'yes' : null,
    concept: mapped(meta.perception_constructs, CONCEPT_FROM_RULE),
    task: mapped(meta.response_protocols, TASK_FROM_RULE),
    modality: modalityFromRules(meta),
    participants: mapped(meta.recruitment_modes, PARTICIPANTS_FROM_RULE),
    sample: sampleFacet(meta),
    country: mapped(meta.study_countries, COUNTRY_FROM_RULE),
    city: [],
  };
}

export function isReviewed(paper) {
  const f = paper?.analysis_meta?.facets;
  return !!(f && typeof f === 'object' && f.reviewed_at);
}

/** The facets the library shows: reviewed ones when present, else the rule guess. */
export function paperFacets(paper) {
  if (isReviewed(paper)) {
    const f = paper.analysis_meta.facets;
    const out = { survey: f.survey || null, reviewed: true };
    for (const key of PAPER_FACET_KEYS) {
      const values = Array.isArray(f[key]) ? f[key] : [];
      out[key] = key === 'country' ? [...new Set(values.map(normalizeCountry))] : values;
    }
    return out;
  }
  return { ...ruleFacets(ensureAnalysisMeta(paper)), reviewed: false };
}
