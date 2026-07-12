/**
 * Unit tests for researchProviders (loaded via Node require through babel-jest path).
 * CRA Jest transforms this file; we re-require the CommonJS module from repo root.
 */

describe('researchProviders', () => {
  let providers;

  beforeAll(() => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    providers = require('../../researchProviders');
  });

  test('normalizeDoi strips URL prefixes', () => {
    expect(providers.normalizeDoi('https://doi.org/10.1000/XYZ')).toBe('10.1000/xyz');
    expect(providers.normalizeDoi('DOI:10.1000/ABC')).toBe('10.1000/abc');
  });

  test('mergeCandidates dedupes by DOI and merges sources', () => {
    const merged = providers.mergeCandidates([
      [{
        doi: '10.1/a',
        title: 'Streetscape Perception Study',
        abstract: 'survey rating street view images',
        sources: ['semantic_scholar'],
        relevance_score: 2,
        authors: ['A'],
      }],
      [{
        doi: 'https://doi.org/10.1/A',
        title: 'Streetscape Perception Study',
        abstract: '',
        venue: 'Cities',
        sources: ['crossref'],
        relevance_score: 3,
        authors: [],
      }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.sort()).toEqual(['crossref', 'semantic_scholar']);
    expect(merged[0].venue).toBe('Cities');
    expect(merged[0].relevance_score).toBe(3);
  });

  test('scoreRelevance boosts urban perception + survey methods', () => {
    const low = providers.scoreRelevance({ title: 'Unrelated chemistry', abstract: '' });
    const high = providers.scoreRelevance({
      title: 'Streetscape perceived safety',
      abstract: 'Participants completed a questionnaire with image rating of street view scenes',
    });
    expect(high).toBeGreaterThan(low);
  });

  test('inferTemplateFit', () => {
    expect(providers.inferTemplateFit({ title: 'x', abstract: '', relevance_score: 5 })).toBe('unknown');
    expect(providers.inferTemplateFit({
      title: 'Streetscape survey',
      abstract: 'We ran a questionnaire with street view image ratings',
      relevance_score: 4,
    })).toBe('likely');
  });
});
