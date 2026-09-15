import { extraHeaders } from './catalog.mjs';
import { applyReasoning, mergeCompat, setMaxTokens, systemRole } from './compat.mjs';
import { classifyHttpError, parseRetryAfter, withRetry } from './retry.mjs';
import { assertSafeBaseUrl } from './ssrf.mjs';

function rewriteSystemRole(messages, compat) {
  const role = systemRole(compat);
  if (role === 'system') return messages;
  return messages.map((m) => (m.role === 'system' ? { ...m, role } : m));
}

async function parseJson(res) {
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) {
    throw Object.assign(new Error('Provider response exceeded 4 MiB.'), {
      status: 502,
      code: 'RESPONSE_TOO_LARGE',
    });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('Provider returned malformed JSON.'), {
      status: 502,
      code: 'MALFORMED_JSON',
    });
  }
}

function failHttp(res, data) {
  const message = data?.error?.message || data?.message || `Model request failed (${res.status})`;
  const code = classifyHttpError(res.status, message);
  throw Object.assign(new Error(message), {
    status: res.status,
    code,
    retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
  });
}

async function openaiCompletions({ endpoint, apiKey, provider, model, messages, temperature, maxTokens, tools, json, signal, compat, effort, efforts, extra }) {
  let body = {
    model,
    messages: rewriteSystemRole(messages, compat),
    temperature,
  };
  body = setMaxTokens(body, maxTokens, compat);
  body = applyReasoning({ body, protocol: 'openai-completions', effort, efforts, compat });
  if (json) body.response_format = { type: 'json_object' };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders(provider),
      ...(extra || {}),
    },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  const data = await parseJson(res);
  if (!res.ok) failHttp(res, data);
  const choice = data.choices?.[0]?.message || {};
  return {
    content: choice.content || '',
    toolCalls: choice.tool_calls || [],
    usage: data.usage || {},
    raw: choice,
  };
}

async function openaiResponses({ endpoint, apiKey, provider, model, messages, temperature, maxTokens, tools, json, signal, compat, extra }) {
  const input = messages.map((m) => ({
    role: m.role === 'tool' ? 'user' : m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
  }));
  let body = { model, input, temperature };
  body = setMaxTokens(body, maxTokens, { ...compat, maxTokensField: compat.maxTokensField || 'max_output_tokens' });
  if (json) body.text = { format: { type: 'json_object' } };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description || '',
      parameters: tool.function?.parameters || tool.parameters || {},
    }));
  }
  const res = await fetch(`${endpoint}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders(provider),
      ...(extra || {}),
    },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  const data = await parseJson(res);
  if (!res.ok) failHttp(res, data);
  const text = data.output_text
    || (data.output || []).flatMap((item) => item.content || []).map((c) => c.text || '').join('');
  const toolCalls = (data.output || [])
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      id: item.call_id || item.id,
      type: 'function',
      function: { name: item.name, arguments: item.arguments || '{}' },
    }));
  return { content: text, toolCalls, usage: data.usage || {}, raw: data };
}

function toAnthropicMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const converted = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || {}),
        }],
      });
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      converted.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.tool_calls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.function?.name || call.name,
            input: safeJson(call.function?.arguments || '{}'),
          })),
        ],
      });
      continue;
    }
    converted.push({
      role: message.role,
      content: typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content) ? message.content : JSON.stringify(message.content || ''),
    });
  }
  return { system, messages: converted };
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return {}; }
}

async function anthropicMessages({ endpoint, apiKey, model, messages, temperature, maxTokens, tools, signal, effort, efforts, compat }) {
  const { system, messages: converted } = toAnthropicMessages(messages);
  let body = {
    model,
    system: system || undefined,
    messages: converted,
    temperature,
    max_tokens: maxTokens,
  };
  body = applyReasoning({ body, protocol: 'anthropic-messages', effort, efforts, compat });
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((tool) => ({
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description || '',
      input_schema: tool.function?.parameters || tool.parameters || { type: 'object', properties: {} },
    }));
  }
  const res = await fetch(`${endpoint.replace(/\/v1$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  const data = await parseJson(res);
  if (!res.ok) failHttp(res, data);
  const blocks = data.content || [];
  const content = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
    id: b.id,
    type: 'function',
    function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
  }));
  return {
    content,
    toolCalls,
    usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens },
    raw: data,
  };
}

export async function modelRequest(options) {
  const protocol = options.protocol || 'openai-completions';
  const endpoint = assertSafeBaseUrl(options.baseUrl);
  const compat = mergeCompat(options.compat);
  const call = () => {
    if (protocol === 'openai-responses') return openaiResponses({ ...options, endpoint, compat });
    if (protocol === 'anthropic-messages') return anthropicMessages({ ...options, endpoint, compat });
    return openaiCompletions({ ...options, endpoint, compat });
  };
  return withRetry(call, {
    policy: options.retryPolicy,
    signal: options.signal,
    onRetry: options.onRetry,
  });
}

export function toOpenAiTools(toolDefs = []) {
  return toolDefs.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  }));
}
