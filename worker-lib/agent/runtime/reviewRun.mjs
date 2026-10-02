import { runToolLoop } from './loop.mjs';
import { createToolRegistry } from './tools.mjs';
import { createEvent, redactSecrets } from './events.mjs';
import { summarizeToolResult } from './tools.mjs';
import {
  applyOperations,
  normalizeOperationsArg,
  postProcessAiConfig,
  sanitizeForAgent,
  validateSurveyConfig,
} from '../../designProtocol.mjs';
import { evaluateSurveyContract } from '../../answerability.mjs';
import {
  REVIEW_READ_TOOLS,
  REVIEW_SUBMIT_PARAMETERS,
  REVIEW_SUBMIT_TOOL,
  REVISION_SUBMIT_PARAMETERS,
  REVISION_SUBMIT_TOOL,
  applicableReviewRounds,
  dryRunRevision,
  estimateReviewCost,
  isDraftConflictError,
  reviewFromEvents,
  extractJsonObject,
  parseRevision,
  parseRoleReview,
  revisionSystemPrompt,
  revisionUserPrompt,
  roleSystemPrompt,
  roleUserPrompt,
  runReviewOrchestration,
} from './review.mjs';

const ROLE_MAX_STEPS = 6;
const REVISION_MAX_STEPS = 8;
const ROLE_MAX_TOKENS = 2048;
const REVISION_MAX_TOKENS = 6144;

/** Deterministic participant-flow checks for reviewers; read-only. */
export function reviewPreflight(surveyConfig = {}) {
  const pages = Array.isArray(surveyConfig?.pages) ? surveyConfig.pages : [];
  const questions = pages.flatMap((page) => (page?.elements || []).map((element) => ({ page: page?.name, element })));
  const trialQuestions = questions
    .map(({ page, element }) => ({ page, name: element?.name, type: element?.type, trials: Math.max(1, Number.parseInt(element?.trialCount, 10) || 1) }))
    .filter((item) => item.trials > 1);
  const mediaTypes = /^(image|media|video)/i;
  const screens = questions.reduce((count, { element }) => count + Math.max(1, Number.parseInt(element?.trialCount, 10) || 1), 0);
  const issues = [];
  pages.forEach((page) => {
    if (!(page?.elements || []).length) issues.push({ page: page?.name, issue: 'Page has no questions.' });
  });
  questions.forEach(({ page, element }) => {
    if (!element?.title && !['html', 'expression', 'image'].includes(element?.type)) {
      issues.push({ page, question: element?.name, issue: 'Question has no title.' });
    }
  });
  const consent = questions.some(({ element }) => /consent|同意/i.test(`${element?.name || ''} ${element?.title || ''} ${element?.html || ''}`));
  return {
    summary: `${pages.length} page(s), ${questions.length} question(s), about ${screens} screen(s)`,
    pageCount: pages.length,
    questionCount: questions.length,
    requiredCount: questions.filter(({ element }) => element?.isRequired).length,
    estimatedScreens: screens,
    estimatedMinutes: Math.max(1, Math.round(screens * 0.25)),
    mediaQuestions: questions.filter(({ element }) => mediaTypes.test(String(element?.type || ''))).map(({ element }) => element.name),
    trialQuestions,
    hasConsentText: consent,
    issues: issues.slice(0, 30),
  };
}

function reviewTools({ baseTools, getCandidate }) {
  const byName = new Map(baseTools.map((tool) => [tool.name, tool]));
  const draftTool = byName.get('survey_get_draft');
  const readConfig = async (ctx) => {
    const candidate = getCandidate();
    if (candidate) return candidate;
    const draft = await draftTool.execute({ view: 'full' }, ctx);
    return draft.surveyConfig;
  };
  const tools = [];
  for (const name of ['survey_capabilities', 'survey_validate']) {
    if (byName.has(name)) tools.push(byName.get(name));
  }
  if (draftTool) {
    tools.push({
      ...draftTool,
      async execute(args, ctx) {
        const candidate = getCandidate();
        if (!candidate) return draftTool.execute(args, ctx);
        return {
          summary: 'Proposed revision from the previous review round (not saved)',
          source: 'candidate',
          saved: false,
          surveyConfig: sanitizeForAgent(candidate),
        };
      },
    });
  }
  tools.push({
    name: 'survey_answerability',
    description: 'Check whether every question can be answered and recorded as configured (read-only).',
    minPermission: 'ask',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const contract = evaluateSurveyContract(await readConfig(ctx), { mode: 'compat', strictAll: true });
      return {
        summary: contract.ok ? 'Every question is answerable' : `${contract.errors.length} answerability issue(s)`,
        ok: contract.ok,
        errors: (contract.errors || []).slice(0, 20),
        warnings: (contract.warnings || []).slice(0, 20),
        questionCount: contract.questionCount,
      };
    },
  });
  tools.push({
    name: 'survey_preflight',
    description: 'Participant-flow preflight: screens, trials, required questions, media questions, consent text (read-only).',
    minPermission: 'ask',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      return reviewPreflight(await readConfig(ctx));
    },
  });
  return tools.filter((tool) => REVIEW_READ_TOOLS.includes(tool.name));
}

