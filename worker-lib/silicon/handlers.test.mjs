import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { siliconResponsesToCsv, cancelSiliconRun, listSiliconTasks, getSiliconProgress, resetSiliconListRecoverForTests } from './handlers.mjs';
import { countsFromUnits } from './executionPlan.mjs';

describe('silicon export', () => {
  it('writes an independent CSV that is not a survey_responses dump', () => {
    const csv = siliconResponsesToCsv([
      {
        participant_id: 'silicon_abc_1',
        persona_id: 'p1',
        repeat_index: 1,
        status: 'ok',
        displayed_images: { q1: ['https://cdn.example/a.jpg'] },
        survey_metadata: { persona_name: 'Resident' },
        responses: { q1: 5, q2: ['a', 'b'] },
      },
    ], {
      id: 'run-9',
      model: 'qwen-vl',
      provider: 'qwen-dashscope',
      draft_updated_at: '2026-09-16T00:00:00.000Z',
      media_snapshot: { dataset: { mediaFolderTags: { street: 'set', park: 'set' } } },
    });
    assert.match(csv, /response_source,run_id,model,provider,draft_updated_at,media_folders,media_ids/);
    assert.match(csv, /silicon,run-9,qwen-vl,qwen-dashscope,2026-09-16T00:00:00.000Z/);
    assert.match(csv, /street\|park/);
    assert.match(csv, /silicon_abc_1,p1,Resident,1,ok,q1,5/);
    assert.doesNotMatch(csv, /survey_responses/);
  });

  it('keeps export counts aligned with answer units', () => {
    const units = [
      { status: 'saved' },
      { status: 'saved' },
      { status: 'failed' },
      { status: 'pending' },
    ];
    const counts = countsFromUnits(units);
    assert.equal(counts.processed, 3);
    assert.equal(counts.valid, 2);
    assert.equal(counts.failed, 1);
    assert.equal(counts.total, 4);
    assert.equal(counts.valid + counts.failed + counts.skipped + counts.unknown + counts.pending, counts.total);
  });
});

