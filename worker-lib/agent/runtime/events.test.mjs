import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactModelMessages,
  createEvent,
  estimateModelTokens,
  eventsToModelMessages,
  eventsToUiMessages,
  createTextBatcher,
  redactSecrets,
} from './events.mjs';

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

  it('accepts Harness-style lifecycle and compaction events', () => {
    for (const type of [
      'turn.start',
      'turn.end',
      'step.start',
      'step.end',
      'context.prune',
      'context.compact',
      'tool.outcome.unknown',
      'run.stage',
    ]) {
      assert.equal(createEvent(type).type, type);
    }
  });

  it('batches assistant text by bytes instead of emitting every token', async () => {
    const flushed = [];
    const batcher = createTextBatcher({
      flush: async (content) => flushed.push(content),
      maxWaitMs: 10_000,
      maxBytes: 8,
    });
    await batcher.push('abcd');
    assert.equal(flushed.length, 0);
    await batcher.push('efgh');
    assert.deepEqual(flushed, ['abcdefgh']);
    await batcher.push('xy');
    await batcher.flush();
    assert.deepEqual(flushed, ['abcdefgh', 'xy']);
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
      { type: 'assistant.message', payload: { content: 'Hello' } },
    ]);
    assert.equal(messages[0].id, 'event-0');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].tools[0].status, 'done');
    assert.equal(messages[1].content, 'Hello');
  });

  it('attaches generate stage and error diagnostics to UI tools', () => {
    const messages = eventsToUiMessages([
      { type: 'tool.call', payload: { id: '1', name: 'survey_apply_operations' } },
      {
        type: 'run.stage',
        payload: { stage: 'repair_config', repairAttempt: 1, repairLimit: 2 },
      },
      {
        type: 'tool.result',
        payload: {
          id: '1',
          name: 'survey_apply_operations',
          ok: false,
          stage: 'repair_config',
          summary: 'Generate rejects incremental operations',
          result: {
            code: 'GENERATE_CONTRACT',
            path: 'operations[0].op',
            receivedShape: { ops: [{ op: 'addPage' }] },
          },
        },
      },
    ]);
    assert.equal(messages[0].metadata.stage, 'repair_config');
    assert.equal(messages[0].tools[0].status, 'error');
    assert.equal(messages[0].tools[0].code, 'GENERATE_CONTRACT');
    assert.equal(messages[0].tools[0].diagnostics.path, 'operations[0].op');
  });

  it('pairs repeated same-name tools by id so earlier calls do not stay running', () => {
    const messages = eventsToUiMessages([
      { type: 'tool.call', payload: { id: 'a', name: 'survey_capabilities' } },
      { type: 'tool.call', payload: { id: 'b', name: 'survey_capabilities' } },
      { type: 'tool.result', payload: { id: 'b', name: 'survey_capabilities', ok: true, summary: 'Loaded questions' } },
      { type: 'tool.result', payload: { id: 'a', name: 'survey_capabilities', ok: true, summary: 'Loaded overview' } },
      { type: 'tool.call', payload: { id: 'c', name: 'survey_get_draft' } },
      { type: 'run.status', payload: { status: 'completed' } },
    ]);
    assert.deepEqual(messages[0].tools.map((tool) => [tool.id, tool.status]), [
      ['a', 'done'],
      ['b', 'done'],
      ['c', 'unknown'],
    ]);
  });

  it('derives exact model call/result history from append-only events', () => {
    const history = eventsToModelMessages([
      { type: 'turn.start', payload: { turnId: 't1' } },
      { type: 'user.message', payload: { content: 'Read the draft' } },
      { type: 'step.start', payload: { step: 0 } },
      { type: 'assistant.delta', payload: { content: 'Checking.' } },
      { type: 'tool.call', payload: { id: 'a', name: 'survey_get_draft', args: { projectId: 'p' } } },
      { type: 'tool.call', payload: { id: 'b', name: 'survey_validate', args: {} } },
      { type: 'tool.result', payload: { id: 'a', name: 'survey_get_draft', ok: true, result: { version: 1 } } },
      { type: 'tool.result', payload: { id: 'b', name: 'survey_validate', ok: false, result: { error: 'invalid' } } },
      { type: 'step.end', payload: { step: 0 } },
      { type: 'step.start', payload: { step: 1 } },
      { type: 'assistant.message', payload: { content: 'The draft needs repair.' } },
      { type: 'step.end', payload: { step: 1 } },
      { type: 'turn.end', payload: { turnId: 't1' } },
    ]);
    assert.deepEqual(history.map((message) => message.role), [
      'user',
      'assistant',
      'toolResult',
      'toolResult',
      'assistant',
    ]);
    assert.equal(history[1].tool_calls.length, 2);
    assert.equal(history[1].tool_calls[0].function.arguments, '{"projectId":"p"}');
    assert.equal(history[2].toolCallId, 'a');
    assert.equal(history[3].toolCallId, 'b');
    assert.equal(history[3].isError, true);
    assert.equal(history[4].content, 'The draft needs repair.');
  });

  it('synthesizes unknown results for calls interrupted before a durable result', () => {
    const history = eventsToModelMessages([
      { type: 'user.message', payload: { content: 'Save it' } },
      { type: 'tool.call', payload: { id: 'write', name: 'survey_apply_operations', args: {} } },
      { type: 'turn.end', payload: { status: 'cancelled' } },
    ]);
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[2].role, 'toolResult');
    assert.equal(history[2].toolCallId, 'write');
    assert.equal(history[2].outcome, 'unknown');
    assert.match(history[2].content[0].text, /UNKNOWN_TOOL_OUTCOME/);
  });

  it('replays durable prune and compaction replacements instead of old payloads', () => {
    const replacement = '<context_summary>Earlier verified work</context_summary>';
    const history = eventsToModelMessages([
      { type: 'user.message', payload: { content: 'Old request' } },
      { type: 'tool.call', payload: { id: 'old', name: 'survey_get_draft', args: {} } },
      {
        type: 'tool.result',
        payload: { id: 'old', name: 'survey_get_draft', ok: true, result: { large: 'payload' } },
      },
      { type: 'step.end', payload: { step: 0 } },
      { type: 'context.prune', payload: { toolCallIds: ['old'] } },
      { type: 'context.compact', payload: { replacement } },
      { type: 'assistant.message', payload: { content: 'Continuing from the summary.' } },
      { type: 'step.end', payload: { step: 1 } },
    ]);
    assert.deepEqual(history, [
      { role: 'user', content: replacement },
      { role: 'assistant', content: 'Continuing from the summary.' },
    ]);
  });

  it('prunes old tool payloads before compacting complete history groups', () => {
    const messages = [
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: `old request ${'a'.repeat(1000)}`,
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'old-call',
          type: 'function',
          function: { name: 'survey_get_draft', arguments: '{}' },
        }],
      },
      {
        role: 'toolResult',
        toolCallId: 'old-call',
        toolName: 'survey_get_draft',
        content: [{ type: 'text', text: 'x'.repeat(6000) }],
        isError: false,
      },
      { role: 'assistant', content: `old answer ${'b'.repeat(1000)}` },
      { role: 'user', content: 'recent request' },
      { role: 'assistant', content: 'recent answer' },
    ];
    const compacted = compactModelMessages(messages, {
      contextWindow: 1000,
      maxOutputTokens: 100,
      maxToolResultChars: 120,
      keepRecentMessages: 2,
    });
    assert.equal(compacted.changed, true);
    assert.equal(compacted.pruned, 1);
    assert.deepEqual(compacted.prunedToolCallIds, ['old-call']);
    assert.ok(compacted.compacted >= 3);
    assert.equal(compacted.messages[0].role, 'system');
    assert.match(compacted.messages[1].content, /<context_summary>/);
    assert.deepEqual(compacted.messages.slice(-2), [
      { role: 'user', content: 'recent request' },
      { role: 'assistant', content: 'recent answer' },
    ]);
    assert.ok(estimateModelTokens(compacted.messages) < estimateModelTokens(messages));
  });
});
