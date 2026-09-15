import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertVisionModel, detectProvider, isProviderId, modelCapabilities } from './providers.mjs';

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
    assert.equal(modelCapabilities('deepseek', 'deepseek-vl').vision, true);
    assert.throws(() => assertVisionModel('deepseek', 'deepseek-chat'), /vision-language/);
  });
});
