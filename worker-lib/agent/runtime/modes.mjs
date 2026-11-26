import {
  applyToolContract,
  classifyApplyContractError,
  describeApplyShape,
} from './applySchema.mjs';

export const DEFAULT_ASSISTANT_MODE = 'agent';
export const ASSISTANT_MODES = Object.freeze(['agent', 'spscheme', 'generate', 'adjust', 'question', 'review']);

const READ_ONLY_TOOLS = new Set([
  'survey_capabilities',
  'survey_get_draft',
  'survey_validate',
  'survey_preview_urls',
  'survey_answerability',
  'survey_preflight',
]);

const MODE_PROMPTS = Object.freeze({
  agent: `Assistant mode: Agent.
Act autonomously and select the tools needed to achieve the user's goal. A draft mutation is optional unless the goal requires changing the survey. Do not mutate the draft for explanation-only requests.`,
  spscheme: `Assistant mode: SP-Scheme.
The study is one SP-Scheme web page that holds every question. To create the study or change anything participants see, call sp_scheme_write_page once with the researcher's request written out in full (every detail they gave; for a change, exactly what to change). The platform writes the page, checks it and saves it only when it passes. Never use survey_apply_operations. Questions or explanations need no tool, or only survey_get_draft. After the tool returns, tell the researcher in one or two plain sentences what changed, or which problems stopped it from being saved.`,
  generate: `Assistant mode: Generate.
Create a complete, usable survey. Load generate capabilities and the current draft, then save only with survey_submit_generated_draft. Pass expectedDraftUpdatedAt and surveyConfig { title, pages }. Do not send an operations array or replaceConfig. Do not finish with only advice or a partial configuration.`,
  adjust: `Assistant mode: Adjust.
Change only what the user requested and preserve every unrelated field. Use incremental survey_apply_operations operations. Use replaceConfig only when the user explicitly requests a complete redesign, while still retaining any unrelated project data that should survive the redesign.`,
  question: `Assistant mode: Question.
Answer the user's question using read-only survey tools when useful. You cannot mutate the draft, and must not claim that you saved or changed it.`,
  review: `Assistant mode: Review.
A panel of reviewer roles rates the survey and comments in rounds. Reviewers are read-only. Revisions are proposed as design-protocol operations and applied only through the validated apply path.`,
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
    readOnly: mode === 'question' || mode === 'review',
    requireDraftChange: mode !== 'question' && mode !== 'review' && Boolean(goalRequiresDraftChange),
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

/**
 * The mode the researcher used for the previous message of this conversation
 * (events of other runs only), or '' when there is none.
 */
export function previousMessageMode(events = [], currentRunId = null) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'user.message' || (currentRunId && event.run_id === currentRunId)) continue;
    const mode = String(event.payload?.assistantMode || '').trim().toLowerCase();
    if (ASSISTANT_MODES.includes(mode)) return mode;
  }
  return '';
}

/** A note for the model when the researcher switched mode since their last message; '' otherwise. */
export function modeSwitchNote(previousMode, assistantMode) {
  if (!previousMode || previousMode === assistantMode) return '';
  if (assistantMode === 'spscheme') {
    return '\n\nMode switch: the researcher has just switched this conversation to SP-Scheme mode. Earlier messages in this conversation were in another mode. From now on build and change the study as one SP-Scheme page with sp_scheme_write_page; do not edit question pages one by one.';
  }
  if (assistantMode === 'agent') {
    return '\n\nMode switch: the researcher has just switched this conversation to Classic mode. Earlier messages may be about the SP-Scheme page. From now on build and change the survey in the classic editor, question by question, with the survey tools; do not write or change the SP-Scheme page.';
  }
  return '';
}
