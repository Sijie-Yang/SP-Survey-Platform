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
    expect(out.extraction_version).toBe('v4');
    expect(out.response_protocols).toEqual(expect.arrayContaining(['pairwise']));
    expect(out.analysis_scope).toBe('human_evaluation');
  });

  test('ensureAnalysisMeta reuses valid v4 meta', () => {
    const paper = {
      title: 'x',
      abstract: 'y',
      analysis_meta: {
        extraction_version: 'v4',
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

    const compared = analytics.compareSeriesToBaseline(
      snap.perception,
      snap.perception,
    );
    expect(compared[0]).toHaveProperty('share');
    expect(compared[0]).toHaveProperty('baselineShare');

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

  test('human-only heatmap excludes computational papers', () => {
    const papers = [
      {
        title: 'Pair safety',
        year: 2023,
        abstract: 'Pairwise comparison of streetscape perceived safety using Google Street View.',
      },
      {
        title: 'ML only',
        year: 2024,
        abstract: 'Deep learning predicts safety from street view imagery with no participants.',
      },
      {
        title: 'Pair green',
        year: 2025,
        abstract: 'Pairwise comparison of greenness using Google Street View with respondents.',
      },
    ].map((p) => ({ ...p, analysis_meta: meta.extractAnalysisMeta(p) }));

    const matrix = analytics.buildCoOccurrenceMatrix(
      papers,
      'perception_constructs',
      'response_protocols',
      { rowDimension: 'perception', colDimension: 'responseProtocol', humanOnly: true },
    );
    expect(matrix.humanOnly).toBe(true);
    expect(matrix.cohortSize).toBeLessThan(papers.length);
    expect(matrix.cols.every((c) => c.id !== 'questionnaire')).toBe(true);

    const dash = analytics.buildLibraryDashboard(papers, papers);
    expect(dash.matrices.perceptionByProtocol.humanOnly).toBe(true);
    expect(dash.trends.focused).toBeTruthy();
    expect(dash.trends.baseline).toBeTruthy();
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

  test('street view alone does not create street scale tag', () => {
    const out = meta.extractAnalysisMeta({
      title: 'SVI ML',
      abstract: 'Street view imagery supports machine learning prediction of urban form.',
    });
    expect(out.visual_data_sources).toContain('unspecified_street_view');
    expect(out.spatial_scales).not.toContain('street');
  });
});
