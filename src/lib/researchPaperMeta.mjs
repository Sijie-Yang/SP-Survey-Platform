/**
 * Rule-based analysis metadata for the urban-perception paper library.
 * Extracted from title + abstract + keywords (not author-native structured fields).
 */

export const EXTRACTION_VERSION = 'v1';

/** @typedef {{ id: string, label: string, pattern: RegExp }} TaxonomyTerm */

/** @type {Record<string, TaxonomyTerm[]>} */
export const TAXONOMY = {
  perception_dimensions: [
    { id: 'safety', label: 'Safety / fear of crime', pattern: /\b(safety|safe|fear of crime|crime perception|perceived security|security perception)\b/i },
    { id: 'greenness', label: 'Greenness / greenery', pattern: /\b(greenery|greenness|green space|green view|vegetation|ndvi|tree canopy)\b/i },
    { id: 'walkability', label: 'Walkability', pattern: /\b(walkab\w*|pedestrian friendliness|walkable)\b/i },
    { id: 'aesthetics', label: 'Aesthetics / beauty', pattern: /\b(aesthetic\w*|beauty|beautiful|visual quality|scenic)\b/i },
    { id: 'comfort', label: 'Comfort', pattern: /\b(comfort|comfortable|discomfort)\b/i },
    { id: 'preference', label: 'Visual preference', pattern: /\b(visual preference|preference|preferred|liking)\b/i },
    { id: 'thermal', label: 'Thermal perception', pattern: /\b(thermal comfort|thermal perception|heat perception|thermal environment)\b/i },
    { id: 'enclosure', label: 'Enclosure / openness', pattern: /\b(enclosure|openness|spaciousness|enclosed)\b/i },
    { id: 'liveliness', label: 'Liveliness / vitality', pattern: /\b(lively|liveliness|vitality|vibrancy|bustling)\b/i },
    { id: 'restorativeness', label: 'Restorativeness', pattern: /\b(restorative|restorativeness|attention restoration)\b/i },
    { id: 'complexity', label: 'Complexity / diversity', pattern: /\b(visual complexity|complexity|diversity of|architectural diversity)\b/i },
    { id: 'oppressiveness', label: 'Oppressiveness', pattern: /\b(oppressive|oppressiveness)\b/i },
  ],
  imagery_sources: [
    { id: 'google_street_view', label: 'Google Street View', pattern: /\b(google street view|\bgsv\b)\b/i },
    { id: 'other_street_view', label: 'Other street-view platforms', pattern: /\b(baidu street view|tencent street view|mapillary|karta ?view)\b/i },
    { id: 'street_view_generic', label: 'Street-view imagery (generic)', pattern: /\b(street view image\w*|street-view image\w*|street level image\w*|streetscape image\w*|street view imag(?:e|ery)|svi\b)\b/i },
    { id: 'window_view', label: 'Window view', pattern: /\b(window view\w*|window-view|view through (?:a |the )?window)\b/i },
    { id: 'vr_immersive', label: 'VR / immersive', pattern: /\b(virtual reality|immersive virtual|\bvr\b|head-mounted|hm(d|d))\b/i },
    { id: 'panoramic', label: 'Panoramic / 360°', pattern: /\b(panoram\w*|360[-\s]?degree|360°)\b/i },
    { id: 'photos_rendered', label: 'Photographs / rendered scenes', pattern: /\b(photograph\w*|photo-based|rendered image\w*|computer-generated image\w*|visual stimul\w*)\b/i },
  ],
  spatial_scales: [
    { id: 'street', label: 'Street / streetscape', pattern: /\b(streetscape\w*|street-level|street level|streets?\b)\b/i },
    { id: 'neighborhood', label: 'Neighborhood', pattern: /\b(neighbou?rhood\w*|community scale)\b/i },
    { id: 'city', label: 'City / urban', pattern: /\b(citywide|city-wide|urban scale|urban-scale|cities\b|urban area\w*)\b/i },
    { id: 'building', label: 'Building / façade', pattern: /\b(building\w*|facades?|façades?|architecture)\b/i },
    { id: 'indoor', label: 'Indoor / room', pattern: /\b(indoor|interior|classroom|office environment|room environment)\b/i },
    { id: 'window', label: 'Window / view', pattern: /\b(window view\w*|view from|view out)\b/i },
    { id: 'campus', label: 'Campus', pattern: /\bcampus\w*\b/i },
  ],
  survey_methods: [
    { id: 'questionnaire', label: 'Questionnaire / survey', pattern: /\b(questionnaire\w*|online survey\w*|field survey\w*|survey respondents?|in-field survey\w*|surveys?\b)\b/i },
    { id: 'rating_likert', label: 'Rating / Likert', pattern: /\b(likert|rating scale\w*|\brated\b|ratings?|score the images|scoring)\b/i },
    { id: 'pairwise', label: 'Pairwise comparison', pattern: /\b(pairwise|paired comparison\w*|forced[- ]choice)\b/i },
    { id: 'crowdsourcing', label: 'Crowdsourcing', pattern: /\b(crowdsourc\w*|crowd-sourc\w*)\b/i },
    { id: 'choice_experiment', label: 'Choice experiment', pattern: /\b(choice experiment\w*|discrete choice|stated preference)\b/i },
    { id: 'eye_tracking', label: 'Eye tracking', pattern: /\b(eye[- ]?track\w*|gaze)\b/i },
    { id: 'interview', label: 'Interview / focus group', pattern: /\b(interview\w*|focus group\w*)\b/i },
    { id: 'field_intercept', label: 'In-field / intercept', pattern: /\b(in-field|on-site survey\w*|intercept survey\w*|field questionnaire\w*)\b/i },
  ],
  research_methods: [
    { id: 'machine_learning', label: 'Machine learning / AI', pattern: /\b(machine learning|\bml\b|deep learning|neural network\w*|geoai|computer vision|semantic segmentation)\b/i },
    { id: 'regression', label: 'Regression / statistical model', pattern: /\b(regression|mixed[- ]effects?|anova|structural equation|sem\b)\b/i },
    { id: 'gis', label: 'GIS / spatial analysis', pattern: /\b(\bgis\b|spatial analysis|geospatial)\b/i },
  ],
  study_locations: [
    { id: 'china', label: 'China', pattern: /\b(china|chinese cities?|beijing|shanghai|guangzhou|shenzhen|wuhan|nanjing|hangzhou|chengdu|xi'?an)\b/i },
    { id: 'usa', label: 'United States', pattern: /\b(united states|\busa\b|\bu\.s\.|american cities?|new york|chicago|san francisco|boston|los angeles)\b/i },
    { id: 'europe', label: 'Europe', pattern: /\b(europe|european|london|paris|berlin|amsterdam|stockholm|vienna|barcelona|madrid)\b/i },
    { id: 'japan', label: 'Japan', pattern: /\b(japan|tokyo|osaka|kyoto)\b/i },
    { id: 'korea', label: 'Korea', pattern: /\b(korea|seoul|busan)\b/i },
    { id: 'singapore', label: 'Singapore', pattern: /\b(singapore)\b/i },
    { id: 'australia', label: 'Australia', pattern: /\b(australia|sydney|melbourne)\b/i },
    { id: 'uk', label: 'United Kingdom', pattern: /\b(united kingdom|\buk\b|britain|british)\b/i },
  ],
};

const SAMPLE_PATTERNS = [
  /\b(?:n|sample(?:\s+size)?)\s*[=:]\s*(\d{2,6})\b/gi,
  /\b(\d{2,6})\s+(?:participants?|respondents?|subjects?|volunteers?|residents?|citizens?|students?)\b/gi,
];

const SAMPLE_BINS = [
  { id: '10-49', label: '10–49', min: 10, max: 49 },
  { id: '50-99', label: '50–99', min: 50, max: 99 },
  { id: '100-499', label: '100–499', min: 100, max: 499 },
  { id: '500-999', label: '500–999', min: 500, max: 999 },
  { id: '1000+', label: '1,000+', min: 1000, max: Infinity },
];

function paperText(paper) {
  const keywords = Array.isArray(paper?.keywords) ? paper.keywords.join(' ') : '';
  return [paper?.title || '', paper?.abstract || '', keywords].join('\n');
}

function matchTerms(text, terms) {
  const hits = [];
  for (const term of terms) {
    if (term.pattern.test(text)) hits.push(term.id);
  }
  return hits;
}

function sampleBinId(n) {
  const bin = SAMPLE_BINS.find((b) => n >= b.min && n <= b.max);
  return bin ? bin.id : null;
}

/**
 * Conservatively extract a survey sample size from abstract text.
 * Returns null when no plausible N is found.
 */
export function extractSampleSize(abstract = '') {
  const text = String(abstract || '');
  const values = [];
  for (const pattern of SAMPLE_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 10 && n <= 100000) values.push(n);
    }
  }
  if (!values.length) return null;
  const value = Math.max(...values);
  return {
    value,
    bin: sampleBinId(value),
    confidence: values.length === 1 ? 'medium' : 'low',
    evidence: `matched ${values.length} candidate size(s); using max=${value}`,
  };
}

