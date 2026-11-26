import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, recordUsage, usageMeter, usageRow } from './usageLog.mjs';

const PRICE = { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 };

test('estimateCostUsd prices cache hits at the cache rate', () => {
  // 1M prompt tokens of which 800k were cache hits, 100k output.
  const usd = estimateCostUsd({ prompt_tokens: 1_000_000, cache_read_tokens: 800_000, completion_tokens: 100_000 }, PRICE);
  // 200k fresh * 0.3 + 800k * 0.006 + 100k * 1.2 = 0.06 + 0.0048 + 0.12
  assert.equal(usd, 0.1848);
  assert.equal(estimateCostUsd({ prompt_tokens: 10 }, null), null);
  assert.equal(estimateCostUsd({ prompt_tokens: 10 }, { input: 0, output: 0 }), null);
});

test('usageRow marks free-model calls with the key owner', () => {
  const meter = usageMeter({}, {
    userId: 'u1',
    binding: { source: 'subsidy', credential: { donorUserId: 'admin' } },
    feature: 'assistant-spscheme',
    projectId: 'p1',
    runId: 'r1',
  });
  const row = usageRow(meter, { provider: 'deepseek', model: 'deepseek-flash' }, { prompt_tokens: 1000, cache_read_tokens: 500, completion_tokens: 200 });
  assert.equal(row.source, 'subsidy');
  assert.equal(row.key_owner_id, 'admin');
  assert.equal(row.user_id, 'u1');
  assert.equal(row.feature, 'assistant-spscheme');
  assert.equal(row.run_id, 'r1');
  assert.ok(row.cost_usd > 0);
});

test('usageRow: own key → key owner is the user; empty usage → no row', () => {
  const meter = usageMeter({}, { userId: 'u2', binding: { source: 'user' }, feature: 'weird' });
  const row = usageRow(meter, { provider: 'x', model: 'y' }, { prompt_tokens: 5, completion_tokens: 1 });
  assert.equal(row.key_owner_id, 'u2');
  assert.equal(row.feature, 'assistant');
  assert.equal(row.cost_usd, null);
  assert.equal(usageRow(meter, {}, {}), null);
  assert.equal(usageMeter(null, { userId: 'u' }), null);
});

test('recordUsage never throws when the database is unavailable', async () => {
  const meter = usageMeter({}, { userId: 'u3', binding: { source: 'user' }, feature: 'translate' });
  await recordUsage(meter, { provider: 'deepseek', model: 'deepseek-flash' }, { prompt_tokens: 10, completion_tokens: 2 });
});
