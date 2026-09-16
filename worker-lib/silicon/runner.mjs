import { supabaseRest, rpc } from '../supabaseUserClient.mjs';
import { chatCompletions, assertVisionModel } from '../agent/runtime/providers.mjs';
import { listProviderProfiles, loadProviderCredential } from '../agent/credentials.mjs';
import { resolveModel, resolveModelRoute, resolveProvider } from '../agent/runtime/registry.mjs';
import { dispatchAgentRun } from '../agent/runtime/runDispatcher.mjs';
import { assignMediaForSurvey, diagnoseMissingMedia, questionNeedsShownMedia, questionWithShownMedia } from './mediaAssign.mjs';
import {
  classifyQuestion,
  collectQuestions,
  siliconAnswerContract,
  validateInnerSiliconAnswer,
  validateSiliconAnswer,
} from './answerValidate.mjs';
import {
  buildExecutionPlan,
  countsFromUnits,
  isTerminalUnitStatus,
  trialCountOf,
  unitKey,
} from './executionPlan.mjs';

const ACTIVE_RUN_STATUSES = ['queued', 'draft', 'running'];
const TERMINAL_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed', 'partial']);
const LEASE_SECONDS = 180;

async function getRun(env, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&select=*`,
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export function siliconProgressStatuses() {
  return ACTIVE_RUN_STATUSES;
}

export function isSiliconJob(job) {
  return job?.kind === 'silicon' && Boolean(job?.runId);
}

function isMissingLeaseSchema(error) {
  return /does not exist|schema cache|PGRST202|404|could not find the function/i.test(String(error?.message || error || ''));
}

export function newSiliconClaimedBy(runId) {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `queue:${runId}:${nonce}`;
}

function leaseUnavailable(message = 'Silicon background leases are not applied') {
  return Object.assign(new Error(message), {
    status: 503,
    code: 'SILICON_LEASE_UNAVAILABLE',
    retryable: false,
  });
}

export async function requireSiliconBackgroundSchema(env) {
  try {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_units',
      serviceRole: true,
      query: '?select=id&limit=1',
    });
  } catch (error) {
    if (isMissingLeaseSchema(error)) throw leaseUnavailable();
    throw error;
  }
  try {
    await rpc(env, 'claim_silicon_run', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
      p_claimed_by: 'schema-probe',
      p_lease_seconds: 30,
    }, null, { serviceRole: true });
  } catch (error) {
    if (isMissingLeaseSchema(error)) throw leaseUnavailable();
  }
  return true;
}

async function patchRun(env, runId, patch, { requireActive = true, claimedBy = null } = {}) {
  const statusFilter = requireActive
    ? `&status=in.(${ACTIVE_RUN_STATUSES.join(',')})`
    : '';
  const ownerFilter = claimedBy ? `&claimed_by=eq.${encodeURIComponent(claimedBy)}` : '';
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}${statusFilter}${ownerFilter}`,
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (claimedBy && !row?.id) {
    throw Object.assign(new Error('Silicon run lease was lost before this write'), {
      code: 'SILICON_LEASE_LOST',
      retryable: false,
    });
  }
  return row;
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] || null : (value || null);
}

export async function listSiliconUnits(env, runId, run = null) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_units',
      serviceRole: true,
      query: `?run_id=eq.${encodeURIComponent(runId)}&select=*&order=repeat_index.asc,question_name.asc,trial_index.asc`,
    });
    if (Array.isArray(rows) && rows.length) return rows;
  } catch {
    // Table may not exist until silicon_background_runs.sql is applied.
  }
  return synthesizeUnitsFromPlan(env, run || await getRun(env, runId));
}

