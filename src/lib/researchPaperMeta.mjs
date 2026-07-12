/**
 * Rule-based analysis metadata for the urban-perception paper library (taxonomy v4).
 *
 * Schema principles:
 * - dimensions are single-responsibility layers (construct / source / presentation / scale / protocol / channel / recruitment / country / region)
 * - ordered matching with phrase-level precedence (not blunt document-wide exclusivity)
 * - analysis_scope cohorts separate full library from human-evaluation analytics
 * - no persisted survey_methods alias; legacy readers migrate at ensureAnalysisMeta
 */

export const EXTRACTION_VERSION = 'v4';

/** @typedef {{ id: string, label: string, pattern: RegExp, exclude?: RegExp, require?: RegExp, priority?: number, chart?: boolean }} TaxonomyTerm */
/** @typedef {{ id: string, label: string, field: string, cardinality: 'single'|'multi', chart: boolean, terms: TaxonomyTerm[] }} TaxonomyDimension */

const COUNTRY_TO_REGION = {
  china: 'east_asia',
  japan: 'east_asia',
  korea: 'east_asia',
  singapore: 'southeast_asia',
  usa: 'north_america',
  uk: 'europe',
  australia: 'oceania',
};

/** City / country phrase → ISO-ish country id */
const LOCATION_PHRASES = [
  { id: 'china', label: 'China', pattern: /\b(china|chinese cities?|beijing|shanghai|guangzhou|shenzhen|wuhan|nanjing|hangzhou|chengdu|xi'?an|qingdao|tianjin|suzhou|xiamen)\b/i },
  { id: 'usa', label: 'United States', pattern: /\b(united states|\busa\b|\bu\.s\.a?\b|american cities?|new york|chicago|san francisco|boston|los angeles|seattle|philadelphia)\b/i },
  { id: 'uk', label: 'United Kingdom', pattern: /\b(united kingdom|\buk\b|britain|british|london|manchester|birmingham|edinburgh|glasgow)\b/i },
  { id: 'japan', label: 'Japan', pattern: /\b(japan|tokyo|osaka|kyoto|yokohama)\b/i },
  { id: 'korea', label: 'Korea', pattern: /\b(south korea|korea|seoul|busan)\b/i },
  { id: 'singapore', label: 'Singapore', pattern: /\b(singapore)\b/i },
  { id: 'australia', label: 'Australia', pattern: /\b(australia|sydney|melbourne|brisbane)\b/i },
  { id: 'netherlands', label: 'Netherlands', pattern: /\b(netherlands|dutch|amsterdam|rotterdam)\b/i },
  { id: 'germany', label: 'Germany', pattern: /\b(germany|german cities?|berlin|munich|hamburg)\b/i },
  { id: 'france', label: 'France', pattern: /\b(france|french cities?|paris|lyon)\b/i },
  { id: 'spain', label: 'Spain', pattern: /\b(spain|spanish cities?|barcelona|madrid)\b/i },
  { id: 'italy', label: 'Italy', pattern: /\b(italy|italian cities?|milan|rome|florence)\b/i },
  { id: 'sweden', label: 'Sweden', pattern: /\b(sweden|stockholm|gothenburg)\b/i },
  { id: 'austria', label: 'Austria', pattern: /\b(austria|vienna)\b/i },
];

const REGION_TERMS = [
  { id: 'east_asia', label: 'East Asia', pattern: /\b(east asia|east asian)\b/i },
  { id: 'southeast_asia', label: 'Southeast Asia', pattern: /\b(southeast asia|south-east asia)\b/i },
  { id: 'europe', label: 'Europe', pattern: /\b(europe|european)\b/i },
  { id: 'north_america', label: 'North America', pattern: /\b(north america|north american)\b/i },
  { id: 'oceania', label: 'Oceania', pattern: /\b(oceania|australasia)\b/i },
];

/**
 * Canonical taxonomy registry (chart-facing dimensions).
 * @type {Record<string, TaxonomyDimension>}
 */
export const TAXONOMY_REGISTRY = {
  perception_constructs: {
    id: 'perception_constructs',
    label: 'Perception constructs',
    field: 'perception_constructs',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'safety', label: 'Safety / fear of crime', pattern: /\b(perceived safety|fear of crime|crime perception|perceived security|security perception|feel(?:ing)? safe)\b/i, exclude: /\b(road safety|traffic safety|cycling safety|pedestrian safety|crash|collision)\b/i, priority: 10 },
      { id: 'greenness', label: 'Greenness / greenery', pattern: /\b(greenery|greenness|green space|green view|perceived green(?:ery|ness)?|vegetation perception)\b/i, priority: 10 },
      { id: 'walkability', label: 'Walkability', pattern: /\b(walkab\w*|pedestrian friendliness|walkable)\b/i, priority: 10 },
      { id: 'aesthetics', label: 'Aesthetics / beauty', pattern: /\b(aesthetic\w*|beauty|beautiful|visual quality|scenic|pleasantness|pleasant)\b/i, priority: 10 },
      { id: 'thermal', label: 'Thermal perception', pattern: /\b(thermal comfort|thermal perception|heat perception|thermal environment)\b/i, priority: 20 },
      { id: 'comfort', label: 'Comfort (non-thermal)', pattern: /\b(perceived comfort|visual comfort|environmental comfort|discomfort)\b/i, exclude: /\bthermal\b/i, priority: 5 },
      { id: 'preference', label: 'Visual preference', pattern: /\b(visual preference|preference rating|preferred scene|preference for (?:the )?view)\b/i, priority: 15 },
      { id: 'enclosure', label: 'Enclosure / openness', pattern: /\b(enclosure|openness|spaciousness|enclosed)\b/i, priority: 10 },
      { id: 'liveliness', label: 'Liveliness / vitality', pattern: /\b(lively|liveliness|vitality|vibrancy|bustling|urban vitality)\b/i, priority: 10 },
      { id: 'restorativeness', label: 'Restorativeness', pattern: /\b(restorative|restorativeness|attention restoration)\b/i, priority: 10 },
      { id: 'complexity', label: 'Visual complexity', pattern: /\b(visual complexity|architectural diversity)\b/i, priority: 10 },
      { id: 'oppressiveness', label: 'Oppressiveness', pattern: /\b(oppressive|oppressiveness)\b/i, priority: 10 },
    ],
  },
  visual_data_sources: {
    id: 'visual_data_sources',
    label: 'Visual data sources',
    field: 'visual_data_sources',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'google_street_view', label: 'Google Street View', pattern: /\b(google street view|\bgsv\b)\b/i, priority: 30 },
      { id: 'other_street_view', label: 'Other web street-view', pattern: /\b(baidu street view|tencent street view|mapillary|karta ?view)\b/i, priority: 30 },
      { id: 'unspecified_street_view', label: 'Street-view (unspecified)', pattern: /\b(street view image\w*|street-view image\w*|street level image\w*|streetscape image\w*|street view imag(?:e|ery)|street-view imag(?:e|ery)|\bsvi\b)\b/i, priority: 5 },
      { id: 'researcher_photos', label: 'Researcher / site photos', pattern: /\b((?:site|field|taken|captured|on-site) (?:photo|photograph)\w*|photograph(?:s|ed)? (?:of|from) (?:the )?(?:street|site|scene))\b/i, exclude: /\b(aerial|satellite|remote sensing|drone)\b/i, priority: 15 },
      { id: 'rendered_synthetic', label: 'Rendered / synthetic scenes', pattern: /\b(rendered image\w*|computer-generated image\w*|synthetic image\w*|cgi\b|visual stimul\w*)\b/i, priority: 15 },
    ],
  },
  presentation_modes: {
    id: 'presentation_modes',
    label: 'Presentation modes',
    field: 'presentation_modes',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'immersive_vr', label: 'Immersive VR', pattern: /\b(virtual reality|immersive virtual|\bvr\b|head-mounted|hmd\b)\b/i, exclude: /\b(svr|overview)\b/i, priority: 20 },
      { id: 'panorama_360', label: 'Panorama / 360°', pattern: /\b(panoram\w*|360[-\s]?degree|360°)\b/i, priority: 15 },
      { id: 'static_2d', label: 'Static 2D images', pattern: /\b(static image\w*|2d image\w*|photograph\w*|photo-based)\b/i, exclude: /\b(aerial|satellite|remote sensing)\b/i, priority: 5 },
    ],
  },
  view_contexts: {
    id: 'view_contexts',
    label: 'View contexts',
    field: 'view_contexts',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'window_view', label: 'Window view', pattern: /\b(window view\w*|window-view|view through (?:a |the )?window|view from (?:a |the )?window)\b/i, priority: 20 },
    ],
  },
  spatial_scales: {
    id: 'spatial_scales',
    label: 'Spatial scales',
    field: 'spatial_scales',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'street', label: 'Street / streetscape', pattern: /\b(streetscape\w*|street-level|street level|street[- ]scale|street unit)\b/i, priority: 20 },
      { id: 'neighborhood', label: 'Neighborhood', pattern: /\b(neighbou?rhood\w*|community scale|district[- ]scale)\b/i, priority: 15 },
      { id: 'city', label: 'City / urban scale', pattern: /\b(citywide|city-wide|city[- ]scale|urban[- ]scale|metropolitan)\b/i, priority: 15 },
      { id: 'building', label: 'Building / façade', pattern: /\b(building exterior|building facade|building façade|facades?|façades?)\b/i, priority: 15 },
      { id: 'indoor', label: 'Indoor / room', pattern: /\b(indoor|interior|classroom|office environment|room environment)\b/i, priority: 15 },
      { id: 'campus', label: 'Campus', pattern: /\bcampus\w*\b/i, priority: 15 },
    ],
  },
  response_protocols: {
    id: 'response_protocols',
    label: 'Response protocols',
    field: 'response_protocols',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'rating_scale', label: 'Rating / Likert scale', pattern: /\b(likert|rating scale\w*|5[- ]?point|7[- ]?point|semantic differential|score the images)\b/i, priority: 20 },
      { id: 'pairwise', label: 'Pairwise comparison', pattern: /\b(pairwise|paired comparison\w*|forced[- ]choice)\b/i, priority: 20 },
      { id: 'ranking', label: 'Ranking', pattern: /\b(rank(?:ing|ed| the)|order(?:ed)? preference)\b/i, priority: 15 },
      { id: 'discrete_choice', label: 'Discrete choice', pattern: /\b(choice experiment\w*|discrete choice|stated preference|maxdiff|max[- ]?diff)\b/i, priority: 20 },
      { id: 'categorical_annotation', label: 'Categorical annotation', pattern: /\b(label(?:l)?ed (?:the )?image\w*|image annotation|categorical annotation|tagged (?:the )?scene)\b/i, priority: 10 },
      { id: 'open_ended', label: 'Open-ended response', pattern: /\b(open[- ]ended|free[- ]text|written response)\b/i, priority: 10 },
    ],
  },
  measurement_channels: {
    id: 'measurement_channels',
    label: 'Measurement channels',
    field: 'measurement_channels',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'self_report', label: 'Self-report / questionnaire', pattern: /\b(questionnaire\w*|online survey\w*|self[- ]report|survey respondents?|(?<![-\w])surveys?(?![-\w])|human (?:rating|annotation|labelling|labeling)|respondents?)\b/i, exclude: /\b(cycling survey|traffic survey|noise survey|aerial survey|volunteer (?:cycling|traffic)|field survey)\b/i, priority: 10 },
      { id: 'interview', label: 'Interview / focus group', pattern: /\b(interview\w*|focus group\w*)\b/i, priority: 20 },
      { id: 'eye_tracking', label: 'Eye tracking', pattern: /\b(eye[- ]?track\w*)\b/i, priority: 20 },
      { id: 'physiological', label: 'Physiological / behavioral', pattern: /\b(physiological|skin conductance|heart rate|eeg\b|fmri|behavioral response)\b/i, priority: 15 },
    ],
  },
  recruitment_modes: {
    id: 'recruitment_modes',
    label: 'Recruitment modes',
    field: 'recruitment_modes',
    cardinality: 'multi',
    chart: true,
    terms: [
      {
        id: 'crowdsourced',
        label: 'Crowdsourced / panel',
        pattern: /\b(crowdsourc\w*|crowd-sourc\w*|mturk|prolific|online panel)\b/i,
        require: /\b(participant\w*|respondent\w*|recruited|workers?|annotators?|raters?)\b/i,
        exclude: /\b(crowd[- ]sourced (?:data|labels?|perception (?:data|indicators?)|dataset))\b/i,
        priority: 20,
      },
      {
        id: 'field_intercept',
        label: 'Field / intercept',
        pattern: /\b(in-field|on-site survey\w*|intercept survey\w*|field questionnaire\w*|intercept interview\w*)\b/i,
        exclude: /\b(field survey(?:s)? (?:of|using|with) (?:lidar|laser|drone|sensor|measurement))\b/i,
        priority: 20,
      },
      {
        id: 'lab_convenience',
        label: 'Lab / convenience sample',
        pattern: /\b(laboratory experiment|lab study|convenience sample|student volunteers?|university students?)\b/i,
        priority: 10,
      },
    ],
  },
  research_methods: {
    id: 'research_methods',
    label: 'Analysis methods',
    field: 'research_methods',
    cardinality: 'multi',
    chart: true,
    terms: [
      { id: 'machine_learning', label: 'Machine learning / AI', pattern: /\b(machine learning|\bml\b|deep learning|neural network\w*|geoai|computer vision|semantic segmentation)\b/i, priority: 10 },
      { id: 'regression', label: 'Regression / statistical model', pattern: /\b(regression|mixed[- ]effects?|anova|structural equation modeling|structural equation model)\b/i, priority: 10 },
      { id: 'gis', label: 'GIS / spatial analysis', pattern: /\b(\bgis\b|spatial analysis|geospatial)\b/i, require: /\b(spatial|geospatial|mapping|gis)\b/i, priority: 10 },
    ],
  },
  study_countries: {
    id: 'study_countries',
    label: 'Study countries',
    field: 'study_countries',
    cardinality: 'multi',
    chart: true,
    terms: LOCATION_PHRASES.map((t) => ({ ...t, chart: true, priority: 10 })),
  },
  study_regions: {
    id: 'study_regions',
    label: 'Study regions',
    field: 'study_regions',
    cardinality: 'multi',
    chart: true,
    terms: REGION_TERMS.map((t) => ({ ...t, chart: true, priority: 10 })),
  },
};

