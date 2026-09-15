/**
 * Stable SP-Survey Agent Runtime event protocol.
 * Inspired by DeepSeek Harness append-only session logs (MIT), not a wire clone.
 */

export const RUNTIME_VERSION = 'sp-agent-runtime/0.1';

export const EVENT_TYPES = [
  'session.start',
  'user.message',
  'assistant.delta',
  'assistant.message',
  'tool.call',
  'tool.result',
  'approval.ask',
  'approval.answer',
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
    if (ev.type === 'user.message') {
      assistant = null;
      messages.push({
        role: 'user',
        content: ev.payload?.content || '',
        createdAt: ev.createdAt || ev.created_at,
      });
    } else if (ev.type === 'assistant.delta' || ev.type === 'assistant.message') {
      if (!assistant) {
        assistant = {
          role: 'assistant',
          content: '',
          tools: [],
          createdAt: ev.createdAt || ev.created_at,
        };
        messages.push(assistant);
      }
      if (ev.payload?.content) assistant.content += ev.payload.content;
    } else if (ev.type === 'tool.call') {
      if (!assistant) {
        assistant = { role: 'assistant', content: '', tools: [], createdAt: ev.createdAt };
        messages.push(assistant);
      }
      assistant.tools.push({
        name: ev.payload?.name,
        args: ev.payload?.args,
        status: 'running',
        id: ev.payload?.id,
      });
    } else if (ev.type === 'tool.result') {
      const tool = assistant?.tools?.find((t) => t.id === ev.payload?.id || t.name === ev.payload?.name);
      if (tool) {
        tool.status = ev.payload?.ok === false ? 'error' : 'done';
        tool.result = ev.payload?.summary || ev.payload?.result;
      }
    }
  }
  return messages;
}
