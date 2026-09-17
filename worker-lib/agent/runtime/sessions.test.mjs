import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunCancellationCheck,
  deriveModelHistory,
  isRunCancellationRequested,
  nextSessionSelection,
} from './sessions.mjs';

describe('session pinning', () => {
  it('inherits defaults on a new session and pins after first request', () => {
    const first = nextSessionSelection(null, { provider: 'deepseek', model: 'deepseek-chat', effort: 'off' });
    assert.equal(first.reason, 'new');
    assert.equal(first.pin, true);
    const locked = nextSessionSelection({
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning_effort: 'off',
      selection_locked: true,
    }, { provider: 'openai', model: null });
    assert.equal(locked.provider, 'deepseek');
    assert.equal(locked.reason, 'pinned');
  });

  it('records an explicit model switch without inheriting new defaults silently', () => {
    const switched = nextSessionSelection({
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning_effort: 'off',
      selection_locked: true,
    }, { provider: 'openrouter', model: 'openai/gpt-4o', effort: 'high' });
    assert.equal(switched.changed, true);
    assert.equal(switched.reason, 'switch');
    assert.equal(switched.provider, 'openrouter');
    assert.equal(switched.model, 'openai/gpt-4o');
  });

  it('derives resumable model history from session events', () => {
    const history = deriveModelHistory([
      { type: 'user.message', payload: { content: 'Change the title' } },
      {
        type: 'tool.call',
        payload: {
          id: 'write',
          name: 'survey_apply_operations',
          args: { operations: [{ op: 'updateQuestion' }] },
        },
      },
      {
        type: 'tool.result',
        payload: {
          id: 'write',
          name: 'survey_apply_operations',
          ok: true,
          result: { draftUpdatedAt: 'v2' },
        },
      },
    ]);
    assert.deepEqual(history.map((message) => message.role), ['user', 'assistant', 'toolResult']);
    assert.equal(history[1].tool_calls[0].id, 'write');
    assert.equal(history[2].toolCallId, 'write');
  });

  it('reads durable cancellation state and caches cooperative checks', async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (url) => {
      requests += 1;
      assert.match(String(url), /ai_runs\?id=eq\.run-1/);
      return new Response(JSON.stringify([{ id: 'run-1', status: 'cancelled' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    };
    try {
      assert.equal(await isRunCancellationRequested(env, 'run-1'), true);
      let clock = 1000;
      const check = createRunCancellationCheck(env, 'run-1', {
        cacheMs: 500,
        now: () => clock,
      });
      assert.equal(await check(), true);
      clock += 100;
      assert.equal(await check(), true);
      assert.equal(requests, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('short-circuits durable cancellation checks when the request signal aborts', async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response('[]', { status: 200 });
    };
    const controller = new AbortController();
    controller.abort();
    try {
      const check = createRunCancellationCheck({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      }, 'run-1', { signal: controller.signal });
      assert.equal(await check(), true);
      assert.equal(requests, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