async function listSiliconEvents(env, runId) {
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_events',
      serviceRole: true,
      query: `?run_id=eq.${encodeURIComponent(runId)}&select=id,type,question_name,payload&order=id.asc`,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function synthesizeUnitsFromPlan(env, run) {
  if (!run) return [];
  const plan = Array.isArray(run.execution_plan?.units) && run.execution_plan.units.length
    ? run.execution_plan
    : buildExecutionPlan(run);
  const events = await listSiliconEvents(env, run.id);
  const statusByKey = new Map();
  const extrasByKey = new Map();
  for (const event of events) {
    const key = event.payload?.unit_key || unitKey({
      persona_id: event.payload?.persona_id,
      repeat_index: event.payload?.repeat_index,
      question_name: event.question_name,
      trial_index: event.payload?.trial_index,
    });
    if (event.type === 'unit.saved') statusByKey.set(key, 'saved');
    else if (event.type === 'unit.skip') statusByKey.set(key, 'skipped');
    else if (event.type === 'validate.fail' && event.payload?.unknown) statusByKey.set(key, 'unknown');
    else if (event.type === 'validate.fail' && !statusByKey.has(key)) statusByKey.set(key, 'failed');
    const extra = extrasByKey.get(key) || {};
    if (Array.isArray(event.payload?.images) && event.payload.images.length) extra.images = event.payload.images;
    if (event.payload?.answer !== undefined) extra.answer = event.payload.answer;
    if (event.payload?.rationale) extra.rationale = event.payload.rationale;
    if (event.payload?.error) extra.error = event.payload.error;
    extrasByKey.set(key, extra);
  }
  return (plan.units || []).map((unit) => ({
    ...unit,
    run_id: run.id,
    status: statusByKey.get(unitKey(unit)) || 'pending',
    ...(extrasByKey.get(unitKey(unit)) || {}),
  }));
}

export async function materializeSiliconUnits(env, run) {
  const plan = buildExecutionPlan(run);
  if (!plan.units.length) return plan;
  const body = plan.units.map((unit) => ({
    run_id: run.id,
    persona_id: unit.persona_id,
    repeat_index: unit.repeat_index,
    question_name: unit.question_name,
    trial_index: unit.trial_index,
    status: 'pending',
  }));
  try {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_units',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });
  } catch (error) {
    if (isMissingLeaseSchema(error)) throw leaseUnavailable();
    throw error;
  }
  return plan;
}

async function expireStaleUnits(env, runId) {
  try {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_units',
      method: 'PATCH',
      serviceRole: true,
      query: `?run_id=eq.${encodeURIComponent(runId)}&status=eq.leased&lease_expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,
      body: {
        status: 'unknown',
        error: 'Lease expired before the model result was saved',
        updated_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    });
  } catch {
    return;
  }
}

async function claimSiliconRun(env, runId, claimedBy, leaseSeconds = LEASE_SECONDS) {
  let claimed;
  try {
    claimed = await rpc(env, 'claim_silicon_run', {
      p_run_id: runId,
      p_claimed_by: claimedBy,
      p_lease_seconds: leaseSeconds,
    }, null, { serviceRole: true });
  } catch (error) {
    if (isMissingLeaseSchema(error)) throw leaseUnavailable();
    throw error;
  }
  return firstRow(claimed);
}

async function claimSiliconUnit(env, runId, claimedBy, leaseSeconds = LEASE_SECONDS) {
  let claimed;
  try {
    claimed = await rpc(env, 'claim_silicon_unit', {
      p_run_id: runId,
      p_claimed_by: claimedBy,
      p_lease_seconds: leaseSeconds,
    }, null, { serviceRole: true });
  } catch (error) {
    if (isMissingLeaseSchema(error)) throw leaseUnavailable();
    throw error;
  }
  const row = firstRow(claimed);
  return row?.id ? row : null;
}

export async function patchSiliconUnit(env, unitId, patch, options) {
  return patchUnit(env, unitId, patch, options);
}

async function patchUnit(env, unitId, patch, { claimedBy = null } = {}) {
  if (!unitId) return null;
  const ownerFilter = claimedBy ? `&lease_owner=eq.${encodeURIComponent(claimedBy)}` : '';
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_answer_units',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(unitId)}${ownerFilter}`,
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  const row = firstRow(rows);
  if (claimedBy && !row?.id) {
    throw Object.assign(new Error('Silicon unit lease was lost before this write'), {
      code: 'SILICON_LEASE_LOST',
      retryable: false,
    });
  }
  return row;
}

export async function appendSiliconEvent(env, {
  runId,
  responseId = null,
  questionName = null,
  type,
  payload = {},
}) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_answer_events',
    method: 'POST',
    serviceRole: true,
    body: {
      run_id: runId,
      response_id: responseId,
      question_name: questionName,
      type,
      payload,
    },
    prefer: 'return=representation',
  });
  return firstRow(rows);
}

async function setStage(env, runId, stage, claimedBy = null) {
  try {
    await patchRun(env, runId, { current_stage: stage || {} }, { claimedBy });
  } catch (error) {
    if (error?.code === 'SILICON_LEASE_LOST') throw error;
  }
}

