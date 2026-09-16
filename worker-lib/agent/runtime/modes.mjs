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
Create a complete, usable survey configuration. You must load the capabilities and current draft, then save the full configuration with survey_apply_operations using exactly one replaceConfig operation. Do not finish with only advice or a partial configuration.`,
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
    || /(?:完全|全面|整体|从头)(?:重新)?设计(?:整份|整个)?(?:问卷|调查)/.test(text)
    || /(?:整份|整个)(?:问卷|调查)(?:完全|全面|整体|从头)?(?:重新)?设计/.test(text);
}

export function getAssistantModePolicy(value, {
  goalRequiresDraftChange = false,
  explicitRedesign = false,
} = {}) {
  const mode = normalizeAssistantMode(value);
  return {
    mode,
    systemPrompt: MODE_PROMPTS[mode],
    readOnly: mode === 'question',
    requireDraftChange: mode === 'generate'
      || mode === 'adjust'
      || (mode === 'agent' && goalRequiresDraftChange),
    allowReplaceConfig: mode !== 'adjust' || explicitRedesign,
    responseIntent: mode === 'agent' ? null : mode,
  };
}

function modeToolError(message) {
  return Object.assign(new Error(message), {
    status: 400,
    code: 'ASSISTANT_MODE_TOOL_REJECTED',
  });
}

export function applyAssistantModeToTools(tools = [], policy) {
  const selected = policy?.readOnly
    ? tools.filter((tool) => READ_ONLY_TOOLS.has(tool.name)
      || (tool.minPermission === 'ask' && !tool.risk))
    : tools;

  return selected.map((tool) => {
    if (tool.name !== 'survey_apply_operations') return tool;
    return {
      ...tool,
      async execute(args, ctx) {
        const operations = Array.isArray(args?.operations) ? args.operations : [];
        if (policy.mode === 'generate') {
          const operation = operations[0];
          if (
            operations.length !== 1
            || operation?.op !== 'replaceConfig'
            || !operation.surveyConfig
            || typeof operation.surveyConfig !== 'object'
          ) {
            throw modeToolError(
              'Generate mode requires exactly one replaceConfig operation containing the complete surveyConfig.',
            );
          }
        }
        if (
          policy.mode === 'adjust'
          && !policy.allowReplaceConfig
          && operations.some((operation) => operation?.op === 'replaceConfig')
        ) {
          throw modeToolError(
            'Adjust mode requires incremental operations unless the user explicitly requested a complete redesign.',
          );
        }
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
