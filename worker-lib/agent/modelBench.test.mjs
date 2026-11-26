import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../../src/lib/spScheme.js';
import { BENCH_PROMPTS, runModelBenchJob, startModelBench } from './modelBench.mjs';

const GOOD = buildExampleSite().trim();
const route = async () => ({ apiKey: 'k', provider: 'x', model: 'm', modelRecord: { maxTokens: 8000 }, keySource: 'user' });

describe('model bench', () => {
  it('queues one job per description and checks the route first', async () => {
    const jobs = [];
    const writes = [];
    const out = await startModelBench({}, 'u1', { provider: 'openrouter', model: 'a/b:free', benchId: 'bench-0001' }, {
      dispatch: async (job) => jobs.push(job),
      resolveRoute: route,
      write: async (key, body) => writes.push({ key, body }),
    });
    assert.equal(out.benchId, 'bench-0001');
    assert.equal(jobs.length, BENCH_PROMPTS.length);
    assert.equal(jobs[0].kind, 'model-bench');
    assert.match(writes[0].key, /^_admin-model-bench\/bench-0001\/openrouter__a-b-free__/);
    await assert.rejects(startModelBench({}, 'u1', { provider: 'p', model: 'm', prompts: ['nope'] }, { dispatch: async () => {}, resolveRoute: route }), /Unknown prompt/);
    await assert.rejects(startModelBench({}, 'u1', { provider: 'p', model: 'm' }, {
      dispatch: async () => {},
      resolveRoute: async () => { throw new Error('No API key configured.'); },
    }), /No API key/);
  });

  it('runs the production page writer and records pass, rounds and timing', async () => {
    let saved;
    const chat = async () => ({ content: `Done.\n\`\`\`html\n${GOOD}\n\`\`\``, usage: { prompt_tokens: 10, completion_tokens: 20 } });
    await runModelBenchJob({}, { userId: 'u1', benchId: 'b', provider: 'x', model: 'm', promptId: 'pairwise-zh' }, {
      chat, resolveRoute: route, write: async (body) => { saved = body; },
    });
    assert.equal(saved.status, 'done');
    assert.equal(saved.passed, true);
    assert.equal(saved.firstTry, true);
    assert.equal(saved.rounds, 1);
    assert.equal(saved.calls.length, 1);
    assert.deepEqual(saved.calls[0].usage, { prompt_tokens: 10, completion_tokens: 20 });
    assert.equal(saved.html, GOOD);
  });

  it('records a failed model call instead of throwing', async () => {
    let saved;
    await runModelBenchJob({}, { userId: 'u1', benchId: 'b', provider: 'x', model: 'm', promptId: 'rating-en' }, {
      chat: async () => { throw new Error('429 rate limited'); }, resolveRoute: route, write: async (body) => { saved = body; },
    });
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /429/);
    assert.match(saved.calls[0].error, /429/);
  });
});