/** Flat TAXONOMY map for analytics (field → terms). */
export const TAXONOMY = Object.fromEntries(
  Object.values(TAXONOMY_REGISTRY).map((dim) => [dim.field, dim.terms]),
);

/**
 * Reporting signals (abstract coverage, not method taxonomy).
 * @type {{ id: string, label: string, pattern: RegExp, exclude?: RegExp }[]}
 */
export const REPORTING_SIGNALS = [
  {
    id: 'participant_sample',
    label: 'Participant sample size',
    pattern: /\b(?:n|sample(?:\s+size)?)\s*[=:]\s*\d{2,6}\b|\b\d{2,6}\s+(?:participants?|respondents?|subjects?|volunteers?)\b/i,
    exclude: /\b\d{2,6}\s+(?:images?|photos?|scenes?|streetscapes?|views?)\b/i,
  },
  {
    id: 'demographics',
    label: 'Demographics reported',
    pattern: /\b(demograph\w*|age group|gender composition|balanced (?:by )?gender|socioeconomic)\b/i,
  },
  {
    id: 'recruitment_detail',
    label: 'Recruitment detail',
    pattern: /\b(recruited|recruitment|sampling (?:frame|strategy)|convenience sample)\b/i,
  },
  {
    id: 'protocol_detail',
    label: 'Protocol / scale detail',
    pattern: /\b(likert|rating scale\w*|5[- ]?point|7[- ]?point|pairwise|paired comparison\w*|forced[- ]choice|maxdiff|discrete choice|stated preference|semantic differential)\b/i,
  },
  {
    id: 'reliability',
    label: 'Reliability / agreement',
    pattern: /\b(inter[- ]?rater|intra[- ]?rater|cohen'?s?\s*kappa|fleiss|cronbach|reliability|icc\b|krippendorff)\b/i,
  },
  {
    id: 'open_materials',
    label: 'Open data / materials',
    pattern: /\b(open data|publicly available|supplementary|questionnaire (?:is |was )?(?:available|provided)|survey instrument|github\.com|osf\.io|zenodo|figshare|data availability)\b/i,
  },
];

const SAMPLE_PATTERNS = [
  {
    pattern: /\b(?:n|sample(?:\s+size)?)\s*[=:]\s*(\d{2,6})\b/gi,
    unitHint: null,
  },
  {
    pattern: /\b(\d{2,6})\s+(participants?|respondents?|subjects?|volunteers?|residents?|citizens?|students?)\b/gi,
    unitHint: 'people',
  },
];

const IMAGE_UNIT = /\b(images?|photos?|photographs?|scenes?|streetscapes?|views?|panoramas?)\b/i;

const SAMPLE_BINS = [
  { id: '10-49', label: '10–49', min: 10, max: 49 },
  { id: '50-99', label: '50–99', min: 50, max: 99 },
  { id: '100-499', label: '100–499', min: 100, max: 499 },
  { id: '500-999', label: '500–999', min: 500, max: 999 },
  { id: '1000+', label: '1,000+', min: 1000, max: Infinity },
];

const HUMAN_EVAL_SIGNAL = /\b(online questionnaire\w*|questionnaire survey\w*|questionnaire\w*|online survey\w*|(?<![-\w])surveys?(?![-\w])|survey respondents?|respondents?|human (?:rating|annotation|labelling|labeling)|likert|pairwise|forced[- ]choice|interview\w*|focus group\w*|eye[- ]?track\w*|self[- ]report|rated (?:the )?(?:image|scene|streetscape)|participants? (?:rated|evaluated|completed|were recruited))\b/i;
const COMPUTATIONAL_SIGNAL = /\b(machine learning|\bml\b|deep learning|neural network\w*|computer vision|semantic segmentation|predict(?:ion|ing)|model(?:s|ling|ing)?|trained (?:a |the )?model)\b/i;
const REVIEW_SIGNAL = /\b(systematic review|literature review|scoping review|meta[- ]analysis|conceptual framework)\b/i;
const NON_HUMAN_SURVEY = /\b(cycling survey|traffic survey|noise survey|aerial survey|volunteer (?:cycling|traffic)|field survey)\b/i;

/** Reject regex hits that are clearly negated in a short window. */
function positiveHits(pattern, text) {
  if (!pattern) return false;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 28), m.index);
    if (/\b(no|not|without|never)\b[\w\s-]*$/i.test(before)) continue;
    return true;
  }
  return false;
}

