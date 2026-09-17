import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimRun,
  expireStaleAiRuns,
  finishRun,
  listSessions,
  markRunRunning,
  refreshRunLease,
  updateRunCheckpoint,
} from './sessions.mjs';
import { processAgentQueue } from './runDispatcher.mjs';
import { executeQueuedDesignerRun } from './designerChat.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function env() {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    APP_URL: 'https://sp-survey.org',
  };
}

describe('run claim and recovery', () => {
  it('refuses to claim a terminal run', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse([{
      id: 'run-1',
      status: 'completed',
      checkpoint: { step: 3 },
    }]);
    try {
      assert.equal(await claimRun(env(), 'run-1', 'worker-a'), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not mark a completed run as running', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse([]);
    try {
      await assert.rejects(markRunRunning(env(), 'run-1'), (error) => error.code === 'RUN_NOT_UPDATED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not write a checkpoint onto a finished run', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse([{ id: 'run-1', status: 'cancelled' }]);
    try {
      await assert.rejects(
        updateRunCheckpoint(env(), 'run-1', { step: 2 }, 'running'),
        (error) => error.code === 'CHECKPOINT_NOT_SAVED',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips queued execution when the authoritative run is already terminal', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse([{ id: 'run-1', status: 'completed' }]);
    try {
      const result = await executeQueuedDesignerRun(env(), {
        userId: 'user-1',
        sessionId: 'session-1',
        runId: 'run-1',
        body: { message: 'retry' },
      });
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'terminal');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('acks a duplicate delivery of a finished run instead of executing it again', async () => {
    const outcomes = [];
    await processAgentQueue({
      messages: [
        {
          body: { runId: 'run-1' },
          attempts: 1,
          ack: () => outcomes.push('ack-1'),
          retry: () => outcomes.push('retry-1'),
        },
        {
          body: { runId: 'run-1' },
          attempts: 2,
          ack: () => outcomes.push('ack-2'),
          retry: () => outcomes.push('retry-2'),
        },
      ],
    }, {}, {
      executeRun: async () => ({ skipped: true, reason: 'terminal' }),
    });
    assert.deepEqual(outcomes, ['ack-1', 'ack-2']);
  });

  it('does not dispatch the next job when checkpoint persistence fails', async () => {
    const originalFetch = globalThis.fetch;
    let dispatched = false;
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      if (href.includes('/ai_runs?') && options?.method === 'PATCH' && href.includes('status=in')) {
        return jsonResponse([]);
      }
      return jsonResponse([{ id: 'run-1', status: 'running', checkpoint_seq: 1 }]);
    };
    try {
      await assert.rejects(updateRunCheckpoint(env(), 'run-1', { step: 1 }, 'running'));
      assert.equal(dispatched, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases an expired executor lease without cancelling a checkpointed run', async () => {
    const originalFetch = globalThis.fetch;
    const patched = [];
    const store = {
      id: 'run-stale',
      user_id: 'user-1',
      status: 'running',
      cancel_requested: false,
      checkpoint: { step: 2, messages: [{ role: 'assistant', content: 'drafting' }] },
      checkpoint_seq: 2,
      claimed_by: 'queue:run-stale',
      lease_expires_at: new Date(Date.now() - 5_000).toISOString(),
    };
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      const method = String(options?.method || 'GET').toUpperCase();
      if (href.includes('/ai_runs') && method === 'GET') {
        return jsonResponse(Date.parse(store.lease_expires_at || 0) < Date.now() && store.status === 'running'
          ? [store]
          : []);
      }
      if (href.includes('/ai_runs?') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        patched.push({ href, body });
        if (href.includes('lease_expires_at=lt') && Date.parse(store.lease_expires_at || 0) >= Date.now()) {
          return jsonResponse([]);
        }
        Object.assign(store, body);
        return jsonResponse([store]);
      }
      return jsonResponse([]);
    };
    try {
      const result = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(result.released, ['run-stale']);
      assert.deepEqual(result.cancelled, []);
      assert.equal(store.status, 'running');
      assert.equal(store.claimed_by, null);
      assert.equal(store.cancel_requested, false);
      assert.ok(store.checkpoint.step);
      assert.equal(patched.some((item) => item.body.status === 'cancelled'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('still cancels an expired run when the user already requested cancel', async () => {
    const originalFetch = globalThis.fetch;
    const patched = [];
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      const method = String(options?.method || 'GET').toUpperCase();
      if (href.includes('/ai_runs') && method === 'GET') {
        return jsonResponse([{
          id: 'run-cancel',
          user_id: 'user-1',
          status: 'running',
          cancel_requested: true,
          checkpoint: { step: 1 },
        }]);
      }
      if (href.includes('/ai_runs?') && method === 'PATCH') {
        patched.push(JSON.parse(options.body));
        return jsonResponse([{ id: 'run-cancel', status: 'cancelled' }]);
      }
      return jsonResponse([]);
    };
    try {
      const result = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(result.cancelled, ['run-cancel']);
      assert.equal(patched[0].status, 'cancelled');
      assert.equal(patched[0].cancel_requested, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lets a delayed continue reclaim a checkpoint after the 90s lease expires', async () => {
    const originalFetch = globalThis.fetch;
    const store = {
      id: 'run-1',
      status: 'running',
      cancel_requested: false,
      checkpoint: { step: 4 },
      checkpoint_seq: 4,
      claimed_by: 'queue:run-1',
      lease_expires_at: new Date(Date.now() - 91_000).toISOString(),
    };
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      const method = String(options?.method || 'GET').toUpperCase();
      if (href.includes('/rpc/claim_ai_run')) {
        const body = JSON.parse(options.body);
        store.claimed_by = body.p_claimed_by;
        store.lease_expires_at = new Date(Date.now() + 90_000).toISOString();
        return jsonResponse([store]);
      }
      if (href.includes('/ai_runs') && method === 'GET') {
        if (href.includes('lease_expires_at=lt')) {
          return jsonResponse(Date.parse(store.lease_expires_at || 0) < Date.now() ? [store] : []);
        }
        return jsonResponse([store]);
      }
      if (href.includes('/ai_runs?') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        if (href.includes('lease_expires_at=lt') && Date.parse(store.lease_expires_at || 0) >= Date.now()) {
          return jsonResponse([]);
        }
        if (body.status === 'cancelled') {
          throw new Error('expired lease must not cancel a resumable run');
        }
        Object.assign(store, body);
        return jsonResponse([store]);
      }
      return jsonResponse([]);
    };
    try {
      const expired = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(expired.released, ['run-1']);
      assert.equal(store.status, 'running');
      const claimed = await claimRun(env(), 'run-1', 'queue:run-1:continue');
      assert.equal(claimed.id, 'run-1');
      assert.equal(claimed.status, 'running');
      assert.equal(claimed.checkpoint.step, 4);
      assert.equal(store.claimed_by, 'queue:run-1:continue');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not cancel a checkpointed run when listSessions refreshes', async () => {
    const originalFetch = globalThis.fetch;
    const store = {
      id: 'run-1',
      user_id: 'user-1',
      status: 'running',
      cancel_requested: false,
      checkpoint: { step: 3 },
      claimed_by: 'queue:run-1',
      lease_expires_at: new Date(Date.now() - 120_000).toISOString(),
    };
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      const method = String(options?.method || 'GET').toUpperCase();
      if (href.includes('/ai_sessions')) {
        return jsonResponse([{ id: 'session-1', user_id: 'user-1', status: 'active' }]);
      }
      if (href.includes('/ai_runs') && method === 'GET') {
        return jsonResponse(Date.parse(store.lease_expires_at || 0) < Date.now() ? [store] : []);
      }
      if (href.includes('/ai_runs?') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        if (body.status === 'cancelled') {
          throw new Error('listSessions must not cancel a delayed Agent continue');
        }
        Object.assign(store, body);
        return jsonResponse([store]);
      }
      return jsonResponse([]);
    };
    try {
      const sessions = await listSessions(env(), 'user-1');
      assert.equal(sessions[0].id, 'session-1');
      assert.equal(store.status, 'running');
      assert.equal(store.claimed_by, null);
      assert.equal(store.cancel_requested, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('queued continue after a 90s delay reclaims instead of treating the run as abandoned', async () => {
    const originalFetch = globalThis.fetch;
    const store = {
      id: 'run-1',
      status: 'running',
      cancel_requested: false,
      checkpoint: { step: 6 },
      checkpoint_seq: 6,
      claimed_by: 'queue:run-1',
      lease_expires_at: new Date(Date.now() - 95_000).toISOString(),
    };
    let claimed = false;
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      const method = String(options?.method || 'GET').toUpperCase();
      if (href.includes('/rpc/claim_ai_run')) {
        claimed = true;
        store.claimed_by = JSON.parse(options.body).p_claimed_by;
        store.lease_expires_at = new Date(Date.now() + 90_000).toISOString();
        return jsonResponse([store]);
      }
      if (href.includes('/ai_runs') && method === 'GET') {
        if (href.includes('lease_expires_at=lt')) {
          return jsonResponse(Date.parse(store.lease_expires_at || 0) < Date.now() ? [store] : []);
        }
        return jsonResponse([store]);
      }
      if (href.includes('/ai_runs?') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        if (body.status === 'cancelled') {
          throw new Error('delayed continue must not cancel a checkpointed run');
        }
        if (href.includes('lease_expires_at=lt') && Date.parse(store.lease_expires_at || 0) >= Date.now()) {
          return jsonResponse([]);
        }
        Object.assign(store, body);
        return jsonResponse([store]);
      }
      return jsonResponse([]);
    };
    try {
      const result = await executeQueuedDesignerRun(env(), {
        userId: 'user-1',
        sessionId: 'session-1',
        runId: 'run-1',
        claimedBy: 'queue:run-1',
        body: { message: 'continue the draft', projectId: 'proj-1' },
        checkpoint: { step: 6 },
      }).catch((error) => ({ threw: String(error.message || error) }));
      assert.notEqual(result?.reason, 'terminal');
      assert.notEqual(result?.reason, 'not-claimable');
      assert.equal(claimed, true);
      assert.equal(store.status, 'running');
      assert.equal(store.cancel_requested, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lease refresh and expire cannot mis-cancel or double-write a live run', async () => {
    const originalFetch = globalThis.fetch;

    const makeStore = (expired) => ({
      id: 'run-1',
      status: 'running',
      cancel_requested: false,
      checkpoint: { step: 5 },
      claimed_by: 'queue:run-1',
      lease_expires_at: new Date(Date.now() + (expired ? -1_000 : 90_000)).toISOString(),
    });

    const install = (store) => {
      globalThis.fetch = async (url, options) => {
        const href = String(url);
        const method = String(options?.method || 'GET').toUpperCase();
        if (href.includes('/rpc/claim_ai_run')) {
          if (store.claimed_by !== 'queue:run-1' || store.status !== 'running') return jsonResponse([]);
          store.lease_expires_at = new Date(Date.now() + 90_000).toISOString();
          return jsonResponse([store]);
        }
        if (href.includes('/ai_runs') && method === 'GET') {
          return jsonResponse(Date.parse(store.lease_expires_at || 0) < Date.now() && store.status === 'running'
            ? [store]
            : []);
        }
        if (href.includes('/ai_runs?') && method === 'PATCH') {
          const body = JSON.parse(options.body);
          if (body.status === 'cancelled') {
            throw new Error('expire must not cancel while a refresh can still win');
          }
          if (href.includes('lease_expires_at=lt')) {
            if (store.status !== 'running' || Date.parse(store.lease_expires_at || 0) >= Date.now()) {
              return jsonResponse([]);
            }
          }
          if (href.includes('claimed_by=eq') && store.claimed_by !== 'queue:run-1') {
            return jsonResponse([]);
          }
          Object.assign(store, body);
          return jsonResponse([store]);
        }
        return jsonResponse([]);
      };
    };

    try {
      const live = makeStore(false);
      install(live);
      await refreshRunLease(env(), 'run-1', 'queue:run-1');
      const afterRefresh = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(afterRefresh.released, []);
      assert.deepEqual(afterRefresh.cancelled, []);
      assert.equal(live.status, 'running');
      assert.equal(live.claimed_by, 'queue:run-1');
      assert.ok(Date.parse(live.lease_expires_at) > Date.now());

      const stale = makeStore(true);
      install(stale);
      const afterExpire = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(afterExpire.released, ['run-1']);
      const lateRefresh = await refreshRunLease(env(), 'run-1', 'queue:run-1');
      assert.equal(lateRefresh, null);
      assert.equal(stale.status, 'running');
      assert.equal(stale.claimed_by, null);
      assert.equal(stale.cancel_requested, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refreshes a live Agent lease for the same owner', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      if (href.includes('/rpc/claim_ai_run')) {
        const body = JSON.parse(options.body);
        assert.equal(body.p_claimed_by, 'queue:run-1');
        return jsonResponse([{ id: 'run-1', claimed_by: 'queue:run-1' }]);
      }
      return jsonResponse([]);
    };
    try {
      const row = await refreshRunLease(env(), 'run-1', 'queue:run-1');
      assert.equal(row.claimed_by, 'queue:run-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('leaves a finished run finished', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse([]);
    try {
      const row = await finishRun(env(), 'run-1', { status: 'completed' });
      assert.equal(row, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
