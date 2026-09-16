/**
 * Stable SP-Survey Agent Runtime event protocol.
 * Inspired by DeepSeek Harness append-only session logs (MIT), not a wire clone.
 */

export const RUNTIME_VERSION = 'sp-agent-runtime/0.1';

export const EVENT_TYPES = [
  'session.start',
  'turn.start',
  'turn.end',
  'step.start',
  'step.end',
  'user.message',
  'assistant.delta',
  'assistant.message',
  'tool.call',
  'tool.result',
  'tool.outcome.unknown',
  'approval.ask',
  'approval.answer',
  'steering.message',
  'todo.update',
  'request.headers',
  'context.prune',
  'context.compact',
  'run.status',
  'usage',
  'error',
  'model.selection',
  'llm.retry',
];

export function createEvent(type, payload = {}, extras = {}) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Unknown runtime event type: ${type}`);
  }
  return {
    type,
    payload: payload && typeof payload === 'object' ? payload : {},
    createdAt: extras.createdAt || new Date().toISOString(),
    seq: extras.seq ?? null,
    runId: extras.runId || null,
  };
}

export function createTextBatcher({
  flush,
  maxWaitMs = 250,
  maxBytes = 800,
} = {}) {
  let buffer = '';
  let timer = null;
  const emit = async () => {
    if (!buffer) return null;
    const content = buffer;
    buffer = '';
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return flush?.(content);
  };
  return {
    push(text) {
      buffer += String(text || '');
      if (buffer.length >= maxBytes) return emit();
      if (!timer) {
        timer = setTimeout(() => {
          emit();
        }, maxWaitMs);
      }
      return null;
    },
    flush: emit,
    get pending() {
      return buffer;
    },
  };
}

export function redactSecrets(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/\bsk-[a-zA-Z0-9-_]{8,}\b/g, 'sk-***')
      .replace(/\bsk-or-[a-zA-Z0-9-_]{8,}\b/g, 'sk-or-***');
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/key|token|secret|password|authorization/i.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = redactSecrets(item, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function eventsToUiMessages(events = []) {
  const messages = [];
  let assistant = null;
  for (const ev of events) {
    if (ev.type === 'user.message' || ev.type === 'steering.message') {
      assistant = null;
      messages.push({
        id: `event-${ev.seq ?? messages.length}`,
        role: 'user',
        content: ev.payload?.content || '',
        createdAt: ev.createdAt || ev.created_at,
        ...(ev.type === 'steering.message' ? { metadata: { steering: true } } : {}),
      });
    } else if (ev.type === 'assistant.delta' || ev.type === 'assistant.message') {
      if (!assistant) {
        assistant = {
          id: `event-${ev.seq ?? messages.length}`,
          role: 'assistant',
          content: '',
          tools: [],
          createdAt: ev.createdAt || ev.created_at,
        };
        messages.push(assistant);
      }
      if (ev.payload?.content) {
        const content = ev.payload.content;
        if (ev.type === 'assistant.delta' || !assistant.content.endsWith(content)) {
          assistant.content += content;
        }
      }
    } else if (ev.type === 'tool.call') {
      if (!assistant) {
        assistant = {
          id: `event-${ev.seq ?? messages.length}`,
          role: 'assistant',
          content: '',
          tools: [],
          createdAt: ev.createdAt || ev.created_at,
        };
        messages.push(assistant);
      }
      assistant.tools.push({
        name: ev.payload?.name,
        args: ev.payload?.args,
        status: 'running',
        id: ev.payload?.id,
      });
    } else if (ev.type === 'tool.result' || ev.type === 'tool.outcome.unknown') {
      const tool = assistant?.tools?.find((t) => t.id === ev.payload?.id || t.name === ev.payload?.name);
      if (tool) {
        tool.status = ev.type === 'tool.outcome.unknown' || ev.payload?.outcome === 'unknown'
          ? 'unknown'
          : (ev.payload?.ok === false ? 'error' : 'done');
        tool.result = ev.payload?.summary || ev.payload?.result;
      }
    }
  }
  return messages;
}

/**
 * Rebuild provider-neutral model history from the append-only event stream.
 * Every tool call receives exactly one tool result. An interrupted call without
 * a durable result is represented as an unknown outcome and must not be retried
 * blindly by a resumed agent.
 */
export function eventsToModelMessages(events = [], {
  includeIncomplete = true,
  unknownOutcomeText = 'Tool outcome is unknown because execution was interrupted. Verify state before retrying.',
} = {}) {
  const messages = [];
  let assistant = null;
  let emittedAssistant = false;
  const pending = new Map();
  const settled = new Set();

  const ensureAssistant = () => {
    if (!assistant) assistant = { role: 'assistant', content: '', tool_calls: [] };
    return assistant;
  };
  const emitAssistant = () => {
    if (!assistant || emittedAssistant) return;
    if (assistant.content || assistant.tool_calls.length) {
      messages.push({
        role: 'assistant',
        content: assistant.content || null,
        ...(assistant.tool_calls.length ? { tool_calls: assistant.tool_calls } : {}),
      });
    }
    emittedAssistant = true;
  };
  const emitUnknown = () => {
    if (!pending.size) return;
    emitAssistant();
    if (includeIncomplete) {
      for (const call of pending.values()) {
        messages.push(toolResultMessage({
          id: call.id,
          name: call.name,
          ok: false,
          outcome: 'unknown',
          result: { error: unknownOutcomeText, code: 'UNKNOWN_TOOL_OUTCOME' },
        }));
        settled.add(call.id);
      }
    }
    pending.clear();
  };
  const boundary = () => {
    emitUnknown();
    emitAssistant();
    assistant = null;
    emittedAssistant = false;
  };

  for (const event of events || []) {
    const payload = event?.payload || {};
    if (event?.type === 'user.message' || event?.type === 'steering.message') {
      boundary();
      messages.push({
        role: 'user',
        content: String(payload.content || payload.message || ''),
      });
    } else if (event?.type === 'assistant.delta') {
      const current = ensureAssistant();
      if (payload.content) current.content += String(payload.content);
    } else if (event?.type === 'assistant.message') {
      const current = ensureAssistant();
      const content = String(payload.content || '');
      if (content && !current.content.endsWith(content)) current.content += content;
    } else if (event?.type === 'tool.call') {
      const current = ensureAssistant();
      const id = payload.id || `event-call-${event.seq ?? current.tool_calls.length}`;
      const name = payload.name || 'unknown_tool';
      current.tool_calls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(payload.args || {}),
        },
      });
      pending.set(id, { id, name });
    } else if (event?.type === 'tool.result') {
      if (settled.has(payload.id)) continue;
      emitAssistant();
      messages.push(toolResultMessage(payload));
      pending.delete(payload.id);
      settled.add(payload.id);
    } else if (event?.type === 'tool.outcome.unknown') {
      if (settled.has(payload.id)) continue;
      emitAssistant();
      const unknown = {
        ...payload,
        ok: false,
        outcome: 'unknown',
        result: payload.result || {
          error: payload.summary || unknownOutcomeText,
          code: payload.code || 'UNKNOWN_TOOL_OUTCOME',
        },
      };
      messages.push(toolResultMessage(unknown));
      pending.delete(payload.id);
      settled.add(payload.id);
    } else if (event?.type === 'context.prune') {
      boundary();
      const ids = new Set(payload.toolCallIds || []);
      for (const message of messages) {
        if (message?.role !== 'toolResult' || !ids.has(message.toolCallId)) continue;
        message.content = [{
          type: 'text',
          text: `[Older tool result pruned: ${message.toolName || message.toolCallId}]`,
        }];
      }
    } else if (event?.type === 'context.compact' && payload.replacement) {
      boundary();
      messages.length = 0;
      messages.push({ role: 'user', content: String(payload.replacement) });
    } else if (
      event?.type === 'step.end'
      || event?.type === 'turn.end'
      || event?.type === 'error'
    ) {
      boundary();
    }
  }
  boundary();
  return messages.filter((message) => message.role !== 'user' || message.content);
}

export function estimateModelTokens(messages = []) {
  let characters = 0;
  for (const message of messages || []) {
    characters += String(message?.role || '').length + 8;
    characters += contentText(message?.content).length;
    if (Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        characters += String(call?.function?.name || call?.name || '').length;
        characters += String(call?.function?.arguments || call?.arguments || '').length;
      }
    }
  }
  return Math.ceil(characters / 4);
}

/**
 * Deterministic pressure handling for Worker requests. Old tool payloads are
 * pruned first, then complete old message groups are replaced by a summary.
 */
export function compactModelMessages(messages = [], {
  contextWindow = 128000,
  maxOutputTokens = 4096,
  pressureRatio = 0.82,
  targetRatio = 0.62,
  maxToolResultChars = 4000,
  keepRecentMessages = 8,
  force = false,
} = {}) {
  const originalTokens = estimateModelTokens(messages);
  const inputBudget = Math.max(
    256,
    Math.floor(Number(contextWindow || 128000) * pressureRatio) - Number(maxOutputTokens || 0),
  );
  if (!force && originalTokens <= inputBudget) {
    return {
      messages: [...messages],
      changed: false,
      pruned: 0,
      compacted: 0,
      prunedToolCallIds: [],
      originalTokens,
      estimatedTokens: originalTokens,
      inputBudget,
    };
  }

  const working = messages.map(cloneMessage);
  let pruned = 0;
  const prunedToolCallIds = [];
  for (const message of working) {
    if (message?.role !== 'toolResult' && message?.role !== 'tool') continue;
    const text = contentText(message.content);
    if (text.length <= maxToolResultChars) continue;
    const marker = `[Older tool result pruned: ${message.toolName || message.name || message.toolCallId || 'tool'}; ${text.length} characters]`;
    message.content = message.role === 'toolResult'
      ? [{ type: 'text', text: marker }]
      : marker;
    pruned += 1;
    if (message.toolCallId || message.tool_call_id) {
      prunedToolCallIds.push(message.toolCallId || message.tool_call_id);
    }
  }

  const targetTokens = Math.max(
    128,
    Math.floor(Number(contextWindow || 128000) * targetRatio) - Number(maxOutputTokens || 0),
  );
  let estimatedTokens = estimateModelTokens(working);
  let compacted = 0;
  if (force || estimatedTokens > targetTokens) {
    const system = working.filter((message) => message.role === 'system');
    const nonSystem = working.filter((message) => message.role !== 'system');
    let cut = Math.max(0, nonSystem.length - Math.max(2, keepRecentMessages));
    cut = completeGroupCut(nonSystem, cut);
    let older = nonSystem.slice(0, cut);
    let recent = nonSystem.slice(cut);

    while (recent.length > 2 && estimateModelTokens([
      ...system,
      summaryMessage(older),
      ...recent,
    ]) > targetTokens) {
      const nextCut = completeGroupCut(recent, Math.min(2, recent.length - 2));
      if (nextCut <= 0) break;
      older = older.concat(recent.slice(0, nextCut));
      recent = recent.slice(nextCut);
    }
    if (older.length) {
      compacted = older.length;
      working.length = 0;
      working.push(...system, summaryMessage(older), ...recent);
      estimatedTokens = estimateModelTokens(working);
    }
  }

  return {
    messages: working,
    changed: pruned > 0 || compacted > 0,
    pruned,
    compacted,
    prunedToolCallIds,
    originalTokens,
    estimatedTokens,
    inputBudget,
  };
}

function toolResultMessage(payload = {}) {
  const result = payload.result ?? payload.summary ?? '';
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return {
    role: 'toolResult',
    toolCallId: payload.id,
    toolName: payload.name || 'tool',
    content: [{ type: 'text', text }],
    isError: payload.ok === false || payload.outcome === 'unknown',
    outcome: payload.outcome || (payload.ok === false ? 'failure' : 'success'),
    timestamp: Date.now(),
  };
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part) => (
    typeof part === 'string' ? part : String(part?.text || JSON.stringify(part || ''))
  )).join('\n');
}

function cloneMessage(message) {
  if (!message || typeof message !== 'object') return message;
  return {
    ...message,
    ...(Array.isArray(message.content)
      ? { content: message.content.map((part) => ({ ...part })) }
      : {}),
    ...(Array.isArray(message.tool_calls)
      ? {
        tool_calls: message.tool_calls.map((call) => ({
          ...call,
          ...(call.function ? { function: { ...call.function } } : {}),
        })),
      }
      : {}),
  };
}

function completeGroupCut(messages, requestedCut) {
  let cut = Math.max(0, Math.min(requestedCut, messages.length));
  while (cut > 0 && (messages[cut]?.role === 'toolResult' || messages[cut]?.role === 'tool')) {
    cut -= 1;
  }
  return cut;
}

function summaryMessage(messages) {
  const lines = [];
  for (const message of messages) {
    if (message?.role === 'toolResult' || message?.role === 'tool') {
      lines.push(`Tool ${message.toolName || message.name || 'result'}: ${contentText(message.content).slice(0, 240)}`);
    } else if (message?.role === 'assistant' || message?.role === 'user') {
      const text = contentText(message.content).replace(/\s+/g, ' ').trim();
      if (text) lines.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${text.slice(0, 500)}`);
    }
  }
  return {
    role: 'user',
    content: [
      '<context_summary>',
      'Earlier conversation was compacted deterministically. Verify current state before repeating mutations.',
      ...lines.slice(-16),
      '</context_summary>',
    ].join('\n'),
  };
}
