import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchAgentRun, processAgentQueue } from './runDispatcher.mjs';

describe('agent run dispatcher', () => {
  it('prefers the Cloudflare Queue binding', async () => {
    const sent = [];
    const result = await dispatchAgentRun({
      AGENT_QUEUE: { send: async (...args) => sent.push(args) },
    }, null, { runId: 'run-1' }, {
      executeRun: async () => assert.fail('must not run inline'),
    });
    assert.equal(result.dispatch, 'queue');
    assert.equal(sent[0][0].runId, 'run-1');
  });

  it('uses waitUntil in local Worker development', async () => {
    let promise;
    let ran = false;
    const result = await dispatchAgentRun({}, {
      waitUntil(value) {
        promise = value;
      },
    }, { runId: 'run-2' }, {
      executeRun: async () => {
        ran = true;
      },
    });
    await promise;
    assert.equal(result.dispatch, 'waitUntil');
    assert.equal(ran, true);
  });

  it('acks success and retries transient queue failures', async () => {
    const outcomes = [];
    const batch = {
      messages: [
        {
          body: { runId: 'ok' },
          attempts: 1,
          ack: () => outcomes.push('ack-ok'),
          retry: () => outcomes.push('retry-ok'),
        },
        {
          body: { runId: 'retry' },
          attempts: 1,
          ack: () => outcomes.push('ack-retry'),
          retry: () => outcomes.push('retry-failed'),
        },
      ],
    };
    await processAgentQueue(batch, {}, {
      executeRun: async (job) => {
        if (job.runId === 'retry') throw new Error('temporary');
      },
    });
    assert.deepEqual(outcomes, ['ack-ok', 'retry-failed']);
  });
});
