import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handleResultsAiAnalysis, parseAnalysisAnswer, buildAnalysisUserMessage, normalizeAnalysisRequest } from './resultsAiAnalysis.mjs';

const settings = async () => ({ assistant_provider: 'deepseek', assistant_model: 'deepseek-v4-pro' });
const deps = (chat) => ({
  loadUserAiSettings: settings,
  listProviderProfiles: async () => [],
  resolveAssistantBinding: async () => ({ credential: { apiKey: 'k' } }),
  chatCompletions: chat,
});

describe('Results AI analysis', () => {
  it('takes the analyze function out of the answer', () => {
    const code = parseAnalysisAnswer('<think>hm</think>Sure:\n```javascript\nfunction analyze(records, helpers) {\n  return { blocks: [] };\n}\n```\nDone.');
    assert.match(code, /^function analyze\(records, helpers\)/);
    assert.match(parseAnalysisAnswer('function analyze(r) { return []; }'), /function analyze/);
    assert.equal(parseAnalysisAnswer('```json\n{"blocks":[]}\n```'), null);
  });

  it('needs a question and records', () => {
    assert.throws(() => normalizeAnalysisRequest({ question: '', sample: '[]' }), (e) => e.status === 400);
    assert.throws(() => normalizeAnalysisRequest({ question: 'q', sample: ' ' }), (e) => e.status === 400);
  });

  it('does not call the model without a usable route', async () => {
    const chat = mock.fn(async () => ({ content: '' }));
    await assert.rejects(
      () => handleResultsAiAnalysis({}, 'user', { question: 'q', sample: '[{}]' }, { ...deps(chat), resolveAssistantBinding: async () => ({ credential: null }) }),
      (e) => e.code === 'CREDENTIALS_MISSING',
    );
    assert.equal(chat.mock.calls.length, 0);
  });

  it('sends question, fields, sample and the failed code for the one fix', async () => {
    const chat = mock.fn(async () => ({ content: '```js\nfunction analyze(records, helpers) { return { blocks: [{ type: "note", text: "x" }] }; }\n```' }));
    const res = await handleResultsAiAnalysis({}, 'user', {
      question: 'name: q1\ntitle: Which is safer?',
      sample: '[{"answer":"left"}]',
      fields: 'answer  string  (3/3)',
      recordCount: 3,
      instructions: 'left means the left image',
      previous: 'function analyze() { throw 1 }',
      error: 'TypeError: x',
    }, deps(chat));
    assert.match(res.code, /function analyze/);
    const call = chat.mock.calls[0].arguments[0];
    assert.match(call.messages[0].content, /type: "pairwise"/);
    const user = call.messages[1].content;
    assert.match(user, /QUESTION\nname: q1/);
    assert.match(user, /RESEARCHER NOTES \(follow these\)\nleft means/);
    assert.match(user, /RECORDS: 3 in total/);
    assert.match(user, /FIELDS .*\nanswer {2}string/);
    assert.match(user, /YOUR PREVIOUS CODE/);
    assert.match(user, /IT FAILED ON THE REAL RECORDS\nTypeError: x/);
  });

  it('says what the model began with when there is no function', async () => {
    const chat = mock.fn(async () => ({ content: 'I cannot help with that.' }));
    await assert.rejects(() => handleResultsAiAnalysis({}, 'user', { question: 'q', sample: '[{}]' }, deps(chat)), (e) => e.code === 'ANALYSIS_UNPARSEABLE' && /cannot help/.test(e.message));
  });

  it('first request has no fix section', () => {
    const text = buildAnalysisUserMessage(normalizeAnalysisRequest({ question: 'q', sample: '[{}]' }));
    assert.doesNotMatch(text, /PREVIOUS/);
  });
});
