/**
 * Restricted tool-calling loop.
 */

import { createEvent, redactSecrets } from './events.mjs';
import { chatCompletions, toOpenAiTools } from './providers.mjs';
import { summarizeToolResult } from './tools.mjs';

const MAX_STEPS = 8;

export async function runToolLoop({
  apiKey,
  provider,
  baseUrl,
  model,
  messages,
  registry,
  ctx,
  temperature,
  maxTokens,
  protocol,
  compat,
  retryPolicy,
  effort,
  efforts,
  onEvent,
  signal,
  maxSteps = MAX_STEPS,
}) {
  const tools = toOpenAiTools(registry.list());
  let step = 0;
  let last = { content: '', toolCalls: [], usage: {} };
  let latestDraft = null;
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const working = [...messages];

  while (step < maxSteps) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Cancelled'), { status: 499, code: 'CANCELLED' });
    }
    last = await chatCompletions({
      apiKey,
      provider,
      baseUrl,
      model,
      messages: working,
      temperature,
      maxTokens,
      tools,
      protocol,
      compat,
      retryPolicy,
      effort,
      efforts,
      signal,
      onRetry: async (info) => {
        await onEvent?.(createEvent('llm.retry', info));
      },
    });
    usage.prompt_tokens += Number(last.usage.prompt_tokens || 0);
    usage.completion_tokens += Number(last.usage.completion_tokens || 0);

    if (last.content) {
      await onEvent?.(createEvent('assistant.delta', { content: last.content }));
    }

    const calls = Array.isArray(last.toolCalls) ? last.toolCalls : [];
    if (!calls.length) break;

    working.push({
      role: 'assistant',
      content: last.content || null,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function?.name || call.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || call.arguments || '{}');
      } catch {
        args = {};
      }
      const id = call.id || `call_${step}_${name}`;
      await onEvent?.(createEvent('tool.call', redactSecrets({ id, name, args })));
      let result;
      let ok = true;
      try {
        result = await registry.execute(name, args, { ...ctx, signal });
        if (result?.surveyConfig) {
          latestDraft = {
            surveyConfig: result.surveyConfig,
            draftUpdatedAt: result.draftUpdatedAt || null,
          };
        }
      } catch (error) {
        ok = false;
        result = { error: error.message, code: error.code };
      }
      const summary = summarizeToolResult(name, result);
      await onEvent?.(createEvent('tool.result', redactSecrets({
        id, name, ok, summary, result: compactResult(result),
      })));
      working.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(redactSecrets(result)).slice(0, 12000),
      });
    }
    step += 1;
  }

  if (last.content) {
    await onEvent?.(createEvent('assistant.message', { content: last.content }));
  }
  await onEvent?.(createEvent('usage', usage));
  return { content: last.content || '', usage, steps: step, latestDraft };
}

function compactResult(result) {
  if (!result || typeof result !== 'object') return result;
  const { surveyConfig, ...rest } = result;
  if (surveyConfig) {
    rest.surveyConfigPreview = {
      title: surveyConfig.title,
      pages: (surveyConfig.pages || []).length,
      questions: (surveyConfig.pages || []).reduce((n, p) => n + (p.elements || []).length, 0),
    };
  }
  return rest;
}
