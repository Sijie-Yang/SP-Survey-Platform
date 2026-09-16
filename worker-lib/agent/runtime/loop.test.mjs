import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyToolExecution,
  forcedToolChoice,
  isLengthStopReason,
  nextRequiredTool,
  normalizeToolCalls,
  repairFamilyKey,
  runToolLoop,
  shouldBlockIncompleteArgs,
  shouldBlockWrite,
  toolRequestPolicy,
} from './loop.mjs';
import { applyAssistantModeToTools, getAssistantModePolicy } from './modes.mjs';
import { requestsDraftChange } from './designerChat.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { resolveModelRoute } from './registry.mjs';
import { createToolRegistry } from './tools.mjs';

function sseToolCalls(calls) {
  return new Response([
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: calls.map((call, index) => ({
            index,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
          })),
        },
        finish_reason: 'tool_calls',
      }],
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function sseText(content) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('runtime tool loop', () => {
  it('describes supported survey operations to tool-calling models', () => {
    const apply = createDesignerTools({}).find((tool) => tool.name === 'survey_apply_operations');
    const items = apply.parameters.properties.operations.items;
    const enums = items.oneOf
      ? items.oneOf.flatMap((item) => item.properties?.op?.enum || [])
      : (items.properties?.op?.enum || []);
    assert.equal(enums.includes('replaceConfig'), true);
    assert.match(apply.description, /complete redesign/);
  });

  it('maps forced save-sequence tools to each web protocol', () => {
    assert.deepEqual(forcedToolChoice('openai-completions', 'survey_get_draft'), {
      type: 'function',
      function: { name: 'survey_get_draft' },
    });
    assert.deepEqual(forcedToolChoice('openai-responses', 'survey_get_draft'), {
      type: 'function',
      name: 'survey_get_draft',
    });
    assert.deepEqual(forcedToolChoice('anthropic-messages', 'survey_get_draft'), {
      type: 'tool',
      name: 'survey_get_draft',
    });
    assert.equal(forcedToolChoice('google-generative-ai', 'survey_get_draft'), 'any');
  });

  it('avoids unsupported forced tool_choice in Qwen thinking mode', () => {
    const tools = [
      { type: 'function', function: { name: 'survey_capabilities' } },
      { type: 'function', function: { name: 'survey_get_draft' } },
    ];
    const policy = toolRequestPolicy({
      protocol: 'openai-completions',
      requiredTool: 'survey_get_draft',
      tools,
      compat: { thinkingFormat: 'qwen' },
      effort: 'high',
    });
    assert.equal(policy.toolChoice, undefined);
    assert.deepEqual(
      policy.tools.map((tool) => tool.function.name),
      ['survey_get_draft'],
    );
    assert.deepEqual(toolRequestPolicy({
      protocol: 'openai-completions',
      requiredTool: 'survey_get_draft',
      tools,
      compat: { thinkingFormat: 'qwen' },
      effort: 'off',
    }).toolChoice, {
      type: 'function',
      function: { name: 'survey_get_draft' },
    });
  });

  it('honors registry execution metadata and explicit concurrency overrides', () => {
    const registry = createToolRegistry([{
      name: 'custom_inspection',
      minPermission: 'ask',
      executionMode: 'exclusive',
      execute: async () => ({}),
    }]);
    assert.equal(classifyToolExecution('custom_inspection', registry), 'exclusive');
    assert.equal(classifyToolExecution('custom_inspection', registry, {
      custom_inspection: 'parallel',
    }), 'parallel');
  });

  it('recognizes direct survey edit requests without treating how-to questions as edits', () => {
    assert.equal(requestsDraftChange('Please design a survey about parks'), true);
    assert.equal(requestsDraftChange('Make me a survey about parks'), true);
    assert.equal(requestsDraftChange('帮我设计一个街景调查问卷'), true);
    assert.equal(requestsDraftChange('帮我做一个关于公园的问卷'), true);
    assert.equal(requestsDraftChange('How should I design a survey?'), false);
    assert.equal(requestsDraftChange('如何设计一个问卷？'), false);
  });

  it('returns the persisted draft without storing the full config in events', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    const requestBodies = [];
    globalThis.fetch = async (_url, init) => {
      call += 1;
      requestBodies.push(JSON.parse(init.body));
      if (call === 1) {
        return new Response([
          'data: {"id":"response_1","choices":[{"delta":{"role":"assistant","reasoning_content":"checked the draft","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"survey_apply_operations","arguments":"{\\"expectedDraftUpdatedAt\\":\\"before\\",\\"operations\\":[]}"}}]},"finish_reason":null}]}',
          'data: {"id":"response_1","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
          'data: [DONE]',
          '',
        ].join('\n\n'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response([
        'data: {"id":"response_2","choices":[{"delta":{"role":"assistant","content":"Saved."},"finish_reason":null}]}',
        'data: {"id":"response_2","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        'data: [DONE]',
        '',
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
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
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
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
      const replayedAssistant = requestBodies[1].messages.find((message) => message.role === 'assistant');
      assert.equal(replayedAssistant.reasoning_content, 'checked the draft');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('nudges a model that only describes a requested survey edit', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies = [];
    let call = 0;
    globalThis.fetch = async (_url, init) => {
      call += 1;
      requestBodies.push(JSON.parse(init.body));
      const payload = call === 1
        ? 'data: {"choices":[{"delta":{"content":"I can design that."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        : call === 2
          ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"survey_apply_operations","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
          : 'data: {"choices":[{"delta":{"content":"Saved."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const registry = createToolRegistry([{
      name: 'survey_apply_operations',
      minPermission: 'edit_draft',
      execute: async () => ({
        surveyConfig: { title: 'Created', pages: [] },
        draftUpdatedAt: 'after',
        applied: [],
      }),
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Design it' }],
        registry,
        ctx: { permission: 'edit_draft' },
        requireDraftChange: true,
      });
      assert.equal(requestBodies[0].tool_choice.function.name, 'survey_capabilities');
      assert.equal(requestBodies[1].messages.at(-1).content.includes('survey_apply_operations'), true);
      assert.equal(result.latestDraft.surveyConfig.title, 'Created');
      assert.equal(result.content, 'Saved.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('re-reads the draft and retries a failed survey write', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies = [];
    let call = 0;
    globalThis.fetch = async (_url, init) => {
      call += 1;
      requestBodies.push(JSON.parse(init.body));
      const payloads = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"apply_1","type":"function","function":{"name":"survey_apply_operations","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"The save failed."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read_1","type":"function","function":{"name":"survey_get_draft","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"apply_2","type":"function","function":{"name":"survey_apply_operations","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"Saved after retry."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ];
      return new Response(payloads[call - 1], {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    let applyCount = 0;
    const registry = createToolRegistry([
      {
        name: 'survey_get_draft',
        execute: async () => ({
          surveyConfig: { title: 'Existing', pages: [] },
          draftUpdatedAt: 'fresh',
        }),
      },
      {
        name: 'survey_apply_operations',
        minPermission: 'edit_draft',
        execute: async () => {
          applyCount += 1;
          if (applyCount === 1) throw new Error('Draft changed; use the latest draftUpdatedAt');
          return {
            surveyConfig: { title: 'Retried', pages: [] },
            draftUpdatedAt: 'after',
            applied: [],
          };
        },
      },
    ]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Redesign it' }],
        registry,
        ctx: { permission: 'edit_draft' },
        requireDraftChange: true,
      });
      assert.match(requestBodies[2].messages.at(-1).content, /latest draftUpdatedAt/);
      assert.equal(result.latestDraft.surveyConfig.title, 'Retried');
      assert.equal(result.attemptedDraftWrite, true);
      assert.equal(result.lastDraftWriteError, '');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not report survey_get_draft as a persisted change', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      const payload = call === 1
        ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"survey_get_draft","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
        : 'data: {"choices":[{"delta":{"content":"Loaded."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const registry = createToolRegistry([{
      name: 'survey_get_draft',
      execute: async () => ({
        surveyConfig: { title: 'Existing', pages: [] },
        draftUpdatedAt: 'before',
      }),
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Read it' }],
        registry,
        ctx: { permission: 'ask' },
      });
      assert.equal(result.latestDraft, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits balanced turn and step lifecycle events', async () => {
    const originalFetch = globalThis.fetch;
    let request = 0;
    globalThis.fetch = async () => {
      request += 1;
      return request === 1
        ? sseToolCalls([{ id: 'read_1', name: 'survey_get_draft' }])
        : sseText('Loaded.');
    };
    const events = [];
    const registry = createToolRegistry([{
      name: 'survey_get_draft',
      minPermission: 'ask',
      execute: async () => ({ draftUpdatedAt: 'v1' }),
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Read it' }],
        registry,
        ctx: { permission: 'ask' },
        onEvent: async (event) => events.push(event),
      });
      assert.deepEqual(
        events.filter((event) => event.type === 'turn.start' || event.type === 'turn.end').map((event) => event.type),
        ['turn.start', 'turn.end'],
      );
      assert.equal(events.filter((event) => event.type === 'step.start').length, 2);
      assert.equal(events.filter((event) => event.type === 'step.end').length, 2);
      assert.equal(events.find((event) => event.type === 'tool.call').payload.id, 'read_1');
      assert.equal(events.find((event) => event.type === 'tool.result').payload.id, 'read_1');
      assert.equal(events.at(-1).payload.status, 'completed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runs read-only tools in parallel and mutation tools behind exclusive barriers', async () => {
    const originalFetch = globalThis.fetch;
    let request = 0;
    globalThis.fetch = async () => {
      request += 1;
      return request === 1
        ? sseToolCalls([
          { id: 'a', name: 'survey_get_alpha' },
          { id: 'b', name: 'survey_get_beta' },
          { id: 'write', name: 'survey_apply_operations' },
          { id: 'c', name: 'survey_get_gamma' },
        ])
        : sseText('Done.');
    };
    const order = [];
    const delayedRead = (name) => ({
      name,
      minPermission: 'ask',
      execute: async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`${name}:end`);
        return { name };
      },
    });
    const registry = createToolRegistry([
      delayedRead('survey_get_alpha'),
      delayedRead('survey_get_beta'),
      {
        name: 'survey_apply_operations',
        minPermission: 'edit_draft',
        execute: async () => {
          order.push('write:start');
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('write:end');
          return { applied: [] };
        },
      },
      delayedRead('survey_get_gamma'),
    ]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Inspect and update' }],
        registry,
        ctx: { permission: 'edit_draft' },
      });
      assert.deepEqual(order.slice(0, 2).sort(), ['survey_get_alpha:start', 'survey_get_beta:start']);
      assert.ok(order.indexOf('write:start') > order.indexOf('survey_get_alpha:end'));
      assert.ok(order.indexOf('write:start') > order.indexOf('survey_get_beta:end'));
      assert.ok(order.indexOf('survey_get_gamma:start') > order.indexOf('write:end'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks dispatched mutation outcomes unknown and later calls not-run on cancellation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseToolCalls([
      { id: 'write', name: 'survey_apply_operations' },
      { id: 'read', name: 'survey_get_draft' },
    ]);
    const controller = new AbortController();
    const events = [];
    const registry = createToolRegistry([
      {
        name: 'survey_apply_operations',
        minPermission: 'edit_draft',
        execute: async (_args, { signal }) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(
            Object.assign(new Error('aborted'), { name: 'AbortError' }),
          ), { once: true });
          setTimeout(() => resolve({ applied: [] }), 100);
        }),
      },
      {
        name: 'survey_get_draft',
        minPermission: 'ask',
        execute: async () => ({ draftUpdatedAt: 'v1' }),
      },
    ]);
    setTimeout(() => controller.abort(), 10);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await assert.rejects(runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Update it' }],
        registry,
        ctx: { permission: 'edit_draft' },
        signal: controller.signal,
        onEvent: async (event) => events.push(event),
      }), (error) => error.code === 'CANCELLED');
      const outcomes = events.filter((event) => event.type === 'tool.result').map((event) => event.payload);
      assert.equal(outcomes.find((outcome) => outcome.id === 'write').outcome, 'unknown');
      assert.equal(outcomes.find((outcome) => outcome.id === 'write').retrySafe, false);
      assert.equal(outcomes.find((outcome) => outcome.id === 'read').outcome, 'not_run');
      assert.equal(outcomes.find((outcome) => outcome.id === 'read').result.code, 'ABORTED_BEFORE_DISPATCH');
      assert.equal(events.filter((event) => event.type === 'turn.end').at(-1).payload.status, 'cancelled');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks dependent calls after an uncertain mutation without cancelling the turn', async () => {
    const originalFetch = globalThis.fetch;
    let request = 0;
    const requestBodies = [];
    globalThis.fetch = async (_url, init) => {
      request += 1;
      requestBodies.push(JSON.parse(init.body));
      return request === 1
        ? sseToolCalls([
          { id: 'write', name: 'survey_apply_operations' },
          { id: 'read', name: 'survey_get_draft' },
        ])
        : sseText('I will verify before retrying.');
    };
    let reads = 0;
    const events = [];
    const registry = createToolRegistry([
      {
        name: 'survey_apply_operations',
        minPermission: 'edit_draft',
        execute: async () => {
          throw Object.assign(new Error('upstream timed out'), { code: 'ETIMEDOUT' });
        },
      },
      {
        name: 'survey_get_draft',
        minPermission: 'ask',
        execute: async () => {
          reads += 1;
          return { draftUpdatedAt: 'v1' };
        },
      },
    ]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Update it' }],
        registry,
        ctx: { permission: 'edit_draft' },
        onEvent: async (event) => events.push(event),
      });
      assert.equal(result.content, 'I will verify before retrying.');
      assert.equal(reads, 0);
      const outcomes = events.filter((event) => event.type === 'tool.result').map((event) => event.payload);
      assert.equal(outcomes.find((outcome) => outcome.id === 'write').outcome, 'unknown');
      assert.equal(outcomes.find((outcome) => outcome.id === 'read').result.code, 'BLOCKED_BY_UNKNOWN_OUTCOME');
      const replayedResults = requestBodies[1].messages.filter((message) => message.role === 'tool');
      assert.equal(replayedResults.length, 2);
      assert.match(replayedResults[0].content, /UNKNOWN_TOOL_OUTCOME/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stops repeated identical tool steps that make no progress', async () => {
    const originalFetch = globalThis.fetch;
    let request = 0;
    globalThis.fetch = async () => {
      request += 1;
      return sseToolCalls([{ id: `read_${request}`, name: 'survey_get_draft', args: { same: true } }]);
    };
    let executions = 0;
    const events = [];
    const registry = createToolRegistry([{
      name: 'survey_get_draft',
      minPermission: 'ask',
      execute: async () => {
        executions += 1;
        return { draftUpdatedAt: 'unchanged' };
      },
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await assert.rejects(runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Keep reading' }],
        registry,
        ctx: { permission: 'ask' },
        stagnationLimit: 3,
        onEvent: async (event) => events.push(event),
      }), (error) => error.code === 'AGENT_STAGNATED');
      assert.equal(executions, 3);
      assert.equal(
        events.filter((event) => event.type === 'step.end').at(-1).payload.status,
        'stagnated',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('checks cooperative cancellation before issuing a model request', async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return sseText('Unexpected');
    };
    const events = [];
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await assert.rejects(runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Stop' }],
        registry: createToolRegistry([]),
        ctx: { permission: 'ask' },
        checkCancelled: async () => true,
        onEvent: async (event) => events.push(event),
      }), (error) => error.code === 'CANCELLED');
      assert.equal(fetched, false);
      assert.equal(events.at(-1).type, 'turn.end');
      assert.equal(events.at(-1).payload.status, 'cancelled');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits context pruning and compaction under model-window pressure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseText('Condensed.');
    const events = [];
    const oldToolResult = {
      role: 'toolResult',
      toolCallId: 'old',
      toolName: 'survey_get_draft',
      content: [{ type: 'text', text: 'x'.repeat(5000) }],
      isError: false,
    };
    const history = [{ role: 'system', content: 'system' }];
    for (let index = 0; index < 10; index += 1) {
      history.push({ role: 'user', content: `old request ${index} ${'a'.repeat(500)}` });
      history.push({ role: 'assistant', content: `old answer ${index} ${'b'.repeat(500)}` });
    }
    history.splice(3, 0, oldToolResult);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: { ...route.model, contextWindow: 1800 },
        protocol: route.protocol,
        compat: route.model.compat,
        maxTokens: 100,
        messages: history,
        registry: createToolRegistry([]),
        ctx: { permission: 'ask' },
        contextOptions: { maxToolResultChars: 200, keepRecentMessages: 4 },
        onEvent: async (event) => events.push(event),
      });
      assert.ok(events.some((event) => event.type === 'context.prune'));
      assert.ok(events.some((event) => event.type === 'context.compact'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('checkpoints a turn and resumes without replaying completed steps', async () => {
    const originalFetch = globalThis.fetch;
    let modelCalls = 0;
    globalThis.fetch = async () => {
      modelCalls += 1;
      return modelCalls === 1
        ? sseToolCalls([{ id: 'read-1', name: 'survey_get_draft', args: {} }])
        : sseText('Resumed and done.');
    };
    let toolCalls = 0;
    const events = [];
    const registry = createToolRegistry([{
      name: 'survey_get_draft',
      minPermission: 'ask',
      executionMode: 'parallel',
      execute: async () => {
        toolCalls += 1;
        return { draftUpdatedAt: 'v1', surveyConfig: { pages: [] } };
      },
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const common = {
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        registry,
        ctx: { permission: 'ask' },
        onEvent: async (event) => events.push(event),
      };
      const first = await runToolLoop({
        ...common,
        messages: [{ role: 'user', content: 'Inspect it' }],
        stepBudget: 1,
      });
      assert.equal(first.continuation, true);
      const second = await runToolLoop({ ...common, checkpoint: first.checkpoint, stepBudget: 1 });
      assert.equal(second.content, 'Resumed and done.');
      assert.equal(toolCalls, 1);
      assert.equal(events.filter((event) => event.type === 'turn.start').length, 1);
      assert.equal(events.filter((event) => event.type === 'turn.end').length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('pauses risky tools for approval and resumes the exact tool call', async () => {
    const originalFetch = globalThis.fetch;
    let modelCalls = 0;
    globalThis.fetch = async () => {
      modelCalls += 1;
      return modelCalls === 1
        ? sseToolCalls([{ id: 'publish-1', name: 'survey_publish', args: { confirm: true } }])
        : sseText('Published.');
    };
    let published = 0;
    const events = [];
    const registry = createToolRegistry([{
      name: 'survey_publish',
      minPermission: 'edit_draft',
      executionMode: 'exclusive',
      risk: 'publish',
      execute: async () => {
        published += 1;
        return { publishedVersion: 2 };
      },
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const common = {
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        registry,
        onEvent: async (event) => events.push(event),
      };
      const first = await runToolLoop({
        ...common,
        messages: [{ role: 'user', content: 'Publish' }],
        ctx: {
          permission: 'edit_draft',
          toolCallId: 'publish-1',
          approvalGate: async () => {
            throw Object.assign(new Error('Approval required'), { code: 'APPROVAL_REQUIRED' });
          },
        },
      });
      assert.equal(first.awaitingApproval, true);
      assert.equal(published, 0);
      const checkpoint = {
        ...first.checkpoint,
        approvedToolCalls: ['publish-1'],
      };
      const second = await runToolLoop({
        ...common,
        checkpoint,
        ctx: {
          permission: 'edit_draft',
          approvedToolCalls: new Set(['publish-1']),
          approvalGate: async () => assert.fail('approved call must not ask again'),
        },
      });
      assert.equal(second.content, 'Published.');
      assert.equal(published, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not start an approved exclusive write after cancellation', async () => {
    let published = 0;
    const registry = createToolRegistry([{
      name: 'survey_publish',
      minPermission: 'edit_draft',
      executionMode: 'exclusive',
      risk: 'publish',
      execute: async () => {
        published += 1;
        return { publishedVersion: 2 };
      },
    }]);
    const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
    await assert.rejects(runToolLoop({
      apiKey: 'test-key',
      provider: 'deepseek',
      baseUrl: route.baseUrl,
      model: route.model.id,
      modelRecord: route.model,
      protocol: route.protocol,
      compat: route.model.compat,
      registry,
      checkpoint: {
        pendingToolCall: { id: 'publish-1', name: 'survey_publish', args: { confirm: true } },
        approvedToolCalls: ['publish-1'],
        working: [{ role: 'user', content: 'Publish' }],
      },
      ctx: { permission: 'edit_draft', approvedToolCalls: new Set(['publish-1']) },
      checkCancelled: async () => true,
    }), (error) => error.code === 'CANCELLED');
    assert.equal(published, 0);
  });

  it('replays a succeeded exclusive tool instead of executing it again', async () => {
    let published = 0;
    const registry = createToolRegistry([{
      name: 'survey_publish',
      minPermission: 'edit_draft',
      executionMode: 'exclusive',
      risk: 'publish',
      execute: async () => {
        published += 1;
        return { publishedVersion: 9 };
      },
    }]);
    const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseText('Already published.');
    try {
      const result = await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        registry,
        checkpoint: {
          pendingToolCall: { id: 'publish-1', name: 'survey_publish', args: { confirm: true } },
          approvedToolCalls: ['publish-1'],
          working: [{ role: 'user', content: 'Publish' }],
        },
        ctx: {
          permission: 'edit_draft',
          approvedToolCalls: new Set(['publish-1']),
          lookupToolExecution: async () => ({ status: 'succeeded', result: { publishedVersion: 2 } }),
        },
      });
      assert.equal(published, 0);
      assert.equal(result.content, 'Already published.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not force apply immediately after one capabilities read', () => {
    assert.equal(nextRequiredTool({
      requireDraftChange: true,
      latestDraft: null,
      loadedCapabilities: true,
      loadedDraft: true,
      lastRetryAction: '',
    }), '');
    assert.equal(nextRequiredTool({
      requireDraftChange: true,
      latestDraft: null,
      loadedCapabilities: true,
      loadedDraft: true,
      lastRetryAction: 'repair_args',
    }), 'survey_apply_operations');
    assert.equal(nextRequiredTool({
      requireDraftChange: true,
      latestDraft: null,
      loadedCapabilities: true,
      loadedDraft: true,
      lastRetryAction: 'reload_draft',
    }), 'survey_get_draft');
  });

  it('stops repeating generate contract errors before max steps', async () => {
    const originalFetch = globalThis.fetch;
    let modelCalls = 0;
    let saves = 0;
    globalThis.fetch = async () => {
      modelCalls += 1;
      return sseToolCalls([{
        id: `apply_${modelCalls}`,
        name: 'survey_apply_operations',
        args: { expectedDraftUpdatedAt: 't', operations: [{ op: 'addPage', page: { name: 'p1' } }] },
      }]);
    };
    const registry = createToolRegistry(applyAssistantModeToTools([
      { name: 'survey_capabilities', execute: async () => ({ summary: 'ok' }) },
      { name: 'survey_get_draft', execute: async () => ({ draftUpdatedAt: 't', surveyConfig: { pages: [] } }) },
      {
        name: 'survey_apply_operations',
        minPermission: 'edit_draft',
        execute: async () => {
          saves += 1;
          return { surveyConfig: { pages: [] } };
        },
      },
    ], getAssistantModePolicy('generate')));
    const events = [];
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await assert.rejects(
        () => runToolLoop({
          apiKey: 'test-key',
          provider: 'deepseek',
          baseUrl: route.baseUrl,
          model: route.model.id,
          modelRecord: route.model,
          protocol: route.protocol,
          compat: route.model.compat,
          messages: [{ role: 'user', content: '重新生成一个至少 8 页的问卷' }],
          registry,
          ctx: { permission: 'edit_draft' },
          requireDraftChange: true,
          onEvent: async (event) => events.push(event),
        }),
        (error) => error.code === 'GENERATE_REPAIR_EXHAUSTED',
      );
      assert.equal(saves, 0);
      assert.ok(modelCalls < 16);
      assert.equal(events.some((event) => (
        event.type === 'turn.end' && event.payload.status === 'completed'
      )), false);
      assert.equal(events.some((event) => (
        event.type === 'turn.end' && event.payload.status === 'failed'
      )), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps repair family counts across checkpoint resume', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseToolCalls([{
      id: 'apply_resume',
      name: 'survey_apply_operations',
      args: { expectedDraftUpdatedAt: 't', operations: [{ op: 'addPage', page: { name: 'p1' } }] },
    }]);
    const registry = createToolRegistry(applyAssistantModeToTools([{
      name: 'survey_apply_operations',
      minPermission: 'edit_draft',
      execute: async () => ({ surveyConfig: { pages: [] } }),
    }], getAssistantModePolicy('generate')));
    const family = repairFamilyKey('survey_apply_operations', {
      code: 'GENERATE_CONTRACT',
      path: 'operations[0].op',
    });
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await assert.rejects(
        () => runToolLoop({
          apiKey: 'test-key',
          provider: 'deepseek',
          baseUrl: route.baseUrl,
          model: route.model.id,
          modelRecord: route.model,
          protocol: route.protocol,
          compat: route.model.compat,
          messages: [{ role: 'user', content: 'Generate' }],
          registry,
          ctx: { permission: 'edit_draft' },
          requireDraftChange: true,
          checkpoint: {
            step: 4,
            loadedCapabilities: true,
            loadedDraft: true,
            repairFamilies: { [family]: 3 },
            working: [{ role: 'user', content: 'Generate' }],
          },
        }),
        (error) => error.code === 'GENERATE_REPAIR_EXHAUSTED',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not execute apply when output is truncated or JSON is incomplete', async () => {
    const originalFetch = globalThis.fetch;
    let saves = 0;
    let modelCalls = 0;
    globalThis.fetch = async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return sseToolCalls([{
          id: 'apply_trunc',
          name: 'survey_apply_operations',
          args: {
            expectedDraftUpdatedAt: 't',
            operations: [{
              op: 'replaceConfig',
              surveyConfig: { title: 'Partial', pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'q1' }] }] },
            }],
          },
        }]);
      }
      return sseText('Stopped without saving.');
    };
    const registry = createToolRegistry([{
      name: 'survey_apply_operations',
      minPermission: 'edit_draft',
      execute: async () => {
        saves += 1;
        return { surveyConfig: { pages: [] } };
      },
    }]);
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      const calls = normalizeToolCalls([{
        id: 'apply_trunc',
        function: {
          name: 'survey_apply_operations',
          arguments: JSON.stringify({
            expectedDraftUpdatedAt: 't',
            operations: [{ op: 'replaceConfig', surveyConfig: { pages: [{ name: 'p1' }] } }],
          }),
        },
      }], 0, 'length');
      assert.equal(isLengthStopReason('length'), true);
      assert.equal(shouldBlockWrite(calls[0]), true);

      const incomplete = normalizeToolCalls([{
        id: 'bad',
        function: { name: 'survey_apply_operations', arguments: '{"operations":[' },
      }], 0);
      assert.equal(incomplete[0].argsComplete, false);
      assert.equal(shouldBlockWrite(incomplete[0]), true);
      const incompleteValidate = normalizeToolCalls([{
        id: 'validate_bad',
        function: { name: 'survey_validate', arguments: '{"surveyConfig":{' },
      }], 0);
      assert.equal(shouldBlockIncompleteArgs(incompleteValidate[0]), true);
      assert.equal(shouldBlockWrite(incompleteValidate[0]), false);

      await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Generate' }],
        registry,
        ctx: { permission: 'edit_draft' },
        stopReasonOverride: 'length',
      });
      assert.equal(saves, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks later writes in the same model response after a failed apply', async () => {
    const originalFetch = globalThis.fetch;
    let saves = 0;
    globalThis.fetch = async () => sseToolCalls([
      {
        id: 'apply_a',
        name: 'survey_apply_operations',
        args: { expectedDraftUpdatedAt: 't', operations: [{ op: 'addPage', page: { name: 'p1' } }] },
      },
      {
        id: 'apply_b',
        name: 'survey_apply_operations',
        args: { expectedDraftUpdatedAt: 't', operations: [{ op: 'replaceConfig', surveyConfig: { pages: [] } }] },
      },
    ]);
    const registry = createToolRegistry(applyAssistantModeToTools([{
      name: 'survey_apply_operations',
      minPermission: 'edit_draft',
      execute: async () => {
        saves += 1;
        return { surveyConfig: { pages: [] } };
      },
    }], getAssistantModePolicy('generate')));
    const events = [];
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
      await runToolLoop({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Generate' }],
        registry,
        ctx: { permission: 'edit_draft' },
        onEvent: async (event) => events.push(event),
      }).catch(() => null);
      assert.equal(saves, 0);
      assert.equal(events.some((event) => event.payload?.result?.code === 'BLOCKED_BY_REPAIR'
        || event.payload?.code === 'BLOCKED_BY_REPAIR'), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