export function reviewDryRun(surveyConfig, operations) {
  return dryRunRevision(
    (config, ops) => {
      const next = applyOperations(config, normalizeOperationsArg(ops));
      return { ...next, surveyConfig: postProcessAiConfig(next.surveyConfig) };
    },
    (config) => validateSurveyConfig(config, { baseline: surveyConfig, mode: 'adjust' }),
    surveyConfig,
    operations,
  );
}

function tagEmit(emit, review) {
  return (event) => emit({
    ...event,
    payload: { ...(event.payload || {}), review },
  });
}

async function runSubLoop({
  loopConfig,
  registry,
  system,
  user,
  submitTool,
  maxSteps,
  maxTokens,
  emit,
  review,
  checkpoint,
  stepBudget,
  ctx,
  checkCancelled,
}) {
  const startedStep = Number(checkpoint?.step || 0);
  const result = await runToolLoop({
    ...loopConfig,
    maxTokens: Math.min(loopConfig.maxTokens || maxTokens, maxTokens),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    registry,
    ctx,
    onEvent: tagEmit(emit, review),
    maxSteps,
    requireDraftChange: false,
    writeTools: [submitTool],
    terminalTools: [submitTool],
    checkCancelled,
    checkpoint: checkpoint || null,
    stepBudget,
  });
  return { ...result, stepsUsed: Math.max(1, Number(result.steps || 0) - startedStep) };
}

/**
 * User-triggered apply of "review only" proposals. Uses the same apply tool
 * (expectedDraftUpdatedAt concurrency check + validation) and records the
 * write in the session event stream so reloads show which rounds were applied.
 */
export async function applyReviewRevisions({
  events,
  runId,
  rounds = [],
  applyTool,
  appendEvent,
  ctx = {},
}) {
  const review = reviewFromEvents(events, runId);
  const plan = applicableReviewRounds(review, rounds);
  const id = `review_apply_user_${runId}_${plan.rounds.join('-')}_${Date.now().toString(36)}`;
  const args = { expectedDraftUpdatedAt: plan.expectedDraftUpdatedAt, operations: plan.operations };
  const tag = { round: plan.rounds[plan.rounds.length - 1], role: 'apply', rounds: plan.rounds };
  await appendEvent(createEvent('tool.call', redactSecrets({ id, name: applyTool.name, args, review: tag })));
  let result;
  try {
    result = await applyTool.execute(args, { ...ctx, permission: 'edit_draft', toolCallId: id });
  } catch (error) {
    const conflict = isDraftConflictError(error);
    await appendEvent(createEvent('tool.result', redactSecrets({
      id,
      name: applyTool.name,
      ok: false,
      summary: String(error.message || 'failed').slice(0, 300),
      result: { error: error.message, code: conflict ? 'DRAFT_WRITE_CONFLICT' : error.code },
      review: tag,
    })));
    throw Object.assign(error, conflict ? { status: 409, code: 'DRAFT_WRITE_CONFLICT' } : {});
  }
  const { surveyConfig, ...rest } = result || {};
  await appendEvent(createEvent('tool.result', redactSecrets({
    id,
    name: applyTool.name,
    ok: true,
    summary: summarizeToolResult(applyTool.name, result),
    result: rest,
    review: tag,
  })));
  await appendEvent(createEvent('review.applied', {
    rounds: plan.rounds,
    source: 'user',
    draftUpdatedAt: result?.draftUpdatedAt || null,
  }));
  return {
    success: true,
    rounds: plan.rounds,
    surveyConfig,
    draftUpdatedAt: result?.draftUpdatedAt || null,
    expectedDraftUpdatedAt: plan.expectedDraftUpdatedAt,
    inverse: result?.inverse || [],
    validation: result?.validation || null,
  };
}

