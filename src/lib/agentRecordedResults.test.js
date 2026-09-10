import { exportResponses, summarizeResponses } from '../../worker-lib/agent/resultsHandlers.mjs';
import { loadOwned } from '../../worker-lib/agent/projectLifecycle.mjs';
import { supabaseRest } from '../../worker-lib/supabaseUserClient.mjs';
jest.mock('../../worker-lib/agent/projectLifecycle.mjs', () => ({ loadOwned: jest.fn() }));
jest.mock('../../worker-lib/supabaseUserClient.mjs', () => ({ supabaseRest: jest.fn() }));
const oldQ = { name: 'old', type: 'rating', rateMin: 1, rateMax: 5 };
const old = { id: 'a', participant_id: 'p', responses: { old: { answer: 4 } }, survey_metadata: { survey_revision: 'v1', survey_response_contract: { questions: [oldQ] } } };
const newer = { id: 'b', participant_id: 'p2', responses: { other: { answer: 2 } }, survey_metadata: { survey_revision: 'v2', survey_response_contract: { questions: [{ name: 'other', type: 'rating' }] } } };
beforeEach(() => { loadOwned.mockResolvedValue({ survey_config_draft: { pages: [{ elements: [{ name: 'renamed', type: 'text' }] }] } }); supabaseRest.mockImplementation((env, opts) => Promise.resolve(!opts.query.includes('&or=') ? [old, newer] : [])); });
test('MCP typed exports and summaries use a single recorded questionnaire version', async () => {
  const exported = await exportResponses({}, {}, 'p', { format: 'long_csv', surveyRevision: 'v1' });
  expect(exported.n).toBe(1); expect(exported.longCsv).toContain('old'); expect(exported.longCsv).not.toContain('renamed');
  const summary = await summarizeResponses({}, {}, 'p', {});
  expect(summary.surveyRevision).toBe('v1'); expect(summary.availableRevisions).toEqual(['v1', 'v2']);
});
test('raw JSON retains all versions; unknown explicit revision fails instead of silently selecting another', async () => {
  const raw = await exportResponses({}, {}, 'p', { format: 'json' });
  expect(raw.responses).toHaveLength(2);
  await expect(exportResponses({}, {}, 'p', { format: 'long_csv', surveyRevision: 'missing' })).rejects.toThrow('not found');
});
test('agent analysis bundles include matching historical data, dictionary and filter record', async () => {
  const exported = await exportResponses({}, {}, 'p', { format: 'analysis_bundle', surveyRevision: 'v1' });
  const files = Object.fromEntries(exported.analysisBundle.files.map((f) => [f.path, f.content]));
  expect(JSON.parse(files['responses_raw.json']).map((r) => r.id)).toEqual(['a']);
  expect(JSON.parse(files['data_dictionary.json']).questions[0]).toMatchObject({ name: 'old', rateMax: 5 });
  expect(JSON.parse(files['data_dictionary.json']).questions[0].long_table_columns).toContain('survey_revision');
  expect(JSON.parse(files['analysis_plan.json'])).toMatchObject({ filters: { survey_revision: 'v1' }, submission_count: 1, participant_count: 1 });
  expect(files['responses_wide.csv']).toContain('old');
  expect(files['data_quality.csv']).toBeTruthy();
  expect(files['methods.txt']).not.toContain('Methods export unavailable');
});