async function persistCounts(env, runId, claimedBy = null) {
  const units = await listSiliconUnits(env, runId);
  if (!units.length) return null;
  const counts = countsFromUnits(units);
  try {
    await patchRun(env, runId, {
      progress_done: counts.processed,
      progress_processed: counts.processed,
      progress_valid: counts.valid,
      progress_failed: counts.failed,
      progress_total: counts.total,
    }, { requireActive: false, claimedBy });
  } catch (error) {
    if (error?.code === 'SILICON_LEASE_LOST') throw error;
    await patchRun(env, runId, { progress_done: counts.processed }, { requireActive: false, claimedBy }).catch((retryError) => {
      if (retryError?.code === 'SILICON_LEASE_LOST') throw retryError;
      return null;
    });
  }
  return counts;
}

function mediaPool(run) {
  const snapshot = run.media_snapshot;
  if (Array.isArray(snapshot)) return snapshot;
  return snapshot?.images || [];
}

function mediaDataset(run) {
  const snapshot = run.media_snapshot;
  if (snapshot && !Array.isArray(snapshot)) return snapshot.dataset || {};
  return {};
}

function personaFromRun(run, personaId) {
  const frozen = Array.isArray(run.persona_snapshot)
    ? run.persona_snapshot.find((row) => row.id === personaId)
    : null;
  return frozen || null;
}

function questionFromRun(run, name) {
  return collectQuestions(run.survey_snapshot || {}, run.question_names)
    .find((item) => item.name === name) || null;
}

async function ensureResponseRow(env, run, { personaId, repeat }) {
  const existing = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(run.id)}`
      + `&persona_id=eq.${encodeURIComponent(personaId)}`
      + `&repeat_index=eq.${encodeURIComponent(repeat)}`
      + '&select=*&limit=1',
  });
  const row = firstRow(existing);
  if (row) return row;
  const participantId = `silicon_${String(personaId).slice(0, 8)}_${repeat}`;
  const inserted = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    method: 'POST',
    serviceRole: true,
    body: {
      run_id: run.id,
      project_id: run.project_id,
      persona_id: personaId,
      repeat_index: repeat,
      participant_id: participantId,
      responses: {},
      displayed_images: {},
      survey_metadata: {
        claimed: true,
        response_source: 'silicon',
        silicon_run_id: run.id,
        persona_id: personaId,
        persona_name: personaFromRun(run, personaId)?.name || null,
        model: run.model,
        provider: run.provider,
        seed: `${run.seed}:${personaId}:${repeat}`,
        source_kind: run.source_kind || 'draft',
        draft_updated_at: run.draft_updated_at || null,
        runtime_version: run.runtime_version || null,
        profile_revision: run.profile_revision || null,
        practice_mode: false,
      },
      status: 'claimed',
    },
    prefer: 'return=representation,resolution=ignore-duplicates',
  });
  const created = firstRow(inserted);
  if (created?.id) return created;
  const retry = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(run.id)}`
      + `&persona_id=eq.${encodeURIComponent(personaId)}`
      + `&repeat_index=eq.${encodeURIComponent(repeat)}`
      + '&select=*&limit=1',
  });
  return firstRow(retry);
}

function envelopeStatus(responses = {}, units = []) {
  const relevant = units.filter((unit) => ['saved', 'skipped', 'failed'].includes(unit.status));
  if (!relevant.length) return 'claimed';
  if (relevant.every((unit) => unit.status === 'saved') && Object.keys(responses).length) return 'ok';
  if (relevant.every((unit) => unit.status === 'skipped' || unit.status === 'failed')) {
    return Object.keys(responses).length ? 'partial' : 'skipped';
  }
  return 'partial';
}

