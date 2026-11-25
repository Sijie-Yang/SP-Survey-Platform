import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_PAYLOAD_SHA256,
  CATALOG_PROVIDERS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
  authUnsupported,
  catalogProvider,
  isProviderId,
} from './catalog.mjs';
import {
  availableModelId,
  effortOptions,
  modelAcceptsImage,
  publicCatalog,
  resolveModel,
  resolveModelRoute,
  resolveModels,
} from './registry.mjs';

describe('catalog registry', () => {
  it('exactly matches the pinned Harness provider and model inventory', () => {
    assert.equal(CATALOG_VERSION, 'harness-0.2.2-rc.5/pi-ai-1.6.1/ee2e407f473c+sp1');
    assert.equal(CATALOG_SOURCE.harnessVersion, '0.2.2-rc.5');
    assert.equal(CATALOG_SOURCE.piAiVersion, '1.6.1');
    assert.equal(CATALOG_SOURCE.providerCount, 43);
    assert.equal(CATALOG_SOURCE.modelCount, 1696);
    assert.match(CATALOG_PAYLOAD_SHA256, /^[a-f0-9]{64}$/);
    const ids = CATALOG_PROVIDERS.map((p) => p.id);
    for (const id of ['deepseek', 'openai', 'openrouter', 'anthropic', 'amazon-bedrock', 'google-vertex', 'azure', 'openai-codex']) {
      assert.equal(ids.includes(id), true, id);
    }
    assert.equal(CATALOG_SOURCE.generatedProviderCount, 44);
    assert.equal(CATALOG_SOURCE.generatedModelCount, 1717);
    assert.equal(CATALOG_PROVIDERS.length, 44);
    assert.equal(CATALOG_PROVIDERS.reduce((sum, provider) => sum + provider.models.length, 0), 1717);
    for (const provider of CATALOG_PROVIDERS) {
      assert.equal(new Set(provider.models.map((model) => model.id)).size, provider.models.length);
      for (const modelId of Object.values(provider.defaultModels)) {
        if (modelId) assert.ok(provider.models.some((model) => model.id === modelId), `${provider.id}/${modelId}`);
      }
    }
  });

  it('adds Qwen DashScope with the complete Token Plan model inventory', () => {
    const source = catalogProvider('qwen-token-plan');
    const dashScope = catalogProvider('qwen-dashscope');
    assert.deepEqual(
      dashScope.models.map((model) => model.id),
      source.models.map((model) => model.id),
    );
    assert.equal(dashScope.models.length, 21);
    assert.equal(
      dashScope.models.every((model) => model.baseUrl === 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      true,
    );
  });

  it('marks native-auth providers as AUTH_UNSUPPORTED', () => {
    const blocked = authUnsupported('amazon-bedrock');
    assert.equal(blocked.code, 'AUTH_UNSUPPORTED');
    assert.equal(authUnsupported('deepseek'), null);
  });

  it('resolves vision from catalog input, not name regex', () => {
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-flash'), true);
    assert.equal(modelAcceptsImage('deepseek', 'deepseek-v4-pro'), false);
    assert.equal(resolveModel('openai', 'gpt-5.6-sol').vision, true);
    assert.equal(resolveModel('openai', 'gpt-5.6-sol').runtimeApi, 'openai-responses');
  });

  it('routes mixed and compatibility providers per model', () => {
    const openrouter = catalogProvider('openrouter');
    const anthropicModel = openrouter.models.find((model) => model.api === 'anthropic-messages');
    const openAiModel = openrouter.models.find((model) => model.api === 'openai-completions');
    assert.equal(resolveModelRoute('openrouter', anthropicModel.id).protocol, 'anthropic-messages');
    assert.equal(resolveModelRoute('openrouter', openAiModel.id).protocol, 'openai-completions');
    const google = resolveModelRoute('google', 'gemini-3.8-flash');
    assert.equal(google.protocol, 'google-generative-ai');
    assert.equal(google.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
    assert.equal(resolveModel('google', 'gemini-3.8-flash').api, 'google-generative-ai');
  });

  it('uses pi-ai thinking-level support instead of requiring a custom map', () => {
    assert.deepEqual(
      effortOptions('qwen-token-plan-cn', 'qwen3.6-flash'),
      ['off', 'minimal', 'low', 'medium', 'high'],
    );
    assert.deepEqual(
      Object.keys(resolveModel('deepseek', 'deepseek-flash').reasoningEfforts),
      ['off', 'low', 'high', 'max'],
    );
  });

  it('inherits installed catalog models instead of stale profile snapshots', () => {
    const models = resolveModels('deepseek', {
      models: [{ id: 'deepseek-chat', name: 'Legacy snapshot' }],
    });
    assert.equal(models.length, 2);
    assert.equal(models.some((model) => model.id === 'deepseek-chat'), false);
    assert.equal(availableModelId('deepseek', 'deepseek-chat'), 'deepseek-flash');
    assert.equal(
      availableModelId('deepseek', 'deepseek-vl', { vision: true }),
      'deepseek-flash',
    );
  });

  it('exposes a public catalog without secrets', () => {
    const catalog = publicCatalog();
    assert.equal(isProviderId(catalog[0].id), true);
    assert.equal(JSON.stringify(catalog).includes('sk-'), false);
    assert.equal(catalog.find((p) => p.id === 'amazon-bedrock').configurable, false);
    assert.equal(publicCatalog({ summariesOnly: true }).every((provider) => provider.catalog.length === 0), true);
  });
});
