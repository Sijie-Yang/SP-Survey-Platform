import { EXTRACTION_VERSION } from './researchPaperMeta.mjs';

const mockCalls = [];
let mockRows = [];

// A small stand-in for the query builder: records each query and answers it
// from mockRows the way PostgREST would (columns, id filter, range).
jest.mock('./supabase', () => {
  const builder = () => {
    const query = { cols: '', ids: null, eqId: null, range: null };
    const run = () => {
      mockCalls.push(query);
      let rows = mockRows;
      if (query.ids) rows = rows.filter((row) => query.ids.includes(row.id));
      if (query.eqId) rows = rows.filter((row) => row.id === query.eqId);
      if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
      const cols = query.cols.split(',').map((col) => col.trim());
      const data = rows.map((row) => Object.fromEntries(cols.map((col) => [col, row[col]])));
      return { data, error: null };
    };
    const api = {
      select(cols) { query.cols = cols; return api; },
      eq(col, value) { if (col === 'id') query.eqId = value; return api; },
      in(col, ids) { query.ids = ids; return api; },
      order() { return api; },
      range(from, to) { query.range = [from, to]; return api; },
      maybeSingle: async () => { const { data } = run(); return { data: data[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  };
  return { supabase: { from: () => builder() } };
});

// eslint-disable-next-line import/first
import { getPublicPaperAbstract, listPublicResearchPapers } from './researchPaperStore';

const currentMeta = {
  extraction_version: EXTRACTION_VERSION,
  perception_constructs: ['safety'],
  visual_data_sources: [],
  response_protocols: [],
  measurement_channels: [],
  study_countries: [],
  reporting_signals: [],
  analysis_scope: 'perception',
};

const paper = (n, extra = {}) => ({
  id: `p${n}`,
  doi: `10.1/${n}`,
  title: `Paper ${n}`,
  authors: [],
  year: 2025,
  abstract: `Abstract ${n}`,
  status: 'approved',
  analysis_meta: currentMeta,
  ...extra,
});

beforeEach(() => { mockCalls.length = 0; });

test('the public list comes without abstracts when tags are current', async () => {
  mockRows = [paper(1), paper(2)];
  const papers = await listPublicResearchPapers();
  expect(papers.map((p) => p.id)).toEqual(['p1', 'p2']);
  expect(papers.every((p) => p.abstract === '')).toBe(true);
  expect(papers[0].analysis_meta).toBe(currentMeta);
  expect(mockCalls.some((call) => /abstract/.test(call.cols))).toBe(false);
});

test('papers with out-of-date tags get their abstract so tags can be rebuilt', async () => {
  mockRows = [paper(1), paper(2, { analysis_meta: { extraction_version: 'v1' } }), paper(3, { analysis_meta: null })];
  const papers = await listPublicResearchPapers();
  expect(papers.map((p) => p.abstract)).toEqual(['', 'Abstract 2', 'Abstract 3']);
  const abstractCalls = mockCalls.filter((call) => /abstract/.test(call.cols));
  expect(abstractCalls).toHaveLength(1);
  expect(abstractCalls[0].ids).toEqual(['p2', 'p3']);
  expect(papers[1].analysis_meta.extraction_version).toBe(EXTRACTION_VERSION);
});

test('every page of a long list is read, the first two together', async () => {
  mockRows = Array.from({ length: 25 }, (_, i) => paper(i));
  const papers = await listPublicResearchPapers({ pageSize: 10 });
  expect(papers.map((p) => p.id)).toEqual(mockRows.map((row) => row.id));
  expect(mockCalls.map((call) => call.range)).toEqual([[0, 9], [10, 19], [20, 29]]);
});

test('one abstract is fetched once per paper', async () => {
  mockRows = [paper(7)];
  expect(await getPublicPaperAbstract('p7')).toBe('Abstract 7');
  expect(await getPublicPaperAbstract('p7')).toBe('Abstract 7');
  expect(mockCalls).toHaveLength(1);
  expect(await getPublicPaperAbstract('')).toBe('');
});
