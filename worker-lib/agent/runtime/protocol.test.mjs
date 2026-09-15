import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyReasoning, mergeCompat, setMaxTokens, systemRole } from './compat.mjs';
import { classifyHttpError, retryDelayMs, withRetry } from './retry.mjs';
import { assertSafeBaseUrl } from './ssrf.mjs';
import { toOpenAiTools } from './adapters.mjs';

describe('protocol compat and retry', () => {
  it('rewrites system role and token fields', () => {
    assert.equal(systemRole({ supportsDeveloperRole: true }), 'developer');
    const body = setMaxTokens({ model: 'x' }, 128, { maxTokensField: 'max_completion_tokens' });
    assert.equal(body.max_completion_tokens, 128);
  });

  it('maps reasoning effort or rejects unknown values', () => {
    const body = applyReasoning({
      body: {},
      protocol: 'openai-completions',
      effort: 'high',
      efforts: { high: 'high' },
      compat: { thinkingFormat: 'deepseek' },
    });
    assert.equal(body.reasoning_effort, 'high');
    assert.throws(() => applyReasoning({
      body: {},
      protocol: 'openai-completions',
      effort: 'ultra',
      efforts: { high: 'high' },
      compat: {},
    }), /Unsupported reasoning/);
  });

  it('classifies retryable errors and respects cancel', async () => {
    assert.equal(classifyHttpError(429), 'RATE_LIMIT');
    assert.equal(classifyHttpError(500), 'SERVER');
    assert.equal(classifyHttpError(400), 'CLIENT');
    assert.ok(retryDelayMs(1, { initialMs: 100, maxMs: 1000, jitter: 0 }) >= 100);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => withRetry(async () => {
      throw Object.assign(new Error('no'), { code: 'SERVER' });
    }, { signal: controller.signal, policy: { maxRetries: 2, initialMs: 1, maxMs: 2, jitter: 0 } }), /Cancelled/);
  });

  it('blocks private and non-https custom endpoints', () => {
    assert.throws(() => assertSafeBaseUrl('http://example.com/v1'), /HTTPS/);
    assert.throws(() => assertSafeBaseUrl('https://127.0.0.1/v1'), /not allowed/);
    assert.throws(() => assertSafeBaseUrl('https://127.0.0.2/v1'), /not allowed/);
    assert.throws(() => assertSafeBaseUrl('https://169.254.20.10/v1'), /not allowed/);
    assert.throws(() => assertSafeBaseUrl('https://[fd00::1]/v1'), /not allowed/);
    assert.throws(() => assertSafeBaseUrl('https://10.0.0.8/v1'), /Private/);
    assert.throws(() => assertSafeBaseUrl('https://100.64.0.1/v1'), /Private/);
    assert.equal(assertSafeBaseUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1');
  });

  it('converts tool defs to OpenAI function tools', () => {
    const tools = toOpenAiTools([{ name: 'survey_get_draft', description: 'draft', parameters: { type: 'object' } }]);
    assert.equal(tools[0].type, 'function');
    assert.equal(tools[0].function.name, 'survey_get_draft');
  });

  it('merges route compat then model compat', () => {
    const merged = mergeCompat({ maxTokensField: 'max_tokens' }, { maxTokensField: 'max_completion_tokens' });
    assert.equal(merged.maxTokensField, 'max_completion_tokens');
  });
});
