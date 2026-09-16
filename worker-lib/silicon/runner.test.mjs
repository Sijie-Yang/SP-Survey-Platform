import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeSiliconJob, isSiliconJob, siliconProgressStatuses } from './runner.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('silicon run status guards', () => {
  it('only treats queued, draft, and running as active', () => {
    assert.deepEqual(siliconProgressStatuses(), ['queued', 'draft', 'running']);
    assert.equal(siliconProgressStatuses().includes('cancelled'), false);
    assert.equal(isSiliconJob({ kind: 'silicon', runId: 'r1' }), true);
    assert.equal(isSiliconJob({ kind: 'designer', runId: 'r1' }), false);
  });
});

describe('silicon background job safety', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_ANON_KEY: 'anon',
  };
  let runs;
  let units;
  let events;
  let originalFetch;

  beforeEach(() => {
    runs = {
      r1: {
        id: 'r1',
        user_id: 'u1',
        status: 'running',
        cancel_requested: false,
        claimed_by: 'other',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        progress_total: 2,
        progress_processed: 0,
        tokens_used: 0,
      },
    };
    units = [];
    events = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      const path = parsed.pathname;
      if (path.endsWith('/rpc/claim_silicon_run')) {
        const body = JSON.parse(init.body || '{}');
        const held = runs.r1.claimed_by
          && runs.r1.claimed_by !== body.p_claimed_by
          && Date.parse(runs.r1.lease_expires_at || 0) > Date.now();
        if (held) return json([]);
        runs.r1.claimed_by = body.p_claimed_by;
        runs.r1.status = 'running';
        return json([runs.r1]);
      }
      if (path.endsWith('/rpc/claim_silicon_unit')) {
        return json([]);
      }
      if (path.endsWith('/silicon_runs') && parsed.searchParams.get('id') === 'eq.r1') {
        return json([runs.r1]);
      }
      if (path.endsWith('/silicon_answer_units')) {
        return json(units);
      }
      if (path.endsWith('/silicon_answer_events')) {
        return json(events);
      }
      if (path.endsWith('/ai_runs')) {
        return json([]);
      }
      return json([]);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not start a second worker while another lease is valid', async () => {
    const result = await executeSiliconJob(env, {
      runId: 'r1',
      claimedBy: 'worker-b',
      disableRedispatch: true,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'lease_held');
  });

  it('finalizes a cancelled run without calling the model', async () => {
    runs.r1.claimed_by = 'worker-a';
    runs.r1.cancel_requested = true;
    const result = await executeSiliconJob(env, {
      runId: 'r1',
      claimedBy: 'worker-a',
      disableRedispatch: true,
    });
    assert.equal(result.finished, true);
    assert.equal(result.status, 'cancelled');
  });

  it('finalizes a fully saved run even when the Assistant is busy', async () => {
    runs.r1.claimed_by = 'worker-a';
    units = [
      { id: 'u1', run_id: 'r1', persona_id: 'p1', repeat_index: 1, question_name: 'q1', trial_index: 1, status: 'saved' },
      { id: 'u2', run_id: 'r1', persona_id: 'p1', repeat_index: 1, question_name: 'q2', trial_index: 1, status: 'saved' },
    ];
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      const path = parsed.pathname;
      if (path.endsWith('/rpc/claim_silicon_run')) {
        const body = JSON.parse(init.body || '{}');
        if (runs.r1.claimed_by && runs.r1.claimed_by !== body.p_claimed_by
          && Date.parse(runs.r1.lease_expires_at || 0) > Date.now()) {
          return json([]);
        }
        runs.r1.claimed_by = body.p_claimed_by;
        return json([runs.r1]);
      }
      if (path.endsWith('/rpc/claim_silicon_unit')) {
        return json([]);
      }
      if (path.endsWith('/silicon_runs') && parsed.searchParams.get('id') === 'eq.r1') {
        if (init.method === 'PATCH') {
          const body = JSON.parse(init.body || '{}');
          Object.assign(runs.r1, body);
        }
        return json([runs.r1]);
      }
      if (path.endsWith('/silicon_answer_units')) return json(units);
      if (path.endsWith('/silicon_answer_events')) return json(events);
      if (path.endsWith('/ai_runs')) {
        return json([{ id: 'asst-1', provider: 'qwen-dashscope', claimed_by: 'chat', lease_expires_at: new Date(Date.now() + 60_000).toISOString() }]);
      }
      return json([]);
    };
    const result = await executeSiliconJob(env, {
      runId: 'r1',
      claimedBy: 'worker-a',
      disableRedispatch: true,
    });
    assert.equal(result.finished, true);
    assert.equal(result.status, 'completed');
    assert.equal(runs.r1.status, 'completed');
  });

  it('does not treat unknown units as completed success', async () => {
    runs.r1.claimed_by = 'worker-a';
    units = [{
      id: 'u1',
      run_id: 'r1',
      persona_id: 'p1',
      repeat_index: 1,
      question_name: 'q1',
      trial_index: 1,
      status: 'unknown',
    }];
    const counts = (await import('./executionPlan.mjs')).countsFromUnits(units);
    assert.equal(counts.processed, 0);
    assert.equal(counts.valid, 0);
    assert.equal(counts.unknown, 1);
  });

  it('does not write a unit after another worker took the lease', async () => {
    const { patchUnitForTest } = await import('./runner.mjs').catch(() => ({}));
    runs.r1.claimed_by = 'worker-b';
    const result = await executeSiliconJob(env, {
      runId: 'r1',
      claimedBy: 'worker-a',
      disableRedispatch: true,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'lease_held');
    assert.equal(patchUnitForTest, undefined);
  });

  it('assigns a unique claimedBy when the job omits one', async () => {
    const { newSiliconClaimedBy } = await import('./runner.mjs');
    const a = newSiliconClaimedBy('r1');
    const b = newSiliconClaimedBy('r1');
    assert.notEqual(a, b);
    assert.match(a, /^queue:r1:/);
  });

  it('skips already saved units without calling the model', async () => {
    runs.r1.claimed_by = 'worker-a';
    units = [{
      id: 'u1',
      run_id: 'r1',
      persona_id: 'p1',
      repeat_index: 1,
      question_name: 'q1',
      trial_index: 1,
      status: 'saved',
      lease_owner: 'worker-a',
    }];
    let modelCalls = 0;
    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      const path = parsed.pathname;
      if (path.includes('/chat/completions') || path.includes('/compatible-mode')) {
        modelCalls += 1;
        return json({ choices: [{ message: { content: '4' } }] });
      }
      if (path.endsWith('/rpc/claim_silicon_run')) return json([runs.r1]);
      if (path.endsWith('/rpc/claim_silicon_unit')) return json([units[0]]);
      if (path.endsWith('/silicon_runs')) {
        if (init.method === 'PATCH') Object.assign(runs.r1, JSON.parse(init.body || '{}'));
        return json([runs.r1]);
      }
      if (path.endsWith('/silicon_answer_units')) return json(units);
      if (path.endsWith('/silicon_responses')) return json([{ id: 'resp-1', responses: {}, displayed_images: {} }]);
      if (path.endsWith('/silicon_answer_events')) return json(events);
      if (path.endsWith('/ai_runs')) return json([]);
      return json([]);
    };
    const result = await executeSiliconJob({
      ...env,
      AGENT_QUEUE: { send: async (job, options) => sent.push({ job, options }) },
    }, {
      runId: 'r1',
      claimedBy: 'worker-a',
      disableRedispatch: true,
    });
    assert.equal(modelCalls, 0);
    assert.equal(result.skippedExisting || result.finished || result.success, true);
  });

  it('rejects a unit write after the lease owner changes', async () => {
    const { patchSiliconUnit } = await import('./runner.mjs');
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      if (parsed.pathname.endsWith('/silicon_answer_units') && String(init.method || '').toUpperCase() === 'PATCH') {
        return json([]);
      }
      return json([]);
    };
    await assert.rejects(
      () => patchSiliconUnit(env, 'u1', { status: 'saved' }, { claimedBy: 'worker-a' }),
      (error) => error.code === 'SILICON_LEASE_LOST',
    );
  });

  it('requeues with delaySeconds when the Assistant is busy', async () => {
    runs.r1.claimed_by = 'worker-a';
    units = [{
      id: 'u1',
      run_id: 'r1',
      persona_id: 'p1',
      repeat_index: 1,
      question_name: 'q1',
      trial_index: 1,
      status: 'pending',
    }];
    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      const path = parsed.pathname;
      if (path.endsWith('/rpc/claim_silicon_run')) return json([runs.r1]);
      if (path.endsWith('/rpc/claim_silicon_unit')) return json([]);
      if (path.endsWith('/silicon_runs') && init.method === 'PATCH') {
        Object.assign(runs.r1, JSON.parse(init.body || '{}'));
        return json([runs.r1]);
      }
      if (path.endsWith('/silicon_runs')) return json([runs.r1]);
      if (path.endsWith('/silicon_answer_units')) return json(units);
      if (path.endsWith('/silicon_answer_events')) return json(events);
      if (path.endsWith('/ai_runs')) {
        return json([{
          id: 'asst-1',
          provider: 'qwen-dashscope',
          claimed_by: 'chat',
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        }]);
      }
      return json([]);
    };
    const result = await executeSiliconJob({
      ...env,
      AGENT_QUEUE: { send: async (job, options) => sent.push({ job, options }) },
    }, {
      runId: 'r1',
      userId: 'u1',
      claimedBy: 'worker-a',
    });
    assert.equal(result.deferred, true);
    assert.equal(result.delaySeconds, 15);
    assert.equal(sent[0].options.delaySeconds, 15);
    assert.match(sent[0].job.claimedBy, /^queue:r1:/);
  });

  it('fails closed when claim_silicon_run is missing', async () => {
    globalThis.fetch = async (url) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      if (parsed.pathname.endsWith('/rpc/claim_silicon_run')) {
        return json({ message: 'Could not find the function public.claim_silicon_run', code: 'PGRST202' }, 404);
      }
      if (parsed.pathname.endsWith('/silicon_runs')) return json([runs.r1]);
      return json([]);
    };
    await assert.rejects(
      () => executeSiliconJob(env, { runId: 'r1', claimedBy: 'worker-a', disableRedispatch: true }),
      (error) => error.code === 'SILICON_LEASE_UNAVAILABLE',
    );
  });
});