function paperText(paper, { includeKeywords = true } = {}) {
  const keywords = includeKeywords && Array.isArray(paper?.keywords)
    ? paper.keywords.join(' ')
    : '';
  return [paper?.title || '', paper?.abstract || '', keywords].join('\n');
}

function paperBody(paper) {
  return paperText(paper, { includeKeywords: false });
}

function patternHits(pattern, text) {
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function findEvidence(pattern, text) {
  if (!pattern) return null;
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 24);
  const end = Math.min(text.length, m.index + m[0].length + 24);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Ordered multi-label match with exclude/require and priority sort.
 * @returns {{ ids: string[], evidence: Record<string, string> }}
 */
export function matchTermsOrdered(text, terms, { exclusive = false } = {}) {
  const hits = [];
  for (const term of terms) {
    if (!positiveHits(term.pattern, text)) continue;
    if (term.exclude && patternHits(term.exclude, text)) continue;
    if (term.require && !positiveHits(term.require, text)) continue;
    hits.push({
      id: term.id,
      priority: term.priority || 0,
      evidence: findEvidence(term.pattern, text) || term.id,
    });
  }
  hits.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (exclusive && hits.length) {
    return { ids: [hits[0].id], evidence: { [hits[0].id]: hits[0].evidence } };
  }
  const ids = [];
  const evidence = {};
  for (const h of hits) {
    if (ids.includes(h.id)) continue;
    ids.push(h.id);
    evidence[h.id] = h.evidence;
  }
  return { ids, evidence };
}

function extractPerception(text) {
  const { ids, evidence } = matchTermsOrdered(text, TAXONOMY.perception_constructs);
  // Phrase-level: if thermal comfort matched, drop bare comfort when evidence overlaps thermal phrase
  if (ids.includes('thermal') && ids.includes('comfort')) {
    const comfortEv = evidence.comfort || '';
    if (/thermal/i.test(comfortEv) || !comfortEv) {
      return { ids: ids.filter((id) => id !== 'comfort'), evidence };
    }
  }
  return { ids, evidence };
}

function extractVisualSources(text) {
  const { ids, evidence } = matchTermsOrdered(text, TAXONOMY.visual_data_sources);
  const hasPlatform = ids.includes('google_street_view') || ids.includes('other_street_view');
  if (hasPlatform) {
    return {
      ids: ids.filter((id) => id !== 'unspecified_street_view'),
      evidence,
    };
  }
  return { ids, evidence };
}

function extractLocations(bodyText) {
  // Countries from title+abstract only (avoid keyword geography indexes)
  const countryHit = matchTermsOrdered(bodyText, TAXONOMY.study_countries);
  const regionHit = matchTermsOrdered(bodyText, TAXONOMY.study_regions);
  const countries = countryHit.ids;
  const regions = new Set(regionHit.ids);
  for (const c of countries) {
    const r = COUNTRY_TO_REGION[c];
    if (r) regions.add(r);
  }
  // Generic Europe without UK/EU country still allowed as region-only
  return {
    countries,
    regions: [...regions],
    evidence: { ...countryHit.evidence, ...regionHit.evidence },
  };
}

function sampleBinId(n) {
  const bin = SAMPLE_BINS.find((b) => n >= b.min && n <= b.max);
  return bin ? bin.id : null;
}

/**
 * Conservatively extract participant sample size (not image counts).
 */
export function extractSampleSize(abstract = '') {
  const text = String(abstract || '');
  const values = [];
  for (const { pattern, unitHint } of SAMPLE_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 10 || n > 100000) continue;
      const window = text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + m[0].length + 40));
      if (IMAGE_UNIT.test(window) && unitHint !== 'people') continue;
      if (unitHint === 'people' || /\b(participants?|respondents?|subjects?|volunteers?|students?)\b/i.test(window)) {
        values.push(n);
      } else if (/\bn\s*[=:]/i.test(m[0]) && /\b(participant|respondent|subject|volunteer|student|people)\b/i.test(window)) {
        values.push(n);
      }
    }
  }
  // Also accept explicit n= near participant language earlier in abstract
  if (!values.length) {
    const loose = /\b(?:n|sample(?:\s+size)?)\s*[=:]\s*(\d{2,6})\b/gi;
    let m;
    while ((m = loose.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 10 || n > 100000) continue;
      const window = text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + 80));
      if (IMAGE_UNIT.test(window)) continue;
      if (/\b(participant|respondent|subject|volunteer|student|people|survey)\b/i.test(window)) {
        values.push(n);
      }
    }
  }
  if (!values.length) return null;
  const value = Math.max(...values);
  return {
    value,
    bin: sampleBinId(value),
    unit: 'participants',
    confidence: values.length === 1 ? 'medium' : 'low',
    evidence: `matched ${values.length} candidate size(s); using max=${value}`,
  };
}