async function persistUnitOnResponse(env, run, unit, { answer, images, error }) {
  const envelope = await ensureResponseRow(env, run, {
    personaId: unit.persona_id,
    repeat: unit.repeat_index,
  });
  const question = questionFromRun(run, unit.question_name);
  const responses = { ...(envelope.responses || {}) };
  const displayed = { ...(envelope.displayed_images || {}) };
  const trialCount = Math.max(1, trialCountOf(question || {}));
  const shown = Array.isArray(displayed[unit.question_name]) ? displayed[unit.question_name] : [];
  if (trialCount > 1) {
    const sets = Array.isArray(shown?.[0]) || shown.length === 0 ? [...(Array.isArray(shown) ? shown : [])] : [shown];
    while (sets.length < trialCount) sets.push([]);
    sets[unit.trial_index - 1] = images || [];
    displayed[unit.question_name] = sets;
    const current = responses[unit.question_name];
    const trials = Array.isArray(current?.trials) ? [...current.trials] : [];
    if (answer !== undefined) {
      trials[unit.trial_index - 1] = { answer, value: answer, shown_images: images || [] };
    }
    if (trials.filter(Boolean).length >= trialCount && question) {
      const wrapped = validateSiliconAnswer(question, { trials });
      responses[unit.question_name] = wrapped.ok ? wrapped.answer : { trials, error: wrapped.reason || error };
    } else if (answer !== undefined) {
      responses[unit.question_name] = { trials, pending: true };
    }
  } else {
    displayed[unit.question_name] = images || [];
    if (answer !== undefined) responses[unit.question_name] = answer;
  }
  const units = await listSiliconUnits(env, run.id);
  const personaUnits = units.filter((item) => (
    item.persona_id === unit.persona_id && Number(item.repeat_index) === Number(unit.repeat_index)
  ));
  const payload = {
    responses,
    displayed_images: displayed,
    status: envelopeStatus(responses, personaUnits.map((item) => (
      item.id === unit.id ? { ...item, status: unit.status } : item
    ))),
  };
  const updated = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(envelope.id)}`,
    body: payload,
    prefer: 'return=representation',
  });
  return firstRow(updated) || envelope;
}

async function interactiveBusy(env, userId, provider) {
  if (!userId) return false;
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_runs',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&status=eq.running&select=id,provider,claimed_by,lease_expires_at&limit=8`,
    });
    return (rows || []).some((row) => {
      if (provider && row.provider && row.provider !== provider) return false;
      if (row.lease_expires_at && Date.parse(row.lease_expires_at) <= Date.now()) return false;
      return true;
    });
  } catch {
    return false;
  }
}

