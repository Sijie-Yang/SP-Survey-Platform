import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySubmitDraftError } from './applySchema.mjs';
import { chatCompletions } from './providers.mjs';
import { compactJsonForModel, createRawToolArgCollector, parseRawToolArguments } from './toolArgs.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { createToolRegistry } from './tools.mjs';
import { parseGenerateGoals } from './generateGoals.mjs';
import { resolveModelRoute } from './registry.mjs';
import { runToolLoop } from './loop.mjs';

function sseRaw({
  name = 'survey_submit_generated_draft',
  id = 'call_1',
  arguments: args,
  finish_reason = 'tool_calls',
} = {}) {
  return new Response([
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id,
            type: 'function',
            function: { name, arguments: args },
          }],
        },
        finish_reason,
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

function eightPageConfig() {
  const types = ['rating', 'boolean', 'text', 'number', 'comment', 'radiogroup', 'checkbox', 'ranking'];
  return {
    title: 'Coverage study',
    pages: types.map((type, index) => ({
      name: `page_${index + 1}`,
      elements: [{ type, name: `q_${index + 1}`, title: `${type} ${index + 1}` }],
    })),
  };
}

function writeRegistry({ onSave } = {}) {
  const saves = [];
  const registry = createToolRegistry([
    {
      name: 'survey_capabilities',
      minPermission: 'ask',
      execute: async () => ({
        summary: 'Loaded overview capabilities',
        generateApply: {
          tool: 'survey_submit_generated_draft',
          required: ['expectedDraftUpdatedAt', 'surveyConfig'],
        },
      }),
    },
    {
      name: 'survey_get_draft',
      minPermission: 'ask',
      execute: async () => ({
        summary: 'Draft loaded',
        draftUpdatedAt: 'rev-1',
        surveyConfig: { title: 'Empty', pages: [] },
      }),
    },
    {
      name: 'survey_submit_generated_draft',
      minPermission: 'edit_draft',
      execute: async (args) => {
        const contractError = classifySubmitDraftError(args);
        if (contractError) {
          const error = Object.assign(new Error(contractError.message), contractError);
          throw error;
        }
        const wrapped = {
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          operations: [{ op: 'replaceConfig', surveyConfig: args.surveyConfig }],
        };
        saves.push(wrapped);
        onSave?.(wrapped);
        return {
          summary: 'Applied 1 operation(s) and saved',
          draftUpdatedAt: 'rev-2',
          applied: [{ op: 'replaceConfig' }],
          surveyConfig: args.surveyConfig,
          pageCount: args.surveyConfig.pages.length,
          questionCount: args.surveyConfig.pages.reduce((count, page) => count + (page.elements || []).length, 0),
        };
      },
    },
  ]);
  return { registry, saves };
}

