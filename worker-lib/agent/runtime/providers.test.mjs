import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertVisionModel,
  detectProvider,
  isProviderId,
  listProviderModels,
  modelCapabilities,
} from './providers.mjs';

describe('providers', () => {
  it('detects deepseek from base URL', () => {
    assert.equal(detectProvider('sk-abc', { baseUrl: 'https://api.deepseek.com/v1' }), 'deepseek');
  });

  it('accepts Harness-style provider ids', () => {
    assert.equal(isProviderId('deepseek'), true);
    assert.equal(isProviderId('my-gateway'), true);
    assert.equal(isProviderId('MyGateway'), false);
    assert.equal(isProviderId('1bad'), false);
  });

  it('requires vision models for silicon', () => {
    assert.equal(modelCapabilities('deepseek', 'deepseek-v4-flash-vision-exp').vision, true);
    assert.throws(() => assertVisionModel('deepseek', 'deepseek-v4-pro'), /vision-language/);
  });

  it('serves installed catalogs without interrogating provider endpoints', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('catalog lookup must not fetch');
    };
    try {
      const result = await listProviderModels('', 'openrouter');
      assert.equal(result.success, true);
      assert.equal(result.fetched, false);
      assert.equal(result.models.length, 366);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