function inferAnalysisScope({
  text,
  response_protocols,
  measurement_channels,
  recruitment_modes,
}) {
  const hasHumanMethod = response_protocols.length > 0
    || measurement_channels.length > 0
    || recruitment_modes.length > 0
    || (positiveHits(HUMAN_EVAL_SIGNAL, text) && !NON_HUMAN_SURVEY.test(text));
  if (REVIEW_SIGNAL.test(text) && !hasHumanMethod) return 'review_conceptual';
  if (hasHumanMethod) return 'human_evaluation';
  if (COMPUTATIONAL_SIGNAL.test(text)) return 'computational_only';
  return 'uncertain';
}

/**
 * Build analysis_meta for one paper (v4).
 * @param {object} paper
 * @param {{ extractedAt?: string }} [opts]
 */
export function extractAnalysisMeta(paper, opts = {}) {
  const text = paperText(paper);
  const body = paperBody(paper);

  const perception = extractPerception(text);
  const sources = extractVisualSources(text);
  const presentation = matchTermsOrdered(text, TAXONOMY.presentation_modes);
  const views = matchTermsOrdered(text, TAXONOMY.view_contexts);
  const scales = matchTermsOrdered(text, TAXONOMY.spatial_scales);
  const protocols = matchTermsOrdered(text, TAXONOMY.response_protocols);
  const channels = matchTermsOrdered(text, TAXONOMY.measurement_channels);
  const recruitment = matchTermsOrdered(text, TAXONOMY.recruitment_modes);
  const methods = matchTermsOrdered(text, TAXONOMY.research_methods);
  const locations = extractLocations(body);
  const sample_size = extractSampleSize(paper?.abstract || '');
  const reporting = matchTermsOrdered(text, REPORTING_SIGNALS);

  const analysis_scope = inferAnalysisScope({
    text,
    response_protocols: protocols.ids,
    measurement_channels: channels.ids,
    recruitment_modes: recruitment.ids,
  });

  const evidence = {
    ...perception.evidence,
    ...sources.evidence,
    ...presentation.evidence,
    ...views.evidence,
    ...scales.evidence,
    ...protocols.evidence,
    ...channels.evidence,
    ...recruitment.evidence,
    ...methods.evidence,
    ...locations.evidence,
    ...reporting.evidence,
  };

  return {
    extraction_version: EXTRACTION_VERSION,
    extracted_at: opts.extractedAt || new Date().toISOString(),
    analysis_scope,
    perception_constructs: perception.ids,
    visual_data_sources: sources.ids,
    presentation_modes: presentation.ids,
    view_contexts: views.ids,
    spatial_scales: scales.ids,
    response_protocols: protocols.ids,
    measurement_channels: channels.ids,
    recruitment_modes: recruitment.ids,
    research_methods: methods.ids,
    study_countries: locations.countries,
    study_regions: locations.regions,
    sample_size,
    reporting_signals: reporting.ids,
    evidence,
    coverage_flags: {
      human_evaluation: analysis_scope === 'human_evaluation',
      perception: perception.ids.length > 0,
      visual_source: sources.ids.length > 0,
      presentation: presentation.ids.length > 0,
      view_context: views.ids.length > 0,
      scale: scales.ids.length > 0,
      response_protocol: protocols.ids.length > 0,
      measurement_channel: channels.ids.length > 0,
      recruitment: recruitment.ids.length > 0,
      sample_size: !!sample_size,
      country: locations.countries.length > 0,
      region: locations.regions.length > 0,
      methods: methods.ids.length > 0,
      reporting: reporting.ids.length > 0,
    },
  };
}

