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

  it('dispatches silicon jobs through the same queue contract', async () => {
    const sent = [];
    const result = await dispatchAgentRun({
      AGENT_QUEUE: { send: async (job) => sent.push(job) },
    }, null, { kind: 'silicon', runId: 'sil-1' }, {
      executeRun: async () => assert.fail('must not run inline'),
    });
    assert.equal(result.dispatch, 'queue');
    assert.equal(sent[0].kind, 'silicon');
    assert.equal(sent[0].runId, 'sil-1');
    assert.match(sent[0].claimedBy || '', /^queue:sil-1:/);
  });

  it('passes delaySeconds to the queue and keeps distinct worker identities', async () => {
    const sent = [];
    await dispatchAgentRun({
      AGENT_QUEUE: { send: async (job, options) => sent.push({ job, options }) },
    }, null, { kind: 'silicon', runId: 'sil-2' }, {
      executeRun: async () => assert.fail('must not run inline'),
      delaySeconds: 15,
    });
    assert.equal(sent[0].options.delaySeconds, 15);
    await dispatchAgentRun({
      AGENT_QUEUE: { send: async (job) => sent.push({ job }) },
    }, null, { kind: 'silicon', runId: 'sil-2' }, {
      executeRun: async () => assert.fail('must not run inline'),
    });
    assert.notEqual(sent[0].job.claimedBy, sent[1].job.claimedBy);
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
