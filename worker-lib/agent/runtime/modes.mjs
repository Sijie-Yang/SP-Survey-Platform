import {
  applyToolContract,
  classifyApplyContractError,
  describeApplyShape,
} from './applySchema.mjs';

export const DEFAULT_ASSISTANT_MODE = 'agent';
export const ASSISTANT_MODES = Object.freeze(['agent', 'generate', 'adjust', 'question']);

const READ_ONLY_TOOLS = new Set([
  'survey_capabilities',
  'survey_get_draft',
  'survey_validate',
  'survey_preview_urls',
]);

const MODE_PROMPTS = Object.freeze({
  agent: `Assistant mode: Agent.
Act autonomously and select the tools needed to achieve the user's goal. A draft mutation is optional unless the goal requires changing the survey. Do not mutate the draft for explanation-only requests.`,
  generate: `Assistant mode: Generate.
Create a complete, usable survey. Load generate capabilities and the current draft, then save only with survey_submit_generated_draft. Pass expectedDraftUpdatedAt and surveyConfig { title, pages }. Do not send an operations array or replaceConfig. Do not finish with only advice or a partial configuration.`,
  adjust: `Assistant mode: Adjust.
Change only what the user requested and preserve every unrelated field. Use incremental survey_apply_operations operations. Use replaceConfig only when the user explicitly requests a complete redesign, while still retaining any unrelated project data that should survive the redesign.`,
  question: `Assistant mode: Question.
Answer the user's question using read-only survey tools when useful. You cannot mutate the draft, and must not claim that you saved or changed it.`,
});

export function normalizeAssistantMode(value) {
  const mode = String(value || DEFAULT_ASSISTANT_MODE).trim().toLowerCase();
  if (!ASSISTANT_MODES.includes(mode)) {
    throw Object.assign(new Error(`Unsupported assistantMode: ${mode}`), {
      status: 400,
      code: 'INVALID_ASSISTANT_MODE',
    });
  }
  return mode;
}

export function requestsExplicitRedesign(message) {
  const text = String(message || '');
  return /\b(?:complete|full|entire|from[- ]scratch)\s+(?:survey\s+)?redesign\b/i.test(text)
    || /\bredesign\s+(?:the\s+)?(?:complete|full|entire|whole)\s+survey\b/i.test(text)
    || /\b(?:re(?:generate|build|make)|start over)\b[\s\S]{0,40}\b(?:survey|questionnaire)\b/i.test(text)
    || /(?:完全|全面|整体|从头)(?:重新)?设计(?:整份|整个)?(?:问卷|调查)/.test(text)
    || /(?:整份|整个)(?:问卷|调查)(?:完全|全面|整体|从头)?(?:重新)?设计/.test(text)
    || /重新(?:生成|设计|做|写|构建)[\s\S]{0,20}(?:问卷|调查)/.test(text)
    || /(?:问卷|调查)[\s\S]{0,20}重新(?:生成|设计|做|写|构建)/.test(text);
}

export function getAssistantModePolicy(value, {
  goalRequiresDraftChange = false,
  explicitRedesign = false,
  denyPublish = false,
} = {}) {
  const mode = normalizeAssistantMode(value);
  return {
    mode,
    systemPrompt: MODE_PROMPTS[mode],
    readOnly: mode === 'question',
    requireDraftChange: mode !== 'question' && Boolean(goalRequiresDraftChange),
    allowReplaceConfig: mode !== 'adjust' || explicitRedesign,
    denyPublish: Boolean(denyPublish),
    responseIntent: mode === 'agent' ? null : mode,
  };
}

export function modeToolError({
  message,
  code = 'ASSISTANT_MODE_TOOL_REJECTED',
  path = '',
  expected,
  receivedShape,
  repairHint = '',
  retryAction = 'repair_args',
} = {}) {
  return Object.assign(new Error(message || 'Tool rejected by assistant mode.'), {
    status: 400,
    code,
    path,
    expected,
    receivedShape,
    repairHint,
    retryAction,
    details: { path, expected, receivedShape, retryAction },
    hint: repairHint,
  });
}

export function assertApplyContract(args, policy = {}) {
  const error = classifyApplyContractError(args, {
    mode: policy.mode || 'agent',
    allowReplaceConfig: policy.allowReplaceConfig !== false,
  });
  if (!error) return null;
  throw modeToolError(error);
}

export function applyAssistantModeToTools(tools = [], policy) {
  const selected = (policy?.readOnly
    ? tools.filter((tool) => READ_ONLY_TOOLS.has(tool.name)
      || (tool.minPermission === 'ask' && !tool.risk))
    : tools
  ).filter((tool) => !policy?.denyPublish || (tool.name !== 'survey_publish' && tool.risk !== 'publish'));
  const contract = applyToolContract(policy || {});

  return selected.map((tool) => {
    if (tool.name !== 'survey_apply_operations') return tool;
    return {
      ...tool,
      description: contract.description,
      parameters: contract.parameters,
      async execute(args, ctx) {
        assertApplyContract(args, policy);
        return tool.execute(args, ctx);
      },
    };
  });
}

export function assistantModeFromEvents(events = [], fallback = DEFAULT_ASSISTANT_MODE) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const mode = events[index]?.payload?.assistantMode;
    if (mode) {
      try {
        return normalizeAssistantMode(mode);
      } catch {
        // Ignore old or malformed event metadata.
      }
    }
  }
  return normalizeAssistantMode(fallback);
}

export function applyReceivedShape(args) {
  return describeApplyShape(args);
}
