/**
 * Tests for taxonomy v4 extraction + analytics contracts.
 */

describe('researchPaperMeta + analytics v4', () => {
  let meta;
  let analytics;
  let golden;

  beforeAll(() => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    meta = require('../lib/researchPaperMeta.mjs');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    analytics = require('../lib/researchPaperAnalytics');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    golden = require('../lib/researchTaxonomyGolden.mjs');
  });

  test('golden fixtures meet precision expectations', () => {
    for (const fixture of golden.GOLDEN_PAPERS) {
      const out = meta.extractAnalysisMeta(fixture);
      const exp = fixture.expect || {};
      if (exp.analysis_scope) {
        expect(out.analysis_scope).toBe(exp.analysis_scope);
      }
      const checkInclude = (field, ids) => {
        if (!ids) return;
        expect(out[field]).toEqual(expect.arrayContaining(ids));
      };
      const checkExclude = (field, ids) => {
        if (!ids) return;
        for (const id of ids) expect(out[field] || []).not.toContain(id);
      };
      checkInclude('perception_constructs', exp.perception_constructs);
      checkExclude('perception_constructs', exp.not_perception_constructs);
      checkInclude('visual_data_sources', exp.visual_data_sources);
      checkExclude('visual_data_sources', exp.not_visual_data_sources);
      checkInclude('spatial_scales', exp.spatial_scales);
      checkExclude('spatial_scales', exp.not_spatial_scales);
      checkInclude('view_contexts', exp.view_contexts);
      checkInclude('response_protocols', exp.response_protocols);
      if (Array.isArray(exp.response_protocols) && exp.response_protocols.length === 0) {
        expect(out.response_protocols).toEqual([]);
      }
      checkInclude('measurement_channels', exp.measurement_channels);
      checkExclude('measurement_channels', exp.not_measurement_channels);
      checkInclude('recruitment_modes', exp.recruitment_modes);
      if (Array.isArray(exp.recruitment_modes) && exp.recruitment_modes.length === 0) {
        expect(out.recruitment_modes).toEqual([]);
      }
      checkInclude('research_methods', exp.research_methods);
      checkInclude('study_countries', exp.study_countries);
      checkExclude('study_countries', exp.not_study_countries);
      checkInclude('study_regions', exp.study_regions);
      if (Object.prototype.hasOwnProperty.call(exp, 'sample_size')) {
        expect(out.sample_size).toBeNull();
      }
      expect(meta.validateMetaInvariants(out, fixture)).toEqual([]);
      expect(out).not.toHaveProperty('survey_methods');
      expect(out).not.toHaveProperty('elicitation_methods');
    }
  });

  test('extractSampleSize ignores image counts and keeps participant n', () => {
    expect(meta.extractSampleSize('A survey with n=8 students')).toBeNull();
    expect(meta.extractSampleSize('We trained on n=5000 streetscape images')).toBeNull();
    expect(meta.extractSampleSize('We recruited 125 respondents in the field')).toMatchObject({
      value: 125,
      bin: '100-499',
      unit: 'participants',
    });
  });

  test('ensureAnalysisMeta re-extracts outdated versions', () => {
    const paper = {
      title: 'Safety pairwise comparison study',
      abstract: 'Participants used pairwise forced-choice ratings of streetscapes (n=120).',
      analysis_meta: {
        extraction_version: 'v3',
        perception_dimensions: ['safety'],
        elicitation_methods: ['pairwise'],
        recruitment_modes: [],
        reporting_signals: [],
      },
    };
    const out = meta.ensureAnalysisMeta(paper);
    expect(out.extraction_version).toBe(meta.EXTRACTION_VERSION);
    expect(out.response_protocols).toEqual(expect.arrayContaining(['pairwise']));
    expect(out.analysis_scope).toBe('human_evaluation');
  });

  test('ensureAnalysisMeta reuses meta of the current version', () => {
    const paper = {
      title: 'x',
      abstract: 'y',
      analysis_meta: {
        extraction_version: meta.EXTRACTION_VERSION,
        analysis_scope: 'human_evaluation',
        perception_constructs: ['safety'],
        visual_data_sources: [],
        presentation_modes: [],
        view_contexts: [],
        spatial_scales: [],
        response_protocols: ['pairwise'],
        measurement_channels: [],
        recruitment_modes: [],
        research_methods: [],
        study_countries: [],
        study_regions: [],
        sample_size: null,
        reporting_signals: ['protocol_detail'],
        coverage_flags: { human_evaluation: true },
      },
    };
    expect(meta.ensureAnalysisMeta(paper)).toBe(paper.analysis_meta);
  });

  test('analytics uses canonical dimensions and share-based comparison', () => {
    const papers = [
      {
        title: 'A',
        year: 2024,
        abstract: 'Google Street View perceived safety questionnaire with 80 participants using a Likert scale.',
      },
      {
        title: 'B',
        year: 2025,
        abstract: 'Window view thermal comfort survey n=400 respondents.',
      },
      {
        title: 'C',
        year: 2025,
        abstract: 'Deep learning on street view imagery without human ratings.',
      },
    ].map((p) => ({ ...p, analysis_meta: meta.extractAnalysisMeta(p) }));

    const snap = analytics.buildPaperLibraryAnalytics(papers);
    expect(snap.total).toBe(3);
    expect(snap.scopes.human_evaluation).toBeGreaterThanOrEqual(2);
    expect(snap.perception.some((r) => r.id === 'safety')).toBe(true);
    expect(snap.visualSource.some((r) => r.id === 'google_street_view')).toBe(true);
    expect(snap.responseProtocol.some((r) => r.id === 'rating_scale')).toBe(true);
    expect(snap).not.toHaveProperty('survey');
    expect(snap).not.toHaveProperty('elicitation');

    const safetyOnly = papers.filter((p) => analytics.paperMatchesMetaFilters(p, [
      { dimension: 'perception', id: 'safety' },
    ]));
    expect(safetyOnly).toHaveLength(1);
  });

  test('normalizeMetaFilters collapses dual identities for same field', () => {
    const cleaned = analytics.normalizeMetaFilters([
      { dimension: 'responseProtocol', id: 'pairwise' },
      { dimension: 'response_protocols', id: 'rating_scale' },
      { dimension: 'year', id: '2024' },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned.find((f) => f.dimension === 'responseProtocol').id).toBe('pairwise');
    expect(cleaned.find((f) => f.dimension === 'year').id).toBe('2024');
  });

  test('simple library view: one card per category on one paper set', () => {
    const papers = [
      { title: 'A', year: 2025, abstract: 'Google Street View perceived safety, pairwise comparison with 200 respondents in Singapore.' },
      { title: 'B', year: 2024, abstract: 'Baidu street view greenery rating with a Likert scale in Beijing, China.' },
      { title: 'C', year: 2020, abstract: 'Immersive virtual reality restorative indoor office environment questionnaire.' },
      { title: 'D', year: 1999, abstract: 'Street view imagery of streetscape aesthetics.' },
      { title: 'E', year: 2031, abstract: 'Future paper on greenery.' },
    ].map((p) => ({ ...p, analysis_meta: meta.extractAnalysisMeta(p) }));

    const view = analytics.buildSimpleLibraryView(papers, { maxYear: 2026 });
    expect(view.total).toBe(5);
    expect(view.dated).toBe(4);
    expect(view.reviewed).toBe(0);
    expect(view.yearMax).toBe(2025);
    expect(view.years[0]).toMatchObject({ earlier: true, count: 1 });
    expect(view.years[view.years.length - 1].label).toBe('2026');
    expect(view.cards.map((c) => c.dimension)).toEqual([
      'concept', 'scene', 'modality', 'task', 'setting', 'participants', 'sample', 'country', 'city', 'team_org', 'team_country',
    ]);
    const modality = view.cards.find((c) => c.dimension === 'modality');
    // three street-view source tags merge into one bar
    expect(modality.rows.find((r) => r.id === 'street_view').count).toBe(3);
    // VR is how people take part (setting), indoor is the kind of place (scene): not stimulus material
    expect(modality.rows.some((r) => r.id === 'vr')).toBe(false);
    expect(view.cards.find((c) => c.dimension === 'setting').rows.some((r) => r.id === 'vr')).toBe(true);
    expect(view.cards.find((c) => c.dimension === 'scene').rows.some((r) => r.id === 'indoor')).toBe(true);
    const concept = view.cards.find((c) => c.dimension === 'concept');
    expect(concept.rows.some((r) => r.id === 'greenery')).toBe(true);
    // Perception is laid out by group, each tag in exactly one group
    expect(concept.groups.find((g) => g.id === 'environment').rows.map((r) => r.id)).toContain('greenery');
    expect(concept.groups.find((g) => g.id === 'emotion').rows.map((r) => r.id)).toContain('safety');
    expect(concept.groups.flatMap((g) => g.rows)).toHaveLength(concept.rows.length);
    expect(view.cards.find((c) => c.dimension === 'country').rows.map((r) => r.id)).toEqual(
      expect.arrayContaining(['China', 'Singapore']),
    );

    const streetOnly = papers.filter((p) => analytics.paperMatchesMetaFilters(p, [
      { dimension: 'modality', id: 'street_view' },
    ]));
    expect(streetOnly.map((p) => p.title)).toEqual(['A', 'B', 'D']);
    expect(analytics.normalizeMetaFilters([
      { dimension: 'modality', id: 'video' },
      { dimension: 'modality', id: 'scene_photo' },
    ])).toHaveLength(1);
  });

  test('reviewed facets win over rule tags and survive re-extraction', () => {
    // eslint-disable-next-line global-require
    const facets = require('./paperFacets');
    const cleaned = facets.cleanPaperFacets({
      survey: 'yes', task: ['multi_rating', 'nonsense'], sample: ['lt100', 'gt1000'], country: ['United Kingdom'],
    });
    expect(cleaned.problems).toHaveLength(1);
    expect(cleaned.facets.sample).toEqual(['lt100']);
    expect(facets.cleanPaperFacets({ colour: ['x'] }).problems[0]).toMatch(/unknown facet/);

    const paper = {
      title: 'X', year: 2024, abstract: 'Pairwise comparison of Google Street View safety with 300 respondents.',
      analysis_meta: { extraction_version: 'v1', facets: { ...cleaned.facets, reviewed_at: '2026-11-26T00:00:00Z' } },
    };
    const metaOut = meta.ensureAnalysisMeta(paper);
    expect(metaOut.extraction_version).toBe(meta.EXTRACTION_VERSION);
    // an id of the earlier vocabulary is saved as today's id
    expect(metaOut.facets.task).toEqual(['rating']);
    const shown = facets.paperFacets({ ...paper, analysis_meta: metaOut });
    expect(shown.reviewed).toBe(true);
    expect(shown.task).toEqual(['rating']);
    expect(shown.modality).toEqual([]); // reviewed and not stated: no rule guess
    expect(shown.country).toEqual(['UK']);
    expect(analytics.paperMatchesMetaFilters({ ...paper, analysis_meta: metaOut }, [
      { dimension: 'task', id: 'pairwise' },
    ])).toBe(false);
  });

  test('vocabulary of 2026-11-28: old ids are read as new ones, sample size follows the head count', () => {
    // eslint-disable-next-line global-require
    const facets = require('./paperFacets');
    // eslint-disable-next-line global-require
    const vocab = require('./templateFacets');

    // every old tag maps to tags that exist today
    for (const [old, now] of Object.entries(vocab.LEGACY_TAGS)) {
      for (const tag of now) {
        const [key, id] = tag.split(':');
        const dim = vocab.FACET_DIMENSIONS.find((d) => d.key === key);
        expect([old, dim.values.some((v) => v.id === id)]).toEqual([old, true]);
      }
    }
    // no id appears twice inside a dimension, and every concept sits in one of the six groups
    for (const dim of vocab.FACET_DIMENSIONS) {
      const ids = dim.values.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const groups = vocab.CONCEPT_GROUPS.map((g) => g.id);
    expect(groups).toHaveLength(6);
    expect(vocab.FACET_DIMENSIONS.find((d) => d.key === 'concept').values.every((v) => groups.includes(v.group))).toBe(true);
    expect(vocab.conceptGroup('thermal_affordance')).toBe('microclimate');

    // buckets do not overlap
    expect([1, 99, 100, 299, 300, 499, 500, 1000, 1001].map(vocab.sampleBucket)).toEqual(
      ['lt100', 'lt100', '100to300', '100to300', '300to500', '300to500', '500to1000', '500to1000', 'gt1000'],
    );
    expect(vocab.sampleBucket(0)).toBe(null);

    const cleaned = facets.cleanPaperFacets({
      survey: 'yes',
      concept: ['aesthetics', 'beauty', 'soundscape', 'building_facade', 'thermal_affordance'],
      modality: ['street_view', 'vr', 'indoor'],
      task: ['multi_rating', 'questionnaire'],
      participants: ['crowd', 'lab', 'students'],
      sample: ['lt100'],
      sample_n: 412,
      country: ['United States', 'Macao'],
      team_org: ['National University of Singapore'],
      team_country: ['United Kingdom'],
    });
    expect(cleaned.problems).toEqual([]);
    expect(cleaned.facets).toMatchObject({
      concept: ['beauty', 'sound', 'thermal_affordance'],
      scene: ['building', 'indoor'],
      modality: ['street_view'],
      task: ['rating', 'questionnaire'],
      setting: ['vr', 'online', 'lab'],
      participants: ['public', 'students'],
      sample_n: 412,
      sample: ['300to500'], // the number wins over the bucket that was sent
      country: ['USA', 'Macau'],
      team_org: ['National University of Singapore'],
      team_country: ['UK'],
    });
    expect(facets.cleanPaperFacets({ sample_n: 0 }).problems[0]).toMatch(/sample_n/);
    expect(facets.cleanPaperFacets({ setting: ['at home'] }).problems[0]).toMatch(/setting/);

    // facets stored before the change are shown in today's vocabulary
    const stored = {
      title: 'Old', year: 2020,
      analysis_meta: { facets: {
        survey: 'yes', concept: ['aesthetics', 'night'], modality: ['in_situ', 'scene_photo'], task: ['custom_page'],
        participants: ['residents'], sample: ['100to1000'], country: ['China'], reviewed_at: '2026-11-27T00:00:00Z',
      } },
    };
    const shown = facets.paperFacets(stored);
    expect(shown).toMatchObject({
      concept: ['beauty'], modality: ['scene_photo'], setting: ['in_situ'], task: [], participants: ['locals'], sample: [], country: ['China'],
    });
  });

  test('trends follow provided paper set and ignore future years', () => {
    const papers = [];
    for (let y = 2020; y <= 2026; y += 1) {
      papers.push({
        title: `Q ${y}`,
        year: y,
        abstract: 'Likert rating scale survey of streetscape aesthetics with participants.',
      });
      if (y >= 2024) {
        papers.push({
          title: `P ${y}`,
          year: y,
          abstract: 'Pairwise comparison of streetscape aesthetics with respondents.',
        });
      }
    }
    papers.push({
      title: 'Future pairwise',
      year: 2028,
      abstract: 'Pairwise comparison of streetscape aesthetics with respondents.',
    });
    const enriched = papers.map((p) => ({ ...p, analysis_meta: meta.extractAnalysisMeta(p) }));
    const trend = analytics.buildYearShareTrends(enriched, 'response_protocols', {
      dimension: 'responseProtocol',
      maxYear: 2026,
      windowYears: 7,
      topN: 4,
    });
    expect(trend.years.includes(2028)).toBe(false);
    expect(trend.years[trend.years.length - 1]).toBe(2026);
    const pairwise = trend.series.find((s) => s.id === 'pairwise');
    expect(pairwise).toBeTruthy();
    expect(pairwise.slope).toBeGreaterThan(0);
  });

  test('v5 tags: emotion, soundscape, place identity, video, on-site, conjoint', () => {
    const a = meta.extractAnalysisMeta({
      title: 'Audio-visual walk',
      abstract: 'An in situ walking interview and video clips measured soundscape and emotional responses.',
    });
    expect(a.perception_constructs).toEqual(expect.arrayContaining(['emotion', 'soundscape']));
    expect(a.presentation_modes).toEqual(expect.arrayContaining(['video', 'on_site']));
    const b = meta.extractAnalysisMeta({
      title: 'Heat stress streets',
      abstract: 'Heat stress mapping from street view imagery.',
    });
    expect(b.perception_constructs).not.toContain('emotion');
    const c = meta.extractAnalysisMeta({
      title: 'Imageability conjoint',
      abstract: 'A conjoint survey of sense of place where respondents rated each image.',
    });
    expect(c.perception_constructs).toContain('place_identity');
    expect(c.response_protocols).toEqual(expect.arrayContaining(['discrete_choice', 'rating_scale']));
  });

  test('street view alone does not create street scale tag', () => {
    const out = meta.extractAnalysisMeta({
      title: 'SVI ML',
      abstract: 'Street view imagery supports machine learning prediction of urban form.',
    });
    expect(out.visual_data_sources).toContain('unspecified_street_view');
    expect(out.spatial_scales).not.toContain('street');
  });
});
