import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimRun,
  expireStaleAiRuns,
  finishRun,
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

  it('cancels running Agent jobs whose lease has expired', async () => {
    const originalFetch = globalThis.fetch;
    const patched = [];
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      if (href.includes('/ai_runs') && (!options?.method || options.method === 'GET')) {
        return jsonResponse([{ id: 'run-stale', user_id: 'user-1' }]);
      }
      if (href.includes('/ai_runs?') && options?.method === 'PATCH') {
        patched.push(JSON.parse(options.body));
        return jsonResponse([{ id: 'run-stale', status: 'cancelled' }]);
      }
      return jsonResponse([]);
    };
    try {
      const result = await expireStaleAiRuns(env(), { userId: 'user-1' });
      assert.deepEqual(result.expired, ['run-stale']);
      assert.equal(patched[0].status, 'cancelled');
      assert.equal(patched[0].cancel_requested, true);
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