/**
 * Build analysis_meta for one paper.
 * @param {object} paper
 * @param {{ extractedAt?: string }} [opts]
 */
export function extractAnalysisMeta(paper, opts = {}) {
  const text = paperText(paper);
  const perception_dimensions = matchTerms(text, TAXONOMY.perception_dimensions);
  const imagery_sources = matchTerms(text, TAXONOMY.imagery_sources);
  const spatial_scales = matchTerms(text, TAXONOMY.spatial_scales);
  const survey_methods = matchTerms(text, TAXONOMY.survey_methods);
  const research_methods = matchTerms(text, TAXONOMY.research_methods);
  const study_locations = matchTerms(text, TAXONOMY.study_locations);
  const sample_size = extractSampleSize(paper?.abstract || '');

  return {
    extraction_version: EXTRACTION_VERSION,
    extracted_at: opts.extractedAt || new Date().toISOString(),
    perception_dimensions,
    imagery_sources,
    spatial_scales,
    survey_methods,
    research_methods,
    study_locations,
    sample_size,
    coverage_flags: {
      perception: perception_dimensions.length > 0,
      imagery: imagery_sources.length > 0,
      scale: spatial_scales.length > 0,
      survey: survey_methods.length > 0,
      sample_size: !!sample_size,
      location: study_locations.length > 0,
      methods: research_methods.length > 0,
    },
  };
}

/** Human labels for taxonomy ids (flat lookup). */
export function taxonomyLabel(dimension, id) {
  const terms = TAXONOMY[dimension] || [];
  const hit = terms.find((t) => t.id === id);
  if (hit) return hit.label;
  const bin = SAMPLE_BINS.find((b) => b.id === id);
  return bin ? bin.label : id;
}

export function sampleSizeBins() {
  return SAMPLE_BINS.map((b) => ({ id: b.id, label: b.label }));
}

/**
 * Ensure paper has analysis_meta (extract if missing / wrong version).
 */
export function ensureAnalysisMeta(paper, opts = {}) {
  const existing = paper?.analysis_meta;
  if (
    existing
    && existing.extraction_version === EXTRACTION_VERSION
    && Array.isArray(existing.perception_dimensions)
  ) {
    return existing;
  }
  return extractAnalysisMeta(paper, opts);
}