export function taxonomyLabel(dimension, id) {
  const terms = TAXONOMY[dimension] || [];
  const hit = terms.find((t) => t.id === id);
  if (hit) return hit.label;
  for (const list of Object.values(TAXONOMY)) {
    const t = list.find((x) => x.id === id);
    if (t) return t.label;
  }
  const signal = REPORTING_SIGNALS.find((s) => s.id === id);
  if (signal) return signal.label;
  const bin = SAMPLE_BINS.find((b) => b.id === id);
  if (bin) return bin.label;
  if (id === 'human_evaluation') return 'Human evaluation';
  if (id === 'computational_only') return 'Computational only';
  if (id === 'review_conceptual') return 'Review / conceptual';
  if (id === 'uncertain') return 'Uncertain scope';
  return id;
}

export function sampleSizeBins() {
  return SAMPLE_BINS.map((b) => ({ id: b.id, label: b.label }));
}

export function isHumanEvaluationMeta(meta) {
  return meta?.analysis_scope === 'human_evaluation'
    || meta?.coverage_flags?.human_evaluation === true;
}

/**
 * Schema invariants for one meta object (used by audit + tests).
 * @returns {string[]}
 */
export function validateMetaInvariants(meta, paper = null) {
  const violations = [];
  if (!meta || meta.extraction_version !== EXTRACTION_VERSION) {
    violations.push('wrong_or_missing_version');
    return violations;
  }
  if ('survey_methods' in meta) violations.push('legacy_survey_methods_present');
  if ('elicitation_methods' in meta) violations.push('legacy_elicitation_methods_present');
  if ('imagery_sources' in meta) violations.push('legacy_imagery_sources_present');
  if ('perception_dimensions' in meta) violations.push('legacy_perception_dimensions_present');
  if ('study_locations' in meta) violations.push('legacy_study_locations_present');

  const text = paper ? paperText(paper) : '';
  const scales = meta.spatial_scales || [];
  if (paper && scales.includes('street')) {
    const hasScalePhrase = /\b(streetscape\w*|street-level|street level|street[- ]scale|street unit)\b/i.test(text);
    const onlyStreetView = /\bstreet[- ]view\b/i.test(text) && !hasScalePhrase;
    if (onlyStreetView) violations.push('street_scale_from_street_view_only');
  }

  const countries = meta.study_countries || [];
  const regions = meta.study_regions || [];
  // countries must not appear in regions array
  for (const c of countries) {
    if (regions.includes(c)) violations.push(`country_in_regions:${c}`);
  }

  return violations;
}

/**
 * Ensure paper has v4 analysis_meta (re-extract if missing / wrong version).
 */
export function ensureAnalysisMeta(paper, opts = {}) {
  const existing = paper?.analysis_meta;
  if (
    existing
    && existing.extraction_version === EXTRACTION_VERSION
    && Array.isArray(existing.perception_constructs)
    && Array.isArray(existing.visual_data_sources)
    && Array.isArray(existing.response_protocols)
    && Array.isArray(existing.measurement_channels)
    && Array.isArray(existing.study_countries)
    && Array.isArray(existing.reporting_signals)
    && typeof existing.analysis_scope === 'string'
  ) {
    return existing;
  }
  return extractAnalysisMeta(paper, opts);
}
