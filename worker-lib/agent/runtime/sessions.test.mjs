import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextSessionSelection } from './sessions.mjs';

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
});