/**
 * Executes one Review-mode run inside the normal designer run. Returns the
 * runToolLoop result shape so designerChat keeps its checkpoint, verification,
 * finish, and after-run follow-up handling.
 */
export async function runReviewRun({
  loopConfig,
  baseTools,
  applyTool,
  options,
  checkpoint = null,
  stepBudget = Number.POSITIVE_INFINITY,
  tokenBudget = null,
  emit,
  checkCancelled,
  readInbox,
  ctx,
  userRequest,
  researchContext,
  language = '',
  runId = 'run',
}) {
  let candidate = null;
  let latestDraft = checkpoint?.latestDraft || null;
  const successfulTools = [...(checkpoint?.successfulTools || [])];
  const readDraftTool = baseTools.find((tool) => tool.name === 'survey_get_draft');
  const readDraft = async () => {
    const draft = await readDraftTool.execute({ view: 'full' }, { ...ctx, permission: 'ask' });
    return { surveyConfig: draft.surveyConfig, draftUpdatedAt: draft.draftUpdatedAt };
  };
  const emitEvent = (type, payload) => emit(createEvent(type, redactSecrets(payload || {})));

  const roleRegistry = (submit) => createToolRegistry([
    ...reviewTools({ baseTools, getCandidate: () => candidate }),
    submit,
  ]);

  const runRole = async ({ role, round, checkpoint: loopCheckpoint, stepBudget: budget, surveyConfig, surveySource, threshold, ...prompt }) => {
    candidate = surveySource === 'candidate' ? surveyConfig : null;
    let submitted = null;
    const registry = roleRegistry({
      name: REVIEW_SUBMIT_TOOL,
      description: 'Submit your rating and comments for this review round. Call exactly once.',
      minPermission: 'ask',
      executionMode: 'exclusive',
      parameters: REVIEW_SUBMIT_PARAMETERS,
      async execute(args) {
        submitted = parseRoleReview(args, { threshold });
        return { summary: `Review recorded: ${submitted.rating}/10 (${submitted.verdict})`, ...submitted };
      },
    });
    const result = await runSubLoop({
      loopConfig,
      registry,
      system: roleSystemPrompt(role, { method: prompt.method, threshold, language }),
      user: roleUserPrompt({ roleId: role, round, surveyConfig, surveySource, ...prompt }),
      submitTool: REVIEW_SUBMIT_TOOL,
      maxSteps: ROLE_MAX_STEPS,
      maxTokens: ROLE_MAX_TOKENS,
      emit,
      review: { round, role },
      checkpoint: loopCheckpoint,
      stepBudget: budget,
      ctx: { ...ctx, permission: 'ask' },
      checkCancelled,
    }).catch((error) => {
      throw Object.assign(error, { steps: 1 });
    });
    if (result.continuation) {
      return { continuation: true, checkpoint: result.checkpoint, steps: result.stepsUsed, usage: result.usage };
    }
    if (!submitted) {
      const fallback = extractJsonObject(result.content);
      if (fallback) submitted = parseRoleReview(fallback, { threshold });
    }
    if (!submitted) {
      throw Object.assign(new Error(`${role} did not submit a review.`), {
        code: 'REVIEW_NOT_SUBMITTED',
        usage: result.usage,
        steps: result.stepsUsed,
      });
    }
    return { review: submitted, steps: result.stepsUsed, usage: result.usage };
  };

  const runRevision = async ({ round, checkpoint: loopCheckpoint, stepBudget: budget, surveyConfig, surveySource, ...prompt }) => {
    candidate = surveySource === 'candidate' ? surveyConfig : null;
    let submitted = null;
    const registry = roleRegistry({
      name: REVISION_SUBMIT_TOOL,
      description: 'Submit Summary, Planning, and the revision as design-protocol operations. The server dry-runs and validates them.',
      minPermission: 'ask',
      executionMode: 'exclusive',
      parameters: REVISION_SUBMIT_PARAMETERS,
      async execute(args) {
        const parsed = parseRevision(args);
        const checked = reviewDryRun(surveyConfig, parsed.operations);
        if (!checked.ok) {
          throw Object.assign(new Error(checked.error || 'Operations failed validation.'), {
            status: 400,
            code: 'REVISION_INVALID',
            validation: checked.validation,
            retryAction: 'repair_args',
            repairHint: 'Fix the operations so they apply to the current survey and pass validation, then resubmit.',
          });
        }
        submitted = parsed;
        return {
          summary: `Revision recorded: ${parsed.operations.length} operation(s), ${parsed.plan.length} plan step(s)`,
          operationCount: parsed.operations.length,
          validation: checked.validation,
        };
      },
    });
    const result = await runSubLoop({
      loopConfig,
      registry,
      system: revisionSystemPrompt({ language }),
      user: revisionUserPrompt({ round, surveyConfig, surveySource, ...prompt }),
      submitTool: REVISION_SUBMIT_TOOL,
      maxSteps: REVISION_MAX_STEPS,
      maxTokens: REVISION_MAX_TOKENS,
      emit,
      review: { round, role: 'revision' },
      checkpoint: loopCheckpoint,
      stepBudget: budget,
      ctx: { ...ctx, permission: 'ask' },
      checkCancelled,
    });
    if (result.continuation) {
      return { continuation: true, checkpoint: result.checkpoint, steps: result.stepsUsed, usage: result.usage };
    }
    if (!submitted) {
      throw Object.assign(new Error('The revision step did not submit operations.'), {
        code: 'REVISION_NOT_SUBMITTED',
        usage: result.usage,
      });
    }
    return { revision: submitted, steps: result.stepsUsed, usage: result.usage };
  };

  const applyRevision = async ({ round, operations, expectedDraftUpdatedAt }) => {
    const id = `review_apply_${runId}_r${round}`;
    const existing = await ctx?.lookupToolExecution?.(id);
    let result = existing?.status === 'succeeded' ? existing.result : null;
    const args = { expectedDraftUpdatedAt, operations };
    const review = { round, role: 'apply' };
    if (!result) {
      await emit(createEvent('tool.call', redactSecrets({ id, name: applyTool.name, args, review })));
      await ctx?.recordToolExecution?.({ id, name: applyTool.name, status: 'started', result: null });
      try {
        result = await applyTool.execute(args, { ...ctx, permission: 'edit_draft', toolCallId: id });
      } catch (error) {
        await ctx?.recordToolExecution?.({ id, name: applyTool.name, status: 'failed', result: { error: error.message } });
        await emit(createEvent('tool.result', redactSecrets({
          id,
          name: applyTool.name,
          ok: false,
          summary: String(error.message || 'failed').slice(0, 300),
          result: { error: error.message, code: error.code },
          review,
        })));
        throw error;
      }
      await ctx?.recordToolExecution?.({ id, name: applyTool.name, status: 'succeeded', result });
    }
    const { surveyConfig, ...rest } = result || {};
    await emit(createEvent('tool.result', redactSecrets({
      id,
      name: applyTool.name,
      ok: true,
      summary: summarizeToolResult(applyTool.name, result),
      result: rest,
      review,
    })));
    successfulTools.push(applyTool.name);
    latestDraft = { surveyConfig, draftUpdatedAt: result?.draftUpdatedAt || null };
    return latestDraft;
  };

  const outcome = await runReviewOrchestration({
    options,
    state: checkpoint?.review || null,
    readDraft,
    runRole,
    runRevision,
    dryRun: reviewDryRun,
    applyRevision,
    emit: emitEvent,
    checkCancelled,
    readInbox,
    userRequest,
    researchContext,
    stepBudget,
    tokenBudget: tokenBudget ?? ((baseline, normalized) => estimateReviewCost({
      options: normalized,
      surveyConfig: baseline?.surveyConfig,
      cost: loopConfig.modelRecord?.cost || null,
    }).tokenCap),
  });

  const usage = outcome.state.usage;
  if (outcome.status === 'continuation') {
    return {
      content: '',
      usage,
      latestDraft,
      successfulTools,
      continuation: true,
      checkpoint: { review: outcome.state, latestDraft, successfulTools },
    };
  }
  if (outcome.result.status === 'failed') {
    throw Object.assign(new Error(outcome.result.error || 'Every reviewer failed.'), {
      status: 502,
      code: 'REVIEW_FAILED',
    });
  }
  return {
    content: outcome.result.summary,
    usage,
    latestDraft,
    successfulTools,
    review: outcome.result,
  };
}
