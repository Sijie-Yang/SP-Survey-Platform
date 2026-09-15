import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runToolLoop } from './loop.mjs';
import { createToolRegistry } from './tools.mjs';

describe('runtime tool loop', () => {
  it('returns the persisted draft without storing the full config in events', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'survey_apply_operations',
                  arguments: '{"expectedDraftUpdatedAt":"before","operations":[]}',
                },
              }],
            },
          }],
          usage: {},
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Saved.', tool_calls: [] } }],
        usage: {},
      }), { status: 200 });
    };

    const events = [];
    const registry = createToolRegistry([{
      name: 'survey_apply_operations',
      minPermission: 'edit_draft',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        surveyConfig: { title: 'Updated', pages: [] },
        draftUpdatedAt: 'after',
        applied: [],
      }),
    }]);

    try {
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Update it' }],
        registry,
        ctx: { permission: 'edit_draft' },
        onEvent: async (event) => events.push(event),
      });
      assert.deepEqual(result.latestDraft, {
        surveyConfig: { title: 'Updated', pages: [] },
        draftUpdatedAt: 'after',
      });
      const toolResult = events.find((event) => event.type === 'tool.result');
      assert.equal(toolResult.payload.result.surveyConfig, undefined);
      assert.equal(toolResult.payload.result.surveyConfigPreview.title, 'Updated');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