describe('silicon task APIs', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_ANON_KEY: 'anon',
    AGENT_QUEUE: { send: async () => {} },
  };
  const auth = { userId: 'u1', accessToken: 'tok' };
  let store;
  let originalFetch;

  beforeEach(() => {
    resetSiliconListRecoverForTests();
    store = {
      runs: [
        {
          id: 'r-mine',
          user_id: 'u1',
          project_id: 'proj-a',
          status: 'running',
          cancel_requested: false,
          progress_total: 2,
          progress_processed: 1,
          progress_valid: 1,
          progress_failed: 0,
          updated_at: new Date().toISOString(),
        },
        {
          id: 'r-other',
          user_id: 'u2',
          project_id: 'proj-b',
          status: 'running',
          cancel_requested: false,
          progress_total: 4,
          updated_at: new Date().toISOString(),
        },
        {
          id: 'r-done',
          user_id: 'u1',
          project_id: 'proj-a',
          status: 'completed',
          progress_total: 2,
          progress_processed: 2,
          progress_valid: 2,
          progress_failed: 0,
          updated_at: new Date().toISOString(),
        },
      ],
      units: [
        { id: 'u1', run_id: 'r-mine', status: 'saved', persona_id: 'p1', repeat_index: 1, question_name: 'q1', trial_index: 1 },
        { id: 'u2', run_id: 'r-mine', status: 'pending', persona_id: 'p1', repeat_index: 1, question_name: 'q2', trial_index: 1 },
      ],
      events: [
        { id: 10, type: 'unit.start', question_name: 'q1', payload: {}, created_at: '2026-09-16T00:00:00.000Z' },
        { id: 11, type: 'unit.saved', question_name: 'q1', payload: { rationale: 'street looks safe' }, created_at: '2026-09-16T00:00:01.000Z' },
        { id: 12, type: 'unit.start', question_name: 'q2', payload: {}, created_at: '2026-09-16T00:00:02.000Z' },
      ],
      patches: [],
    };
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      const path = parsed.pathname;
      const userEq = parsed.searchParams.get('user_id');
      const statusIn = parsed.searchParams.get('status');
      const idEq = parsed.searchParams.get('id');
      const runEq = parsed.searchParams.get('run_id');
      const idGt = parsed.searchParams.get('id');
      if (path.endsWith('/silicon_runs')) {
        if (init.method === 'PATCH') {
          store.patches.push({ url: parsed.href, body: JSON.parse(init.body || '{}') });
          const row = store.runs.find((run) => `eq.${run.id}` === idEq);
          if (row) Object.assign(row, JSON.parse(init.body || '{}'));
          return json([]);
        }
        let rows = store.runs;
        if (userEq) rows = rows.filter((run) => `eq.${run.user_id}` === userEq);
        if (statusIn?.startsWith('in.')) {
          const inner = statusIn.slice(statusIn.indexOf('(') + 1, statusIn.lastIndexOf(')'));
          const wanted = inner.split(',');
          rows = rows.filter((run) => wanted.includes(run.status));
        } else if (statusIn?.startsWith('eq.')) {
          rows = rows.filter((run) => run.status === statusIn.slice(3));
        }
        if (idEq) rows = rows.filter((run) => `eq.${run.id}` === idEq);
        return json(rows);
      }
      if (path.endsWith('/silicon_answer_units')) {
        return json(store.units.filter((unit) => !runEq || `eq.${unit.run_id}` === runEq));
      }
      if (path.endsWith('/silicon_answer_events')) {
        const after = Number((parsed.searchParams.get('id') || '').replace('gt.', '') || 0);
        return json(store.events.filter((event) => (!runEq || `eq.r-mine` === runEq) && event.id > after));
      }
      if (path.endsWith('/projects')) {
        return json([{ id: 'proj-a', name: 'Project A' }]);
      }
      return json([]);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('lists tasks for the current user only', async () => {
    const result = await listSiliconTasks(env, auth, null);
    assert.equal(result.success, true);
    assert.deepEqual(result.active.map((run) => run.id), ['r-mine']);
    assert.equal(result.active.some((run) => run.user_id === 'u2'), false);
    assert.deepEqual(result.recent.map((run) => run.id), ['r-done']);
    assert.equal(result.active[0].project_name, 'Project A');
  });

  it('recovers stale leases on the first list, then skips recover on the next list', async () => {
    const recoverUrls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.includes('lease_expires_at=lt') || href.includes('status=eq.queued')) recoverUrls.push(href);
      return original(url, init);
    };
    await listSiliconTasks(env, auth, null);
    const first = recoverUrls.length;
    assert.ok(first >= 2);
    recoverUrls.length = 0;
    await listSiliconTasks(env, auth, null);
    assert.equal(recoverUrls.length, 0);
  });

  it('returns incremental progress events after a cursor', async () => {
    const result = await getSiliconProgress(env, auth, 'r-mine', 10);
    assert.equal(result.success, true);
    assert.deepEqual(result.events.map((event) => event.id), [11, 12]);
    assert.equal(result.counts.valid, 1);
    assert.equal(result.counts.pending, 1);
    assert.equal(result.nextCursor, 12);
  });

  it('cancels a running run and falls back when lease columns are missing', async () => {
    const first = await cancelSiliconRun(env, auth, 'r-mine');
    assert.equal(first.success, true);
    assert.equal(first.stopping, true);
    assert.equal(store.runs.find((run) => run.id === 'r-mine').cancel_requested, true);

    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url, 'https://example.supabase.co');
      if (parsed.pathname.endsWith('/silicon_runs') && init.method === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        if ('cancel_requested' in body) {
          return new Response(JSON.stringify({ message: 'column cancel_requested does not exist' }), { status: 400 });
        }
        const row = store.runs.find((run) => run.id === 'r-mine');
        Object.assign(row, body);
        return json([]);
      }
      if (parsed.pathname.endsWith('/silicon_runs')) {
        return json([store.runs.find((run) => run.id === 'r-mine')]);
      }
      return json([]);
    };
    store.runs.find((run) => run.id === 'r-mine').status = 'running';
    const fallback = await cancelSiliconRun(env, auth, 'r-mine');
    assert.equal(fallback.status, 'cancelled');
    assert.equal(store.runs.find((run) => run.id === 'r-mine').status, 'cancelled');
  });
});
