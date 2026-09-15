import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, eventsToUiMessages, redactSecrets } from './events.mjs';

describe('runtime events', () => {
  it('rejects unknown types', () => {
    assert.throws(() => createEvent('shell.exec'), /Unknown/);
  });

  it('records model selection and retry events', () => {
    const selection = createEvent('model.selection', { provider: 'deepseek', model: 'deepseek-chat' });
    const retry = createEvent('llm.retry', { attempt: 1, code: 'RATE_LIMIT' });
    assert.equal(selection.type, 'model.selection');
    assert.equal(retry.payload.code, 'RATE_LIMIT');
  });

  it('redacts keys', () => {
    const out = redactSecrets({ apiKey: 'sk-abc', nested: { token: 'x' }, text: 'use sk-abcdefghijklmnopqrst' });
    assert.equal(out.apiKey, '[redacted]');
    assert.equal(out.nested.token, '[redacted]');
    assert.match(out.text, /sk-\*\*\*/);
  });

  it('projects events to UI messages', () => {
    const messages = eventsToUiMessages([
      { type: 'user.message', payload: { content: 'hi' } },
      { type: 'tool.call', payload: { id: '1', name: 'survey_get_draft' } },
      { type: 'tool.result', payload: { id: '1', name: 'survey_get_draft', ok: true, summary: 'ok' } },
      { type: 'assistant.delta', payload: { content: 'Hello' } },
    ]);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].tools[0].status, 'done');
    assert.match(messages[1].content, /Hello/);
  });
});