async function otherSiliconLease(env, userId, runId) {
  if (!userId) return false;
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&status=eq.running&id=neq.${encodeURIComponent(runId)}&select=id,claimed_by,lease_expires_at`,
    });
    return (rows || []).some((row) => (
      row.claimed_by && row.lease_expires_at && Date.parse(row.lease_expires_at) > Date.now()
    ));
  } catch {
    return false;
  }
}

export async function dispatchSiliconRun(env, ctx, {
  runId,
  userId,
  disableRedispatch = false,
  delaySeconds = 0,
  claimedBy = null,
} = {}) {
  if (!runId) return { dispatch: 'skipped' };
  return dispatchAgentRun(env, ctx, {
    kind: 'silicon',
    runId,
    userId,
    disableRedispatch,
    claimedBy: claimedBy || newSiliconClaimedBy(runId),
  }, { delaySeconds });
}

export async function recoverSiliconRuns(env, ctx, { userId } = {}) {
  const now = Date.now();
  const userFilter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : '';
  let expired = [];
  try {
    expired = await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      serviceRole: true,
      query: `?status=in.(queued,running)${userFilter}&lease_expires_at=lt.${encodeURIComponent(new Date(now).toISOString())}&select=id,user_id,status,lease_expires_at,cancel_requested,updated_at&limit=20`,
    });
  } catch {
    expired = [];
  }
  let staleQueued = [];
  try {
    staleQueued = await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      serviceRole: true,
      query: `?status=eq.queued${userFilter}&updated_at=lt.${encodeURIComponent(new Date(now - 30_000).toISOString())}&select=id,user_id,status,cancel_requested,updated_at&limit=10`,
    });
  } catch {
    staleQueued = [];
  }
  const seen = new Set();
  const recovered = [];
  for (const run of [...(expired || []), ...(staleQueued || [])]) {
    if (!run?.id || seen.has(run.id) || run.cancel_requested) continue;
    seen.add(run.id);
    await dispatchSiliconRun(env, ctx, { runId: run.id, userId: run.user_id });
    recovered.push(run.id);
  }
  return { recovered };
}

async function finalizeRun(env, run, { status, error } = {}) {
  const units = await listSiliconUnits(env, run.id);
  const counts = units.length ? countsFromUnits(units) : null;
  const next = status || (run.cancel_requested
    ? 'cancelled'
    : (counts && counts.processed >= counts.total
      ? (counts.valid === 0 && counts.failed + counts.skipped > 0 ? 'failed' : 'completed')
      : null));
  if (!next) return { finished: false, status: run.status, counts };
  const finishedAt = new Date().toISOString();
  const firstUnitError = (units || []).find((unit) => unit.error)?.error;
  const summary = error
    || (next === 'failed' && counts?.valid === 0
      ? (firstUnitError || 'No usable images resolved')
      : null);
  try {
    await patchRun(env, run.id, {
      status: next,
      finished_at: finishedAt,
      current_stage: { phase: next, started_at: finishedAt },
      ...(summary ? { error_summary: String(summary).slice(0, 400) } : {}),
      ...(counts ? {
        progress_done: counts.processed,
        progress_processed: counts.processed,
        progress_valid: counts.valid,
        progress_failed: counts.failed,
        progress_total: counts.total,
      } : {}),
    }, { requireActive: false });
  } catch {
    await patchRun(env, run.id, {
      status: next,
      finished_at: finishedAt,
      ...(summary ? { error_summary: String(summary).slice(0, 400) } : {}),
    }, { requireActive: false }).catch(() => null);
  }
  await appendSiliconEvent(env, {
    runId: run.id,
    type: next === 'cancelled' ? 'run.stopping' : (next === 'failed' ? 'run.failed' : 'run.complete'),
    payload: { status: next, counts },
  }).catch(() => null);
  return { finished: true, status: next, counts };
}

async function processClaimedUnit(env, run, unit, cred, claimedBy = null) {
  if (claimedBy) unit.lease_owner = claimedBy;
  const question = questionFromRun(run, unit.question_name);
  const persona = personaFromRun(run, unit.persona_id);
  const envelope = await ensureResponseRow(env, run, {
    personaId: unit.persona_id,
    repeat: unit.repeat_index,
  });
  const stageBase = {
    persona_id: unit.persona_id,
    persona_name: persona?.name || null,
    repeat_index: unit.repeat_index,
    question_name: unit.question_name,
    question_title: question?.title || unit.question_name,
    trial_index: unit.trial_index,
    trial_count: Math.max(1, trialCountOf(question || {})),
    started_at: new Date().toISOString(),
  };

  if (unit.status === 'saved' || unit.status === 'skipped'
    || (isTerminalUnitStatus(unit.status) && unit.status !== 'leased' && unit.status !== 'unknown')) {
    return { skippedExisting: true };
  }

  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: envelope.id,
    questionName: unit.question_name,
    type: unit.status === 'unknown' ? 'retry' : 'unit.start',
    payload: { ...stageBase, unit_key: unitKey(unit) },
  });

  const latest = await getRun(env, run.id);
  if (latest?.cancel_requested || latest?.status === 'cancelled') {
    await appendSiliconEvent(env, {
      runId: run.id,
      responseId: envelope.id,
      questionName: unit.question_name,
      type: 'run.stopping',
      payload: stageBase,
    });
    await patchUnit(env, unit.id, { status: 'pending', lease_owner: null, lease_expires_at: null }, { claimedBy });
    return { cancelled: true };
  }

  if (!question) {
    await finishUnit(env, run, unit, envelope, {
      status: 'skipped',
      error: 'Question missing from frozen snapshot',
      stage: stageBase,
    });
    return { skipped: true };
  }

  const kind = classifyQuestion(question);
  if (!kind.supported) {
    await finishUnit(env, run, unit, envelope, {
      status: 'skipped',
      error: kind.reason,
      stage: stageBase,
    });
    return { skipped: true };
  }

  const seed = `${run.seed}:${unit.persona_id}:${unit.repeat_index}`;
  const assigned = assignMediaForSurvey({
    surveyConfig: run.survey_snapshot || {},
    pool: mediaPool(run),
    seed,
    dataset: mediaDataset(run),
    questionNames: [question.name],
  });
  const raw = assigned[question.name];
  const trialSets = Array.isArray(raw?.[0]) ? raw : [raw || []];
  const images = trialSets[unit.trial_index - 1] || trialSets[0] || [];
  if (questionNeedsShownMedia(question) && !images.length) {
    const diagnosed = diagnoseMissingMedia(question, mediaPool(run));
    await finishUnit(env, run, unit, envelope, {
      status: 'skipped',
      error: diagnosed.error,
      images,
      stage: { ...stageBase, media_error: diagnosed.code },
    });
    return { skipped: true };
  }

  await setStage(env, run.id, { ...stageBase, phase: 'media.ready', images }, claimedBy);
  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: envelope.id,
    questionName: question.name,
    type: 'media.ready',
    payload: { ...stageBase, images },
  });

  if (run.budget_tokens && Number(run.tokens_used || 0) < 64 && Number(run.budget_tokens) < 64) {
    await finishUnit(env, run, unit, envelope, {
      status: 'skipped',
      error: 'Token budget exhausted',
      images,
      stage: stageBase,
    });
    return { budgetExhausted: true };
  }

  const remainingBudget = Math.max(0, Number(run.budget_tokens || 0) - Number(run.tokens_used || 0));
  if (run.budget_tokens && remainingBudget < 64) {
    await finishUnit(env, run, unit, envelope, {
      status: 'skipped',
      error: 'Token budget exhausted',
      images,
      stage: stageBase,
    });
    return { budgetExhausted: true };
  }

  const beforeModel = await getRun(env, run.id);
  if (beforeModel?.cancel_requested || beforeModel?.status === 'cancelled') {
    await patchUnit(env, unit.id, { status: 'pending', lease_owner: null, lease_expires_at: null }, { claimedBy });
    return { cancelled: true };
  }

  await setStage(env, run.id, { ...stageBase, phase: 'model.request' }, claimedBy);
  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: envelope.id,
    questionName: question.name,
    type: 'model.request',
    payload: stageBase,
  });

  const prompted = questionWithShownMedia(question, images);
  let rawAnswer;
  try {
    rawAnswer = await askVlm(cred, run, persona, prompted, images, remainingBudget);
  } catch (error) {
    await appendSiliconEvent(env, {
      runId: run.id,
      responseId: envelope.id,
      questionName: question.name,
      type: 'validate.fail',
      payload: { ...stageBase, error: error.message, images },
    });
    await finishUnit(env, run, unit, envelope, {
      status: 'failed',
      error: error.message,
      images,
      tokensUsed: 0,
      stage: stageBase,
    });
    return { failed: true };
  }

  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: envelope.id,
    questionName: question.name,
    type: 'model.response',
    payload: { ...stageBase, rationale: rawAnswer.rationale || '', images },
  });

  const inner = validateInnerSiliconAnswer(prompted, rawAnswer.answer);
  if (!inner.ok) {
    await appendSiliconEvent(env, {
      runId: run.id,
      responseId: envelope.id,
      questionName: question.name,
      type: 'validate.fail',
      payload: {
        ...stageBase,
        answer: rawAnswer.answer,
        rationale: rawAnswer.rationale || '',
        error: inner.reason,
        images,
      },
    });
    await finishUnit(env, run, unit, envelope, {
      status: 'failed',
      answer: rawAnswer.answer,
      rationale: rawAnswer.rationale || '',
      error: inner.reason,
      images,
      tokensUsed: rawAnswer.tokensUsed,
      stage: stageBase,
    });
    return { failed: true, tokensUsed: rawAnswer.tokensUsed };
  }

  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: envelope.id,
    questionName: question.name,
    type: 'validate.ok',
    payload: { ...stageBase, rationale: rawAnswer.rationale || '', images },
  });

  await finishUnit(env, run, unit, envelope, {
    status: 'saved',
    answer: inner.answer,
    rationale: rawAnswer.rationale || '',
    images,
    tokensUsed: rawAnswer.tokensUsed,
    stage: stageBase,
  });
  return { saved: true, tokensUsed: rawAnswer.tokensUsed };
}

async function finishUnit(env, run, unit, envelope, {
  status,
  answer,
  rationale = '',
  error = null,
  images = [],
  tokensUsed = 0,
  stage = {},
  claimedBy = unit.lease_owner || null,
}) {
  const unitRow = await patchUnit(env, unit.id, {
    status,
    response_id: envelope?.id || null,
    answer: answer === undefined ? null : answer,
    rationale,
    images,
    error,
    tokens_used: Number(tokensUsed || 0),
    lease_owner: null,
    lease_expires_at: null,
  }, { claimedBy });
  const saved = await persistUnitOnResponse(env, run, { ...unit, status }, {
    answer: status === 'saved' ? answer : undefined,
    images,
    error,
  });
  if (unitRow?.id && saved?.id && saved.id !== unitRow.response_id) {
    await patchUnit(env, unit.id, { response_id: saved.id }, { claimedBy }).catch(() => null);
  }
  if (tokensUsed) {
    const latest = await getRun(env, run.id);
    if (claimedBy && latest?.claimed_by && latest.claimed_by !== claimedBy) {
      throw Object.assign(new Error('Silicon run lease was lost before this write'), {
        code: 'SILICON_LEASE_LOST',
        retryable: false,
      });
    }
    await patchRun(env, run.id, {
      tokens_used: Number(latest?.tokens_used || 0) + Number(tokensUsed || 0),
    }, { requireActive: false, claimedBy });
  }
  await appendSiliconEvent(env, {
    runId: run.id,
    responseId: saved?.id || envelope?.id || null,
    questionName: unit.question_name,
    type: status === 'saved' ? 'unit.saved' : (status === 'skipped' ? 'unit.skip' : 'validate.fail'),
    payload: {
      ...stage,
      unit_key: unitKey(unit),
      status,
      answer,
      rationale,
      error,
      images,
    },
  });
}

export async function finalizeSiliconRunIfComplete(env, run) {
  if (!run?.id || TERMINAL_RUN_STATUSES.has(run.status)) return null;
  const units = await listSiliconUnits(env, run.id);
  if (!units.length) return null;
  const counts = countsFromUnits(units);
  if (counts.unknown > 0 || counts.processed < counts.total) return null;
  return finalizeRun(env, run);
}

export async function executeSiliconJob(env, job = {}, ctx = null) {
  const runId = job.runId;
  if (!runId) return { success: false, error: 'runId required' };
  const claimedBy = job.claimedBy || newSiliconClaimedBy(runId);
  await expireStaleUnits(env, runId);
  const latestBeforeClaim = await getRun(env, runId);
  if (!latestBeforeClaim) return { success: false, error: 'Run not found' };
  if (TERMINAL_RUN_STATUSES.has(latestBeforeClaim.status) || latestBeforeClaim.cancel_requested) {
    return {
      success: true,
      ...(await finalizeRun(env, latestBeforeClaim, {
        status: latestBeforeClaim.status === 'cancelled' || latestBeforeClaim.cancel_requested
          ? 'cancelled'
          : latestBeforeClaim.status,
      })),
    };
  }
  const claimed = await claimSiliconRun(env, runId, claimedBy);
  if (!claimed) {
    const latest = await getRun(env, runId);
    if (!latest || TERMINAL_RUN_STATUSES.has(latest.status) || latest.cancel_requested) {
      return { success: true, finished: true, status: latest?.status || 'cancelled', skipped: true };
    }
    return { success: true, finished: false, status: latest.status, skipped: true, reason: 'lease_held' };
  }
  const run = await getRun(env, runId);
  if (!run) return { success: false, error: 'Run not found' };
  if (run.cancel_requested || run.status === 'cancelled') {
    return { success: true, ...(await finalizeRun(env, run, { status: 'cancelled' })) };
  }
  if (run.budget_tokens && Number(run.tokens_used || 0) >= Number(run.budget_tokens)) {
    return {
      success: true,
      ...(await finalizeRun(env, run, {
        status: 'partial',
        error: 'Token budget exhausted; run is partially complete.',
      })),
    };
  }

  const previewUnits = await listSiliconUnits(env, run.id);
  const previewCounts = previewUnits.length ? countsFromUnits(previewUnits) : null;
  const claimable = previewUnits.find((unit) => (
    unit.status === 'pending'
    || unit.status === 'unknown'
    || (unit.status === 'leased' && (!unit.lease_expires_at || Date.parse(unit.lease_expires_at) <= Date.now()))
  ));
  if (!claimable && previewCounts && previewCounts.processed >= previewCounts.total) {
    return { success: true, ...(await finalizeRun(env, run)) };
  }

  if (await interactiveBusy(env, run.user_id, run.provider) || await otherSiliconLease(env, run.user_id, run.id)) {
    await setStage(env, run.id, {
      phase: 'waiting_interactive',
      started_at: new Date().toISOString(),
    }, claimedBy);
    await appendSiliconEvent(env, {
      runId: run.id,
      type: 'throttle',
      payload: { reason: 'Waiting for the interactive Assistant or another Silicon call' },
    }).catch(() => null);
    if (!job.disableRedispatch) {
      await dispatchSiliconRun(env, ctx, {
        runId,
        userId: run.user_id,
        delaySeconds: 15,
      });
    }
    return { success: true, finished: false, status: 'running', deferred: true, delaySeconds: 15 };
  }

  const cred = await loadProviderCredential(env, run.user_id, run.provider);
  const profiles = await listProviderProfiles(env, run.user_id);
  const profile = (profiles || []).find((row) => row.provider === run.provider);
  assertVisionModel(run.provider, run.model, profile);
  run._profile = profile;

  const unit = await claimSiliconUnit(env, run.id, claimedBy);
  if (!unit) {
    return { success: true, ...(await finalizeRun(env, run)) };
  }

  let result;
  try {
    result = await processClaimedUnit(env, run, unit, cred, claimedBy);
  } catch (error) {
    if (error?.code === 'SILICON_LEASE_LOST' || error?.code === 'SILICON_LEASE_UNAVAILABLE') {
      throw error;
    }
    await patchUnit(env, unit.id, {
      status: 'unknown',
      error: String(error.message || 'Model result unknown').slice(0, 400),
      lease_owner: null,
      lease_expires_at: null,
    }, { claimedBy });
    await appendSiliconEvent(env, {
      runId: run.id,
      questionName: unit.question_name,
      type: 'validate.fail',
      payload: { error: error.message, unit_key: unitKey(unit), unknown: true },
    }).catch(() => null);
    throw error;
  }

  const counts = await persistCounts(env, run.id, claimedBy);
  const after = await getRun(env, run.id);
  if (after?.cancel_requested || result?.cancelled) {
    return { success: true, ...(await finalizeRun(env, after || run, { status: 'cancelled' })) };
  }
  if (result?.budgetExhausted) {
    return {
      success: true,
      ...(await finalizeRun(env, after || run, {
        status: 'partial',
        error: 'Token budget exhausted; run is partially complete.',
      })),
    };
  }
  const pendingLeft = (counts?.total || 0) - (counts?.processed || 0);
  if (pendingLeft <= 0) {
    return { success: true, ...(await finalizeRun(env, after || run)) };
  }
  if (!job.disableRedispatch) {
    await dispatchSiliconRun(env, ctx, { runId, userId: run.user_id });
  }
  return {
    success: true,
    finished: false,
    status: 'running',
    done: 1,
    counts,
  };
}

export async function processSiliconRunChunk(env, runId, ctx = null) {
  return executeSiliconJob(env, { runId, disableRedispatch: false }, ctx);
}

export async function nudgeSiliconRun(env, ctx, { runId, userId }) {
  await recoverSiliconRuns(env, ctx, { userId });
  return dispatchSiliconRun(env, ctx, { runId, userId });
}

async function askVlm(cred, run, persona, question, images, remainingBudget) {
  const content = [
    {
      type: 'text',
      text: `You are a survey respondent.
Persona: ${persona?.prompt || persona?.name || 'typical adult'}
Attributes: ${JSON.stringify(persona?.attributes || {})}
Answer as this person. Return JSON {"answer":...,"rationale":"one sentence"}.
Question type: ${question.type}
Title: ${question.title || question.name}
Description: ${question.description || ''}
Choices: ${JSON.stringify(question.choices || question.rateValues || null)}
Range: ${JSON.stringify({ min: question.rateMin ?? question.min, max: question.rateMax ?? question.max })}
${siliconAnswerContract(question)}`,
    },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const profile = run._profile || {};
  const resolved = resolveProvider(run.provider, profile);
  const modelRecord = resolveModel(run.provider, run.model, profile);
  const route = resolveModelRoute(run.provider, run.model, profile);
  if (!route?.supported) {
    throw Object.assign(new Error('This model is not available in the Web runtime.'), {
      status: 400,
      code: 'PROTOCOL_UNSUPPORTED',
    });
  }
  const result = await chatCompletions({
    apiKey: cred.apiKey,
    provider: cred.provider,
    baseUrl: route.baseUrl,
    model: run.model,
    modelRecord,
    protocol: route.protocol,
    compat: resolved.catalog
      ? (modelRecord?.compat || {})
      : { ...resolved.compat, ...(modelRecord?.compat || {}) },
    extra: route.headers,
    retryPolicy: resolved.retryPolicy,
    effort: run.reasoning_effort,
    efforts: modelRecord?.reasoningEfforts || false,
    temperature: run.temperature ?? 0.4,
    maxTokens: Math.max(64, Math.min(2048, Number(remainingBudget || 2048))),
    json: true,
    messages: [
      { role: 'system', content: 'Return only JSON. Stay in persona. Do not mention being an AI.' },
      { role: 'user', content },
    ],
  });
  let parsed = {};
  try {
    parsed = JSON.parse(result.content || '{}');
  } catch {
    const match = String(result.content || '').match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }
  const usage = result.usage || {};
  return {
    answer: parsed.answer,
    rationale: parsed.rationale || '',
    tokensUsed: Number(usage.total_tokens
      || (Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0))),
  };
}
