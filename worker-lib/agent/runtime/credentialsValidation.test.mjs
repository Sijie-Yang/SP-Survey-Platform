import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateApiKeyWithProvider } from '../credentials.mjs';

describe('catalog credential validation', () => {
  it('uses the same model route as chat for Qwen Token Plan CN', async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return new Response([
        'data: {"id":"response_1","choices":[{"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}',
        'data: {"id":"response_1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        'data: [DONE]',
        '',
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    try {
      const result = await validateApiKeyWithProvider('sk-sp-example-valid-key', {
        provider: 'qwen-token-plan-cn',
      });
      assert.equal(result.success, true);
      assert.equal(result.validated, true);
      assert.equal(result.model, 'deepseek-v3.2');
      assert.equal(
        request.url,
        'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      );
      assert.equal(request.init.headers.get('authorization'), 'Bearer sk-sp-example-valid-key');
      assert.equal(JSON.parse(request.init.body).model, 'deepseek-v3.2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not report vendor authentication failures as validated', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: 'Invalid API-key provided.' },
    }), { status: 401 });
    try {
      await assert.rejects(
        validateApiKeyWithProvider('sk-sp-example-invalid-key', {
          provider: 'qwen-token-plan-cn',
        }),
        /Invalid API-key provided/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validates Qwen DashScope with its catalog model route', async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return new Response([
        'data: {"id":"response_1","choices":[{"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}',
        'data: {"id":"response_1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        'data: [DONE]',
        '',
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    try {
      const result = await validateApiKeyWithProvider('sk-test-dashscope-key', {
        provider: 'qwen-dashscope',
      });
      assert.equal(result.success, true);
      assert.equal(result.model, 'deepseek-v3.2');
      assert.equal(
        request.url,
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      );
      assert.equal(request.init.headers.get('authorization'), 'Bearer sk-test-dashscope-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
