import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProviderId } from './catalog.mjs';
import { redactSecrets } from './events.mjs';
import { publicCatalog } from './registry.mjs';

describe('credential isolation', () => {
  it('never exposes secrets on the public catalog or redacted events', () => {
    const catalog = JSON.stringify(publicCatalog());
    assert.equal(/ciphertext|key_nonce|sk-[a-zA-Z0-9]{8,}/.test(catalog), false);
    assert.equal(catalog.includes('"apiKey"'), false);
    const redacted = redactSecrets({
      key_ciphertext: 'abc',
      apiKey: 'sk-abcdefghijklmnopqrst',
      provider: 'deepseek',
    });
    assert.equal(redacted.apiKey, '[redacted]');
    assert.equal(redacted.key_ciphertext, '[redacted]');
    assert.equal(isProviderId('deepseek'), true);
  });
});
