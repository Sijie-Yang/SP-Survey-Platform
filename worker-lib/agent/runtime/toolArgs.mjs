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

function draftCatalog(surveyConfig) {
  const pages = Array.isArray(surveyConfig?.pages) ? surveyConfig.pages : [];
  return pages.map((page) => ({
    pageName: page?.name || '',
    title: page?.title || '',
    questions: (page?.elements || []).map((element) => ({
      name: element?.name || '',
      type: element?.type || '',
      title: element?.title || '',
    })),
  }));
}

function pickQuestion(surveyConfig, pageName, questionName) {
  for (const page of surveyConfig?.pages || []) {
    if (pageName && page?.name !== pageName) continue;
    const found = (page?.elements || []).find((element) => element?.name === questionName);
    if (found) return { pageName: page.name, question: found };
  }
  return null;
}

function continueRead(value) {
  if (value?.schema?.questionTypeIds || value?.capabilities?.questionTypes) {
    return {
      tool: 'survey_capabilities',
      args: { domain: 'questions', questionType: '<typeId>' },
      note: 'Load one question type or fieldGroup or skillId at a time for the full contract.',
    };
  }
  if (value?.surveyConfig || value?.catalog) {
    return {
      tool: 'survey_get_draft',
      args: { view: 'question', pageName: '<pageName>', questionName: '<questionName>' },
      note: 'Catalog is complete. Read one page or question for full fields. draftUpdatedAt is unchanged.',
    };
  }
  return {
    tool: 'survey_capabilities',
    args: { domain: value?.domain || 'overview' },
    note: 'Re-query a narrower slice. Same platformSchemaHash means the contract version is unchanged.',
  };
}

export function compactJsonForModel(value, { maxChars = 8000 } = {}) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  if (!value || typeof value !== 'object') {
    return JSON.stringify({ summary: String(value).slice(0, 280), truncated: true, complete: false });
  }
  const catalog = value.catalog || draftCatalog(value.surveyConfig);
  const compact = {
    summary: value.summary || 'Result was compacted. Use next.read to load the missing slice. Necessary ids and examples below were kept.',
    truncated: true,
    complete: false,
    platformSchemaHash: value.platformSchemaHash,
    generationContractVersion: value.generationContractVersion || value.schema?.generationContractVersion,
    draftUpdatedAt: value.draftUpdatedAt,
    target: value.target,
    pageCount: value.pageCount,
    questionCount: value.questionCount,
    types: value.types,
    error: value.error,
    code: value.code,
    path: value.path,
    question: value.question,
    repairHint: value.repairHint,
    receivedShape: value.receivedShape,
    submit: (value.generateApply?.tool || value.submit?.tool || value.schema?.submit || value.capabilities?.submit?.tool)
      ? {
        tool: value.generateApply?.tool || value.submit?.tool || value.schema?.submit || value.capabilities?.submit?.tool,
        required: value.generateApply?.required || value.submit?.required || value.schema?.required,
      }
      : undefined,
    sliderDimensions: value.schema?.sliderDimensions || value.capabilities?.sliderDimensions
      || value.sliderDimensions,
    questionTypeIds: value.schema?.questionTypeIds || value.capabilities?.questionTypes,
    examples: value.schema?.example || value.capabilities?.examples || value.examples,
    catalog,
    next: { read: continueRead(value) },
  };
  const kept = Object.fromEntries(Object.entries(compact).filter(([, item]) => item !== undefined));
  let out = JSON.stringify(kept);
  if (out.length > maxChars && kept.examples) {
    delete kept.examples;
    out = JSON.stringify(kept);
  }
  if (out.length > maxChars && Array.isArray(kept.catalog)) {
    kept.catalog = kept.catalog.map((page) => ({
      pageName: page.pageName,
      questions: (page.questions || []).map((question) => question.name),
    }));
    out = JSON.stringify(kept);
  }
  return out;
}

export { draftCatalog, pickQuestion };
