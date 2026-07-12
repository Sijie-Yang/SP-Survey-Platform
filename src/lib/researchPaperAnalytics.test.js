/**
 * Tests for rule-based paper analysis metadata + aggregations.
 */

describe('researchPaperMeta + analytics', () => {
  let meta;
  let analytics;

  beforeAll(() => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    meta = require('../lib/researchPaperMeta.mjs');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    analytics = require('../lib/researchPaperAnalytics');
  });

  test('extracts perception, imagery, scale, survey, and sample size', () => {
    const paper = {
      title: 'Perceived safety and greenness from Google Street View',
      abstract:
        'We conducted an online questionnaire where n=240 participants rated streetscape images '
        + 'for walkability and comfort across neighborhoods in Singapore.',
      keywords: ['GSV', 'perception'],
    };
    const out = meta.extractAnalysisMeta(paper, { extractedAt: '2026-07-12T00:00:00Z' });
    expect(out.extraction_version).toBe('v1');
    expect(out.perception_dimensions).toEqual(
      expect.arrayContaining(['safety', 'greenness', 'walkability', 'comfort']),
    );
    expect(out.imagery_sources).toEqual(
      expect.arrayContaining(['google_street_view']),
    );
    expect(out.spatial_scales).toEqual(
      expect.arrayContaining(['street', 'neighborhood']),
    );
    expect(out.survey_methods).toEqual(
      expect.arrayContaining(['questionnaire', 'rating_likert']),
    );
    expect(out.study_locations).toContain('singapore');
    expect(out.sample_size).toMatchObject({ value: 240, bin: '100-499' });
    expect(out.coverage_flags.sample_size).toBe(true);
  });

  test('extractSampleSize prefers explicit n= and ignores tiny numbers', () => {
    expect(meta.extractSampleSize('A survey with n=8 students')).toBeNull();
    expect(meta.extractSampleSize('We recruited 125 respondents in the field')).toMatchObject({
      value: 125,
      bin: '100-499',
    });
    expect(meta.extractSampleSize('sample size = 1500 volunteers')).toMatchObject({
      value: 1500,
      bin: '1000+',
    });
  });

  test('ensureAnalysisMeta reuses same extraction version', () => {
    const paper = {
      title: 'Window view preference study',
      abstract: 'Participants completed a Likert questionnaire about window views.',
      analysis_meta: {
        extraction_version: 'v1',
        perception_dimensions: ['preference'],
        imagery_sources: [],
        spatial_scales: [],
        survey_methods: [],
        research_methods: [],
        study_locations: [],
        sample_size: null,
        coverage_flags: { perception: true },
      },
    };
    expect(meta.ensureAnalysisMeta(paper)).toBe(paper.analysis_meta);
  });

  test('buildPaperLibraryAnalytics aggregates coverage and supports filters', () => {
    const papers = [
      {
        title: 'A',
        year: 2024,
        venue: 'Landscape and Urban Planning',
        abstract: 'Google Street View safety questionnaire with 80 participants.',
        keywords: [],
      },
      {
        title: 'B',
        year: 2025,
        venue: 'Cities',
        abstract: 'Window view thermal comfort survey n=400 respondents.',
        keywords: ['thermal'],
      },
      {
        title: 'C',
        year: 2025,
        venue: 'Cities',
        abstract: 'No clear tags here about driving object detection only.',
        keywords: [],
      },
    ].map((p) => ({ ...p, analysis_meta: meta.extractAnalysisMeta(p) }));

    const snap = analytics.buildPaperLibraryAnalytics(papers);
    expect(snap.total).toBe(3);
    expect(snap.yearMin).toBe(2024);
    expect(snap.yearMax).toBe(2025);
    expect(snap.byYear.find((y) => y.id === '2025')?.count).toBe(2);
    expect(snap.perception.some((r) => r.id === 'safety' && r.count >= 1)).toBe(true);
    expect(snap.imagery.some((r) => r.id === 'google_street_view')).toBe(true);
    expect(snap.sampleSize.tagged).toBeGreaterThanOrEqual(2);

    const safetyOnly = papers.filter((p) => analytics.paperMatchesMetaFilters(p, [
      { dimension: 'perception', id: 'safety' },
    ]));
    expect(safetyOnly).toHaveLength(1);
    expect(safetyOnly[0].title).toBe('A');

    const yearFilter = papers.filter((p) => analytics.paperMatchesMetaFilters(p, [
      { dimension: 'year', id: '2025' },
    ]));
    expect(yearFilter).toHaveLength(2);
  });
});
