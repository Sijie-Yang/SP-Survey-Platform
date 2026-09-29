import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicableReviewRounds,
  estimateReviewCost,
  normalizeReviewOptions,
  parseRoleReview,
  REVIEW_ROLE_IDS,
  reviewFromEvents,
  runReviewOrchestration,
} from './review.mjs';
import { applyReviewRevisions, reviewDryRun, runReviewRun } from './reviewRun.mjs';
import { createEvent, eventsToModelMessages, eventsToUiMessages } from './events.mjs';
import { applyOperations } from '../../designProtocol.mjs';
import { getAssistantModePolicy, applyAssistantModeToTools, ASSISTANT_MODES } from './modes.mjs';

const SURVEY = {
  title: 'Street safety',
  pages: [{
    name: 'p1',
    elements: [
      { type: 'text', name: 'q1', title: 'How safe is this street?' },
      { type: 'comment', name: 'q2', title: 'Why?' },
    ],
  }],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness({
  ratings = {},
  fail = [],
  cancelAfter = Infinity,
  revisionOps = [{ op: 'updateQuestion', pageName: 'p1', questionName: 'q1', patch: { title: 'How safe do you feel on this street?' } }],
  applyError = null,
} = {}) {
  const events = [];
  const calls = [];
  let saved = { surveyConfig: clone(SURVEY), draftUpdatedAt: 't0' };
  let roleCalls = 0;
  const ratingFor = (role, round) => {
    const value = ratings[`${role}:${round}`] ?? ratings[role] ?? 9;
    return typeof value === 'function' ? value() : value;
  };
  return {
    events,
    calls,
    get saved() { return saved; },
    readDraft: async () => clone(saved),
    runRole: async (args) => {
      roleCalls += 1;
      calls.push({ kind: 'role', role: args.role, round: args.round, prior: args.priorTurns.map((turn) => turn.role), source: args.surveySource, title: args.surveyConfig?.pages?.[0]?.elements?.[0]?.title });
      if (fail.includes(args.role)) throw Object.assign(new Error(`${args.role} provider 500`), { code: 'PROVIDER_ERROR' });
      return {
        review: parseRoleReview({ rating: ratingFor(args.role, args.round), verdict: 'revise', comments: `${args.role} comments`, concerns: [{ issue: 'wording', severity: 'high', questions: ['q1'] }] }),
        steps: 2,
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      };
    },
    runRevision: async (args) => {
      calls.push({ kind: 'revision', round: args.round, reviewers: args.reviews.map((item) => item.role) });
      return {
        revision: { summary: `Round ${args.round} summary`, plan: [{ step: 'Reword q1', roles: ['psychologist'], questions: ['q1'] }], operations: revisionOps },
        steps: 1,
        usage: { prompt_tokens: 200, completion_tokens: 50 },
      };
    },
    dryRun: reviewDryRun,
    applyRevision: async ({ operations, expectedDraftUpdatedAt }) => {
      calls.push({ kind: 'apply', expectedDraftUpdatedAt });
      if (applyError) throw applyError;
      if (expectedDraftUpdatedAt !== saved.draftUpdatedAt) {
        throw Object.assign(new Error('Draft changed since it was read'), { status: 409, code: 'CONFLICT' });
      }
      saved = { surveyConfig: applyOperations(saved.surveyConfig, operations).surveyConfig, draftUpdatedAt: `${saved.draftUpdatedAt}+` };
      return clone(saved);
    },
    emit: async (type, payload) => {
      events.push({ type, payload, runId: 'run-1', seq: events.length + 1 });
    },
    checkCancelled: async () => roleCalls >= cancelAfter,
  };
}

function run(h, options, extra = {}) {
  return runReviewOrchestration({
    options,
    readDraft: h.readDraft,
    runRole: h.runRole,
    runRevision: h.runRevision,
    dryRun: h.dryRun,
    applyRevision: h.applyRevision,
    emit: h.emit,
    checkCancelled: h.checkCancelled,
    ...extra,
  });
}

describe('review options and estimate', () => {
  it('defaults to all five roles and caps reviewers', () => {
    const options = normalizeReviewOptions({});
    assert.deepEqual(options.roles, ['scientist', 'participant', 'planner', 'psychologist', 'analyst']);
    assert.equal(options.method, 'linear');
    assert.throws(() => normalizeReviewOptions({ roles: REVIEW_ROLE_IDS, maxRoles: 3 }), /At most 3/);
    assert.throws(() => normalizeReviewOptions({ roles: [] }), /at least one/);
    assert.throws(() => normalizeReviewOptions({ roles: ['judge'] }), /Unknown reviewer/);
    assert.equal(normalizeReviewOptions({ maxRounds: 99, threshold: 0 }).maxRounds, 5);
    assert.equal(normalizeReviewOptions({ maxRounds: 99, threshold: 0 }).threshold, 1);
  });

  it('estimates bounds that grow with roles, rounds, and group discussion', () => {
    const cost = { input: 1, output: 4 };
    const small = estimateReviewCost({ options: { roles: ['scientist'], maxRounds: 1 }, surveyConfig: SURVEY, cost });
    const large = estimateReviewCost({ options: { roles: REVIEW_ROLE_IDS, maxRounds: 3 }, surveyConfig: SURVEY, cost });
    const group = estimateReviewCost({ options: { roles: REVIEW_ROLE_IDS, maxRounds: 3, method: 'group' }, surveyConfig: SURVEY, cost });
    assert.ok(small.tokens.max < large.tokens.max);
    assert.ok(large.tokens.max < group.tokens.max);
    assert.ok(large.tokens.min <= large.tokens.max);
    assert.ok(large.costUsd.max > 0);
    assert.ok(large.tokenCap > large.tokens.max);
    assert.equal(estimateReviewCost({ options: {}, surveyConfig: SURVEY }).costUsd, null);
  });

  it('adds Review as a separate read-only mode without changing the other four', () => {
    assert.deepEqual(ASSISTANT_MODES, ['agent', 'generate', 'adjust', 'question', 'review']);
    const review = getAssistantModePolicy('review', { goalRequiresDraftChange: true });
    assert.equal(review.readOnly, true);
    assert.equal(review.requireDraftChange, false);
    for (const mode of ['agent', 'generate', 'adjust']) {
      assert.equal(getAssistantModePolicy(mode).readOnly, false);
    }
    const tools = applyAssistantModeToTools([
      { name: 'survey_get_draft', minPermission: 'ask' },
      { name: 'survey_apply_operations', minPermission: 'edit_draft', execute() {} },
    ], review);
    assert.deepEqual(tools.map((tool) => tool.name), ['survey_get_draft']);
  });
});

describe('review orchestration', () => {
  it('fans out every role in order and accepts when the average meets the threshold', async () => {
    const h = harness({ ratings: { scientist: 8, participant: 9, analyst: 10 } });
    const outcome = await run(h, { roles: ['scientist', 'participant', 'analyst'], threshold: 8 });
    assert.equal(outcome.result.status, 'accepted');
    assert.equal(outcome.result.finalRating, 9);
    assert.deepEqual(h.calls.map((call) => call.role || call.kind), ['scientist', 'participant', 'analyst']);
    const types = h.events.map((event) => `${event.type}:${event.payload.status || event.payload.role || ''}`);
    assert.equal(types[0], 'review.start:');
    assert.ok(types.includes('review.round:start'));
    assert.equal(types.filter((type) => type === 'review.role:start').length, 3);
    assert.equal(types.at(-1), 'review.result:accepted');
    assert.equal(h.saved.draftUpdatedAt, 't0');
  });

  it('passes earlier turns to later roles in group discussion only', async () => {
    const linear = harness();
    await run(linear, { roles: ['scientist', 'participant', 'planner'] });
    assert.deepEqual(linear.calls.map((call) => call.prior), [[], [], []]);
    const group = harness();
    await run(group, { roles: ['scientist', 'participant', 'planner'], method: 'group' });
    assert.deepEqual(group.calls.map((call) => call.prior), [[], ['scientist'], ['scientist', 'participant']]);
  });

  it('records one failing reviewer and still runs the rest', async () => {
    const h = harness({ fail: ['participant'], ratings: { scientist: 9, planner: 9 } });
    const outcome = await run(h, { roles: ['scientist', 'participant', 'planner'], threshold: 8 });
    assert.equal(outcome.result.status, 'accepted');
    const roleEnds = h.events.filter((event) => event.type === 'review.role' && event.payload.status !== 'start');
    assert.deepEqual(roleEnds.map((event) => `${event.payload.role}:${event.payload.status}`), [
      'scientist:completed',
      'participant:failed',
      'planner:completed',
    ]);
    assert.match(roleEnds[1].payload.error, /provider 500/);
  });

  it('fails the run only when every reviewer fails', async () => {
    const h = harness({ fail: ['scientist', 'participant'] });
    const outcome = await run(h, { roles: ['scientist', 'participant'] });
    assert.equal(outcome.result.status, 'failed');
  });

  it('stops at the next cancellation check without running later roles', async () => {
    const h = harness({ cancelAfter: 2 });
    await assert.rejects(run(h, { roles: REVIEW_ROLE_IDS }), (error) => error.code === 'CANCELLED');
    assert.deepEqual(h.calls.map((call) => call.role), ['scientist', 'participant']);
    assert.equal(h.events.some((event) => event.type === 'review.result'), false);
  });

  it('review-only mode proposes a revision and re-reviews the unsaved candidate', async () => {
    const h = harness({ ratings: { 'scientist:1': 5, 'scientist:2': 9 } });
    const outcome = await run(h, { roles: ['scientist'], maxRounds: 3, threshold: 8, applyMode: 'review' });
    assert.equal(outcome.result.status, 'accepted');
    assert.equal(outcome.result.rounds, 2);
    assert.deepEqual(outcome.result.pendingRounds, [1]);
    const round2 = h.calls.find((call) => call.kind === 'role' && call.round === 2);
    assert.equal(round2.source, 'candidate');
    assert.equal(round2.title, 'How safe do you feel on this street?');
    assert.equal(h.calls.some((call) => call.kind === 'apply'), false);
    assert.equal(h.saved.draftUpdatedAt, 't0');
  });

  it('apply-each-round mode saves through the apply path with the round baseline', async () => {
    const h = harness({ ratings: { 'scientist:1': 5, 'scientist:2': 6 } });
    const outcome = await run(h, { roles: ['scientist'], maxRounds: 2, applyMode: 'apply' });
    assert.equal(outcome.result.status, 'max_rounds');
    assert.deepEqual(h.calls.filter((call) => call.kind === 'apply').map((call) => call.expectedDraftUpdatedAt), ['t0', 't0+']);
    assert.deepEqual(outcome.result.appliedRounds, [1, 2]);
    assert.equal(h.saved.surveyConfig.pages[0].elements[0].title, 'How safe do you feel on this street?');
  });

  it('stops with a conflict when the draft changes under an apply-each-round review', async () => {
    const conflict = Object.assign(new Error('Draft changed since it was read'), { status: 409, code: 'CONFLICT' });
    const h = harness({ ratings: { scientist: 4 }, applyError: conflict });
    const outcome = await run(h, { roles: ['scientist'], maxRounds: 2, applyMode: 'apply' });
    assert.equal(outcome.result.status, 'conflict');
    const revision = h.events.filter((event) => event.type === 'review.revision').at(-1);
    assert.equal(revision.payload.code, 'DRAFT_WRITE_CONFLICT');
  });

  it('rejects revisions that fail validation instead of reviewing them', async () => {
    const h = harness({ ratings: { scientist: 4 }, revisionOps: [{ op: 'removeQuestion', questionName: 'missing' }] });
    const outcome = await run(h, { roles: ['scientist'], maxRounds: 3 });
    assert.equal(outcome.result.status, 'revision_invalid');
    assert.equal(h.calls.filter((call) => call.kind === 'role').length, 1);
  });

  it('checkpoints across step budgets and resumes from serialized state', async () => {
    const h = harness({ ratings: { 'scientist:1': 5, 'participant:1': 5 } });
    const options = { roles: ['scientist', 'participant'], maxRounds: 2 };
    let outcome = await run(h, options, { stepBudget: 3 });
    let deliveries = 1;
    while (outcome.status === 'continuation') {
      outcome = await run(h, options, { state: JSON.parse(JSON.stringify(outcome.state)), stepBudget: 3 });
      deliveries += 1;
    }
    assert.ok(deliveries > 1);
    assert.equal(outcome.result.status, 'accepted');
    assert.equal(h.events.filter((event) => event.type === 'review.start').length, 1);
    assert.deepEqual(h.calls.map((call) => call.role || call.kind), ['scientist', 'participant', 'revision', 'scientist', 'participant']);
  });

  it('stops when the token cap is exceeded', async () => {
    const h = harness({ ratings: { scientist: 3 } });
    const outcome = await run(h, { roles: ['scientist'], maxRounds: 5 }, { tokenBudget: 150 });
    assert.equal(outcome.result.status, 'budget_exhausted');
  });

  it('feeds steering messages into later reviewers', async () => {
    const h = harness();
    const seen = [];
    let delivered = false;
    await run(h, { roles: ['scientist', 'participant'] }, {
      runRole: async (args) => {
        seen.push(args.steering.slice());
        return h.runRole(args);
      },
      readInbox: async () => {
        if (delivered) return [];
        delivered = true;
        return [{ id: 'i1', content: 'Focus on consent' }];
      },
    });
    assert.deepEqual(seen, [['Focus on consent'], ['Focus on consent']]);
    assert.ok(h.events.some((event) => event.type === 'steering.message'));
  });
});

describe('review apply, undo, and projection', () => {
  async function proposedEvents() {
    const h = harness({ ratings: { 'scientist:1': 5, 'scientist:2': 5 } });
    await run(h, { roles: ['scientist'], maxRounds: 2, applyMode: 'review' });
    return { h, events: h.events.map((event) => ({ ...event, run_id: 'run-1' })) };
  }

  it('applies proposals in order through the apply tool and supports undo via inverse operations', async () => {
    const { events } = await proposedEvents();
    const review = reviewFromEvents(events, 'run-1');
    assert.equal(review.rounds.length, 2);
    assert.throws(() => applicableReviewRounds(review, [2]), (error) => error.code === 'REVIEW_APPLY_ORDER');

    let draft = { surveyConfig: clone(SURVEY), draftUpdatedAt: 't0' };
    const appended = [];
    const applyTool = {
      name: 'survey_apply_operations',
      async execute(args) {
        if (args.expectedDraftUpdatedAt !== draft.draftUpdatedAt) {
          throw Object.assign(new Error('Draft changed'), { status: 409, code: 'CONFLICT' });
        }
        const next = applyOperations(draft.surveyConfig, args.operations);
        draft = { surveyConfig: next.surveyConfig, draftUpdatedAt: 't1' };
        return { ...draft, inverse: next.inverse, applied: next.applied };
      },
    };
    const result = await applyReviewRevisions({
      events,
      runId: 'run-1',
      rounds: [1],
      applyTool,
      appendEvent: async (event) => { appended.push({ ...event, run_id: 'run-1' }); },
    });
    assert.deepEqual(result.rounds, [1]);
    assert.equal(result.expectedDraftUpdatedAt, 't0');
    assert.equal(draft.surveyConfig.pages[0].elements[0].title, 'How safe do you feel on this street?');
    const undone = applyOperations(draft.surveyConfig, result.inverse).surveyConfig;
    assert.deepEqual(undone, SURVEY);

    const after = reviewFromEvents([...events, ...appended], 'run-1');
    assert.deepEqual(after.applied, [1]);
    assert.equal(after.lastAppliedDraftUpdatedAt, 't1');
    const next = applicableReviewRounds(after, [2]);
    assert.equal(next.expectedDraftUpdatedAt, 't1');
  });

  it('returns a 409 conflict and records the failed write when the draft changed after review', async () => {
    const { events } = await proposedEvents();
    const appended = [];
    const applyTool = {
      name: 'survey_apply_operations',
      async execute() {
        throw Object.assign(new Error('Draft changed since it was read'), { status: 409, code: 'CONFLICT' });
      },
    };
    await assert.rejects(applyReviewRevisions({
      events,
      runId: 'run-1',
      applyTool,
      appendEvent: async (event) => { appended.push(event); },
    }), (error) => error.status === 409 && error.code === 'DRAFT_WRITE_CONFLICT');
    assert.equal(appended.at(-1).type, 'tool.result');
    assert.equal(appended.at(-1).payload.ok, false);
    assert.equal(appended.some((event) => event.type === 'review.applied'), false);
  });

  it('marks a cancelled review card as cancelled instead of running', () => {
    const stream = [
      { type: 'review.start', payload: { options: { roles: ['scientist', 'participant'] } }, run_id: 'run-9', seq: 1 },
      { type: 'review.round', payload: { round: 1, status: 'start' }, run_id: 'run-9', seq: 2 },
      { type: 'review.role', payload: { round: 1, role: 'scientist', status: 'completed', rating: 7 }, run_id: 'run-9', seq: 3 },
      { type: 'review.role', payload: { round: 1, role: 'participant', status: 'start' }, run_id: 'run-9', seq: 4 },
      { type: 'run.status', payload: { status: 'cancelled' }, run_id: 'run-9', seq: 5 },
    ];
    const card = eventsToUiMessages(stream).find((message) => message.metadata?.review);
    assert.equal(card.metadata.review.status, 'cancelled');
    assert.equal(card.metadata.review.rounds[0].reviews[1].status, 'cancelled');
    assert.equal(card.metadata.review.active, null);
  });

  it('projects a persistent review card and keeps reviewer text out of chat and model history', async () => {
    const { events } = await proposedEvents();
    const stream = [
      { type: 'user.message', payload: { content: 'Review this', assistantMode: 'review' }, run_id: 'run-1', seq: 0 },
      events[0],
      { type: 'tool.call', payload: { id: 'c1', name: 'survey_get_draft', review: { round: 1, role: 'scientist' } }, run_id: 'run-1' },
      { type: 'tool.result', payload: { id: 'c1', name: 'survey_get_draft', ok: true, review: { round: 1, role: 'scientist' } }, run_id: 'run-1' },
      { type: 'assistant.message', payload: { content: 'reviewer private text', review: { round: 1, role: 'scientist' } }, run_id: 'run-1' },
      ...events.slice(1),
      { type: 'run.status', payload: { status: 'completed' }, run_id: 'run-1' },
    ];
    const messages = eventsToUiMessages(stream);
    const card = messages.find((message) => message.metadata?.review);
    assert.ok(card);
    assert.equal(card.metadata.review.rounds.length, 2);
    assert.equal(card.metadata.review.status, 'max_rounds');
    assert.equal(card.tools[0].review.role, 'scientist');
    assert.doesNotMatch(JSON.stringify(messages), /reviewer private text/);
    const history = eventsToModelMessages(stream);
    assert.doesNotMatch(JSON.stringify(history), /reviewer private text/);
    assert.match(history.at(-1).content, /Review \(linear individual review\)/);
  });
});

function sseToolCall(name, args, id = `call_${Math.random().toString(36).slice(2)}`) {
  return new Response([
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })}`,
    'data: [DONE]',
    '',
  ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('review run on the real tool loop', () => {
  it('runs reviewers as harness sub-runs with read-only tools and tagged events', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let draft = { surveyConfig: clone(SURVEY), draftUpdatedAt: 't0' };
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const tools = (body.tools || []).map((tool) => tool.function?.name);
      if (tools.includes('review_submit_revision')) {
        return sseToolCall('review_submit_revision', {
          summary: 'Clarify q1',
          plan: [{ step: 'Reword q1', roles: ['psychologist'], questions: ['q1'] }],
          operations: [{ op: 'updateQuestion', pageName: 'p1', questionName: 'q1', patch: { title: 'Clearer' } }],
        });
      }
      const system = body.messages[0].content;
      if (/Participant on an SP-Survey review panel/.test(system)) {
        return new Response('upstream error', { status: 400 });
      }
      const round = /Review round (\d+)/.exec(body.messages.at(-1)?.content || '')?.[1]
        || /Review round (\d+)/.exec(JSON.stringify(body.messages))?.[1];
      return sseToolCall('review_submit', { rating: round === '2' ? 9 : 6, verdict: 'revise', comments: 'ok', concerns: [] });
    };
    const events = [];
    const baseTools = [
      { name: 'survey_capabilities', minPermission: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({ summary: 'caps' }) },
      { name: 'survey_get_draft', minPermission: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => clone(draft) },
      { name: 'survey_validate', minPermission: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({ summary: 'valid' }) },
      { name: 'survey_apply_operations', minPermission: 'edit_draft', parameters: { type: 'object', properties: {} }, execute: async () => { throw new Error('reviewers must not write'); } },
    ];
    try {
      const result = await runReviewRun({
        loopConfig: {
          apiKey: 'test-key',
          provider: 'openai',
          baseUrl: 'https://api.example.test/v1',
          model: 'gpt-test',
          modelRecord: { id: 'gpt-test', contextWindow: 128000, maxTokens: 4096, cost: { input: 1, output: 2 } },
          protocol: 'openai-completions',
          compat: {},
          retryPolicy: { maxRetries: 0 },
          temperature: 0.2,
          maxTokens: 4096,
        },
        baseTools,
        applyTool: {
          name: 'survey_apply_operations',
          async execute(args) {
            draft = { surveyConfig: applyOperations(draft.surveyConfig, args.operations).surveyConfig, draftUpdatedAt: 't1' };
            return clone(draft);
          },
        },
        options: { roles: ['scientist', 'participant'], maxRounds: 2, applyMode: 'review' },
        emit: async (event) => { events.push(event); },
        checkCancelled: async () => false,
        ctx: {},
        userRequest: 'Review this survey',
      });
      assert.equal(result.review.status, 'accepted');
      assert.match(result.content, /Accepted/);
      assert.equal(result.latestDraft, null);
      const advertised = new Set(requests.flatMap((body) => (body.tools || []).map((tool) => tool.function?.name)));
      assert.equal(advertised.has('survey_apply_operations'), false);
      assert.ok(advertised.has('survey_answerability'));
      assert.ok(advertised.has('survey_preflight'));
      const failed = events.find((event) => event.type === 'review.role' && event.payload.status === 'failed');
      assert.equal(failed.payload.role, 'participant');
      const tagged = events.filter((event) => event.type === 'tool.call');
      assert.ok(tagged.length >= 3);
      assert.ok(tagged.every((event) => event.payload.review?.round));
      assert.equal(draft.draftUpdatedAt, 't0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reuses createEvent types for every review event', () => {
    for (const type of ['review.start', 'review.round', 'review.role', 'review.revision', 'review.applied', 'review.result']) {
      assert.equal(createEvent(type, {}).type, type);
    }
  });
});
