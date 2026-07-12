import {
  normalizeDoi,
  normalizeTitleKey,
  templateDoi,
  paperDoi,
  matchPapersToTemplates,
  selectedMatchRows,
  suggestTemplatesForPaper,
  filterTemplatesByQuery,
} from './researchTemplateMatch';

describe('researchTemplateMatch', () => {
  test('normalizeDoi extracts from URLs', () => {
    expect(normalizeDoi('https://doi.org/10.1000/XYZ')).toBe('10.1000/xyz');
    expect(normalizeDoi('DOI:10.1000/ABC/')).toBe('10.1000/abc');
    expect(normalizeDoi('https://example.com/doi/10.1016/j.aej.2019.08.010?x=1')).toBe('10.1016/j.aej.2019.08.010');
  });

  test('templateDoi reads website/paper_url', () => {
    expect(templateDoi({ website: 'https://doi.org/10.1/a' })).toBe('10.1/a');
    expect(templateDoi({ paper_url: '10.1/b' })).toBe('10.1/b');
  });

  test('matchPapersToTemplates links by DOI and skips already linked', () => {
    const templates = [
      { id: 't1', name: 'Safety Study', year: 2024, website: 'https://doi.org/10.1/a', is_approved: true },
      { id: 't2', name: 'Greenness paper', year: 2023, website: 'https://doi.org/10.1/b', is_approved: false },
      { id: 't3', name: 'Orphan', year: 2020, website: null, is_approved: true },
    ];
    const papers = [
      { id: 'p1', title: 'Safety Study', year: 2024, doi: '10.1/a' },
      { id: 'p2', title: 'Other', year: 2023, doi: '10.1/b', template_id: 'old' },
      { id: 'p3', title: 'Greenness paper', year: 2023, doi: null },
    ];
    const result = matchPapersToTemplates(papers, templates);
    expect(result.doiMatches).toHaveLength(1);
    expect(result.doiMatches[0]).toMatchObject({
      paperId: 'p1',
      templateId: 't1',
      confidence: 'doi',
      selected: true,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].existingTemplateId).toBe('old');
    // DOI conflict on p2 does not consume template t2 — title+year can still claim it for p3
    expect(result.titleMatches.some((m) => m.paperId === 'p3' && m.templateId === 't2')).toBe(true);
    expect(result.templatesWithDoi).toBe(2);
    expect(selectedMatchRows(result).length).toBeGreaterThanOrEqual(1);
  });

  test('title+year match when no DOI', () => {
    const templates = [
      { id: 't1', name: 'Window View Preference', year: 2022, website: null },
    ];
    const papers = [
      { id: 'p1', title: 'Window View Preference!', year: 2022, doi: null },
    ];
    expect(normalizeTitleKey('Window View Preference!')).toBe(normalizeTitleKey('Window View Preference'));
    const result = matchPapersToTemplates(papers, templates);
    expect(result.titleMatches[0]).toMatchObject({
      paperId: 'p1',
      templateId: 't1',
      confidence: 'title_year',
      selected: true,
    });
    expect(paperDoi(papers[0])).toBeNull();
  });

  test('suggestTemplatesForPaper ranks DOI above title', () => {
    const templates = [
      { id: 't-title', name: 'Safety Study', year: 2024, website: null },
      { id: 't-doi', name: 'Other name', year: 2020, website: 'https://doi.org/10.1/a' },
    ];
    const paper = { id: 'p1', title: 'Safety Study', year: 2024, doi: '10.1/a' };
    const suggestions = suggestTemplatesForPaper(paper, templates);
    expect(suggestions[0].templateId).toBe('t-doi');
    expect(suggestions[0].confidence).toBe('doi');
    expect(suggestions.some((s) => s.templateId === 't-title')).toBe(true);
  });

  test('filterTemplatesByQuery matches id and doi', () => {
    const templates = [
      { id: '2024-liang-building', name: 'Building Exterior', website: 'https://doi.org/10.1/x' },
      { id: 'other', name: 'Nope', website: null },
    ];
    expect(filterTemplatesByQuery(templates, 'liang')).toHaveLength(1);
    expect(filterTemplatesByQuery(templates, '10.1/x')[0].id).toBe('2024-liang-building');
  });
});
