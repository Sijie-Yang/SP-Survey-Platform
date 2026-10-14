import { buildSiteResultsExportFiles } from './questionSummaryExport';

test('an SP-Scheme export holds only the answers table and the raw records', () => {
  const files = buildSiteResultsExportFiles({ project: { id: 'p' }, filteredResponses: [{ id: 'a', responses: { __sp_requests: [{ url: '/api/x' }] } }], wideCsv: 'id\na\n' });
  expect(files.map((f) => f.path)).toEqual(['README.txt', 'responses_wide.csv', 'responses_raw.json']);
  expect(JSON.parse(files[2].content)[0].responses.__sp_requests[0].url).toBe('/api/x');
  expect(files[0].content).toMatch(/has not analysed anything/);
});
