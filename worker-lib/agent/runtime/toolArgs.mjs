import { describeToolArgShape } from '../../../scripts/platform-schema-core.mjs';

export { describeToolArgShape };

export function parseRawToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      args: raw,
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'structured',
      receivedShape: describeToolArgShape(raw),
      byteLength: JSON.stringify(raw).length,
    };
  }
  const text = raw == null ? '' : String(raw);
  const byteLength = text.length;
  if (!text.trim()) {
    return {
      args: {},
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'empty',
      receivedShape: describeToolArgShape({}),
      byteLength,
    };
  }
  try {
    const args = JSON.parse(text);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        args: {},
        rawArgsComplete: false,
        parseError: 'Root value must be a JSON object',
        argumentOrigin: 'raw_stream',
        receivedShape: {
          rootType: args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args,
          byteLength,
        },
        byteLength,
      };
    }
    return {
      args,
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'raw_stream',
      receivedShape: describeToolArgShape(args),
      byteLength,
    };
  } catch (error) {
    return {
      args: {},
      rawArgsComplete: false,
      parseError: String(error?.message || 'invalid json'),
      argumentOrigin: 'raw_stream',
      receivedShape: {
        rootType: 'unparsed',
        byteLength,
        preview: text.slice(0, 80),
      },
      byteLength,
    };
  }
}

function toolPartFromPartial(partial, contentIndex) {
  const parts = Array.isArray(partial?.content) ? partial.content : [];
  const part = parts[contentIndex] || parts.find((item) => item?.type === 'toolCall');
  if (!part || part.type !== 'toolCall') return null;
  return { id: part.id || '', name: part.name || '' };
}

export function createRawToolArgCollector() {
  const byIndex = new Map();
  const byId = new Map();
  const ensure = (index) => {
    let record = byIndex.get(index);
    if (!record) {
      record = { id: '', name: '', raw: '' };
      byIndex.set(index, record);
    }
    return record;
  };
  return {
    reset() {
      byIndex.clear();
      byId.clear();
    },
    onEvent(event) {
      if (event?.type !== 'toolcall_delta') return;
      const index = Number.isFinite(event.contentIndex) ? event.contentIndex : byIndex.size;
      const record = ensure(index);
      record.raw += String(event.delta || '');
      const fromPartial = toolPartFromPartial(event.partial, index);
      if (fromPartial?.id && !record.id) {
        record.id = fromPartial.id;
        byId.set(fromPartial.id, record);
      }
      if (fromPartial?.name) record.name = fromPartial.name;
      if (event.id && !record.id) {
        record.id = event.id;
        byId.set(event.id, record);
      }
    },
    snapshot() {
      return [...byIndex.values()].map((record) => ({ ...record }));
    },
    lookup(part, index) {
      return (part?.id && byId.get(part.id))
        || byIndex.get(index)
        || [...byIndex.values()][index]
        || null;
    },
  };
}

export function compactJsonForModel(value, { maxChars = 8000 } = {}) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  if (!value || typeof value !== 'object') return JSON.stringify({ summary: String(value).slice(0, 280), truncated: true });
  const compact = {
    summary: value.summary || 'Result was compacted so the JSON stays complete.',
    truncated: true,
    platformSchemaHash: value.platformSchemaHash,
    target: value.target,
    pageCount: value.pageCount,
    questionCount: value.questionCount,
    types: value.types,
    draftUpdatedAt: value.draftUpdatedAt,
    error: value.error,
    code: value.code,
    path: value.path,
    repairHint: value.repairHint,
    receivedShape: value.receivedShape,
    submit: value.generateApply || value.submit,
    questionTypeIds: value.schema?.questionTypeIds || value.capabilities?.questionTypes,
    hint: 'Ask a narrower domain if you need more schema detail.',
  };
  return JSON.stringify(Object.fromEntries(
    Object.entries(compact).filter(([, item]) => item !== undefined),
  ));
}