async function runGenerate(fetchImpl, extras = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const { registry, saves } = writeRegistry();
  const events = [];
  const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
  try {
    const result = await runToolLoop({
      apiKey: 'test-key',
      provider: route.provider?.id || 'qwen-dashscope',
      baseUrl: route.baseUrl,
      model: route.model.id,
      modelRecord: route.model,
      protocol: route.protocol,
      compat: route.model.compat,
      messages: [{ role: 'user', content: '重新生成一个至少 8 页、覆盖多数题型的问卷' }],
      registry,
      ctx: { permission: 'edit_draft' },
      requireDraftChange: true,
      writeTools: ['survey_submit_generated_draft'],
      onEvent: async (event) => events.push(event),
      ...extras,
    }).catch((error) => ({ error }));
    return { result, saves, events, route };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('generate raw argument pipeline', () => {
  it('collects interleaved deltas and late ids without mixing buffers', () => {
    const collector = createRawToolArgCollector();
    collector.onEvent({ type: 'toolcall_delta', contentIndex: 0, delta: '{"title":"' });
    collector.onEvent({ type: 'toolcall_delta', contentIndex: 1, delta: '{"ok":' });
    collector.onEvent({
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: '公园"}',
      partial: { content: [{ type: 'toolCall', id: 'late-a', name: 'survey_submit_generated_draft' }] },
    });
    collector.onEvent({
      type: 'toolcall_delta',
      contentIndex: 1,
      delta: 'true}',
      id: 'late-b',
    });
    assert.equal(collector.lookup({ id: 'late-a' }, 0).raw, '{"title":"公园"}');
    assert.equal(collector.lookup({ id: 'late-b' }, 1).raw, '{"ok":true}');
    collector.reset();
    assert.equal(collector.snapshot().length, 0);
  });

  it('keeps escaped chinese fragments as one raw JSON string', () => {
    const parsed = parseRawToolArguments('{"title":"\\u516c\\u56ed","pages":[{"name":"p1","elements":[{"type":"rating","name":"q1"}]}]}');
    assert.equal(parsed.rawArgsComplete, true);
    assert.equal(parsed.args.title, '公园');
  });

  it('distinguishes complete but wrong submit shapes', () => {
    const cases = [
      [{}, 'expectedDraftUpdatedAt'],
      [{ expectedDraftUpdatedAt: 'x' }, 'surveyConfig'],
      [{ expectedDraftUpdatedAt: 'x', surveyConfig: 'nope' }, 'surveyConfig'],
      [{ expectedDraftUpdatedAt: 'x', surveyConfig: { pages: [] } }, 'surveyConfig.pages'],
      [{ expectedDraftUpdatedAt: 'x', operations: [{ op: 'replaceConfig' }] }, 'surveyConfig'],
    ];
    const codes = cases.map(([args, path]) => {
      const error = classifySubmitDraftError(args);
      assert.equal(error.code, 'GENERATE_CONTRACT');
      assert.equal(error.path, path);
      return `${error.path}:${error.receivedShape.operationsType}:${error.receivedShape.surveyConfigType}`;
    });
    assert.equal(new Set(codes).size, codes.length);
  });

  it('identifies raw invalid JSON as parse failure and does not save', async () => {
    const { result, saves, events } = await runGenerate(async () => sseRaw({
      arguments: 'not JSON',
      finish_reason: 'tool_calls',
    }));
    assert.equal(saves.length, 0);
    assert.ok(['DRAFT_WRITE_FAILED', 'GENERATE_REPAIR_EXHAUSTED'].includes(result.error?.code));
    const write = events.find((event) => event.type === 'tool.result'
      && event.payload?.name === 'survey_submit_generated_draft');
    assert.equal(write.payload.result.code, 'INVALID_TOOL_ARGUMENTS');
    assert.equal(write.payload.result.receivedShape.rawArgsComplete, false);
    assert.notEqual(write.payload.result.code, 'GENERATE_CONTRACT');
  });

  it('does not disguise length stops as operations contract errors', async () => {
    const { saves, events } = await runGenerate(async () => sseRaw({
      arguments: '{"expectedDraftUpdatedAt":"x","surveyConfig":{"title":"Partial","pages":[',
      finish_reason: 'length',
    }));
    assert.equal(saves.length, 0);
    const write = events.find((event) => event.type === 'tool.result'
      && event.payload?.name === 'survey_submit_generated_draft');
    assert.equal(write.payload.result.code, 'INCOMPLETE_TOOL_ARGS');
    assert.equal(write.payload.result.receivedShape.stopReason, 'length');
    assert.notEqual(write.payload.result.code, 'GENERATE_CONTRACT');
  });

  it('saves a complete eight-page submit as one replaceConfig', async () => {
    const surveyConfig = eightPageConfig();
    let modelCalls = 0;
    const { result, saves } = await runGenerate(async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return sseRaw({
          arguments: JSON.stringify({
            expectedDraftUpdatedAt: 'rev-1',
            surveyConfig,
          }),
        });
      }
      return sseText('Saved.');
    });
    assert.equal(result.error, undefined);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].operations.length, 1);
    assert.equal(saves[0].operations[0].op, 'replaceConfig');
    assert.equal(saves[0].operations[0].surveyConfig.pages.length, 8);
    assert.equal(result.latestDraft.surveyConfig.pages.length, 8);
  });

  it('can fail once then succeed without exhausting repair', async () => {
    let modelCalls = 0;
    const surveyConfig = eightPageConfig();
    const { result, saves, events } = await runGenerate(async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return sseRaw({ arguments: 'not JSON' });
      }
      if (modelCalls === 2) {
        return sseRaw({
          arguments: JSON.stringify({
            expectedDraftUpdatedAt: 'rev-1',
            surveyConfig,
          }),
        });
      }
      return sseText('Saved.');
    });
    assert.equal(result.error, undefined);
    assert.equal(saves.length, 1);
    assert.equal(events.some((event) => event.payload?.result?.code === 'GENERATE_REPAIR_EXHAUSTED'), false);
  });

  it('keeps compacted generate capabilities as complete consistent JSON', async () => {
    const tool = createDesignerTools({ assistantMode: 'generate' })
      .find((item) => item.name === 'survey_capabilities');
    const overview = await tool.execute({ domain: 'overview' });
    const questions = await tool.execute({ domain: 'questions' });
    const compactOverview = JSON.parse(compactJsonForModel(overview, { maxChars: 800 }));
    const compactQuestions = JSON.parse(compactJsonForModel(questions, { maxChars: 800 }));
    assert.equal(compactOverview.submit.tool, 'survey_submit_generated_draft');
    assert.ok(Array.isArray(compactQuestions.questionTypeIds) || compactQuestions.truncated);
    assert.equal(/Prefer deterministic operations/i.test(JSON.stringify(overview)), false);
    assert.equal(parseGenerateGoals('重新生成一个至少 8 页、覆盖多数题型的问卷').minPages, 8);
  });
});

describe('generate raw stream through adapter', () => {
  it('does not treat washed recovered JSON as complete original arguments', async () => {
    const originalFetch = globalThis.fetch;
    const route = resolveModelRoute('deepseek', 'deepseek-v4-pro');
    globalThis.fetch = async () => sseRaw({
      name: 'survey_submit_generated_draft',
      arguments: '{"expectedDraftUpdatedAt":"x","operations":[',
      finish_reason: 'tool_calls',
    });
    try {
      const result = await chatCompletions({
        apiKey: 'test-key',
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        protocol: route.protocol,
        compat: route.model.compat,
        messages: [{ role: 'user', content: 'Generate' }],
        tools: [{
          type: 'function',
          function: { name: 'survey_submit_generated_draft', parameters: { type: 'object' } },
        }],
      });
      assert.equal(result.rawArgsComplete ?? result.toolCalls[0].rawArgsComplete, false);
      assert.equal(result.toolCalls[0].parseError.includes('JSON') || result.toolCalls[0].rawArgsComplete === false, true);
      assert.notEqual(result.toolCalls[0].receivedShape?.operationsType, 'array');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
