import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PROVIDERS, CATALOG_VERSION, authUnsupported, isProviderId } from './catalog.mjs';
import { modelAcceptsImage, publicCatalog, resolveModel } from './registry.mjs';

describe('catalog registry', () => {
  it('is versioned and includes the Harness provider set', () => {
    assert.match(CATALOG_VERSION, /harness-/);
    const ids = CATALOG_PROVIDERS.map((p) => p.id);
    for (const id of ['deepseek', 'openai', 'openrouter', 'anthropic', 'amazon-bedrock', 'google-vertex', 'azure-openai-responses', 'openai-codex']) {
      assert.equal(ids.includes(id), true, id);
    }
    assert.ok(CATALOG_PROVIDERS.length >= 35);
  });

  it('marks native-auth providers as AUTH_UNSUPPORTED', () => {
    const blocked = authUnsupported('amazon-bedrock');
    assert.equal(blocked.code, 'AUTH_UNSUPPORTED');
    assert.equal(authUnsupported('deepseek'), null);
  });

  it('resolves vision from catalog input, not name regex', () => {
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-vl'), true);
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-chat'), false);
    assert.equal(resolveModel('openai', 'gpt-4o').vision, true);
  });

  it('exposes a public catalog without secrets', () => {
    const catalog = publicCatalog();
    assert.equal(isProviderId(catalog[0].id), true);
    assert.equal(JSON.stringify(catalog).includes('sk-'), false);
    assert.equal(catalog.find((p) => p.id === 'amazon-bedrock').configurable, false);
  });
});
