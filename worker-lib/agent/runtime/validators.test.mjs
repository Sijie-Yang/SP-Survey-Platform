import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertConfigurable, assertProtocol, assertRoute } from './validators.mjs';

describe('shared route validators', () => {
  it('blocks native-auth providers', () => {
    assert.throws(() => assertConfigurable('amazon-bedrock'), /AWS|Bedrock|native/i);
  });

  it('accepts the three protocols only', () => {
    assert.doesNotThrow(() => assertProtocol('anthropic-messages'));
    assert.throws(() => assertProtocol('bedrock-converse'), /protocol/i);
  });

  it('requires a vision model for Silicon', () => {
    assert.doesNotThrow(() => assertRoute({
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      requireVision: true,
      credential: { key_hint: 'sk-***abcd' },
      requireConfigured: true,
    }));
    assert.throws(() => assertRoute({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      requireVision: true,
    }), /vision-language/);
  });

  it('requires a stored key when configured is mandatory', () => {
    assert.throws(() => assertRoute({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      requireConfigured: true,
    }), /API key/);
  });

  it('lets pi-ai clamp a stored reasoning level for the selected model', () => {
    assert.doesNotThrow(() => assertRoute({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      effort: 'medium',
    }));
  });
});
