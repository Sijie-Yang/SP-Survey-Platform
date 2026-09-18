import { supabaseRest } from '../supabaseUserClient.mjs';
import { getDraft } from '../agent/projectHandlers.mjs';
import { listProviderCredentials, listProviderProfiles, loadUserAiSettings } from '../agent/credentials.mjs';
import { CATALOG_VERSION } from '../agent/runtime/catalog.mjs';
import { availableModelId } from '../agent/runtime/registry.mjs';
import { assertRoute } from '../agent/runtime/validators.mjs';
import {
  dispatchSiliconRun,
  finalizeSiliconRunIfComplete,
  listSiliconUnits,
  materializeSiliconUnits,
  nudgeSiliconRun,
  recoverSiliconRuns,
  requireSiliconBackgroundSchema,
} from './runner.mjs';
import { RUNTIME_VERSION } from '../agent/runtime/events.mjs';
import { questionSupportReport, unsupportedQuestionReport } from './answerValidate.mjs';
import { buildExecutionPlan, countsFromUnits, eventCountsFromUnits } from './executionPlan.mjs';
import { preflightMediaForQuestions } from './mediaAssign.mjs';
import { resolveSiliconMediaSnapshot } from './mediaSource.mjs';

const MAX_PERSONAS_PER_RUN = 20;
const MAX_RESPONSES_PER_RUN = 100;
const MAX_UNITS_PER_RUN = 400;
const DEFAULT_BUDGET_TOKENS = 25000;
const MAX_BUDGET_TOKENS = 100000;

function requireProject(projectId) {
  if (!projectId) throw Object.assign(new Error('projectId is required'), { status: 400 });
}

async function getOwnedProjectMedia(env, auth, projectId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken: auth.accessToken,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=id,preloaded_images,draft_updated_at,image_dataset_config`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  }
  return row;
}

function personaPrompt(attrs = {}, extra = '') {
  const bits = [];
  if (attrs.age) bits.push(`age ${attrs.age}`);
  if (attrs.gender) bits.push(attrs.gender);
  if (attrs.city) bits.push(`lives in ${attrs.city}`);
  if (attrs.country) bits.push(`from ${attrs.country}`);
  if (attrs.occupation) bits.push(attrs.occupation);
  if (attrs.education) bits.push(attrs.education);
  if (attrs.notes) bits.push(attrs.notes);
  const head = bits.length ? `You are ${bits.join(', ')}.` : 'You are a typical adult resident.';
  return `${head} ${extra || 'Answer streetscape perception questions from your lived experience.'}`.trim();
}

export async function listSiliconPersonas(env, auth, projectId) {
  requireProject(projectId);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    accessToken: auth.accessToken,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=updated_at.desc`,
  });
  return { success: true, personas: rows || [] };
}

export async function createSiliconPersona(env, auth, body) {
  requireProject(body?.projectId);
  await getOwnedProjectMedia(env, auth, body.projectId);
  const attributes = body.attributes || {};
  if (JSON.stringify(attributes).length > 16000) {
    throw Object.assign(new Error('Persona attributes are too large'), { status: 400 });
  }
  const prompt = String(body.prompt || personaPrompt(attributes)).trim().slice(0, 4000);
  const name = String(body.name || 'Persona').trim().slice(0, 80);
  if (!name) throw Object.assign(new Error('Persona name is required'), { status: 400 });
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    method: 'POST',
    serviceRole: true,
    body: {
      project_id: body.projectId,
      user_id: auth.userId,
      name,
      attributes,
      prompt,
    },
    prefer: 'return=representation',
  });
  return { success: true, persona: Array.isArray(rows) ? rows[0] : rows, prompt };
}

export async function updateSiliconPersona(env, auth, id, body) {
  const patch = { updated_at: new Date().toISOString() };
  if (body.name) patch.name = String(body.name).slice(0, 80);
  if (body.attributes) patch.attributes = body.attributes;
  if (body.prompt != null) patch.prompt = body.prompt;
  else if (body.attributes) patch.prompt = personaPrompt(body.attributes);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
    body: patch,
    prefer: 'return=representation',
  });
  return { success: true, persona: Array.isArray(rows) ? rows[0] : rows };
}

export async function deleteSiliconPersona(env, auth, id) {
  await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    method: 'DELETE',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
  });
  return { success: true };
}

const RUN_LIST_SELECT = [
  'id',
  'project_id',
  'status',
  'persona_ids',
  'repeats',
  'seed',
  'provider',
  'model',
  'source_kind',
  'draft_updated_at',
  'tokens_used',
  'budget_tokens',
  'progress_done',
  'progress_total',
  'progress_processed',
  'progress_valid',
  'progress_failed',
  'current_stage',
  'cancel_requested',
  'error_summary',
  'question_names',
  'reasoning_effort',
  'execution_plan',
  'created_at',
  'updated_at',
  'finished_at',
].join(',');

const RUN_LIST_SELECT_BASIC = [
  'id',
  'project_id',
  'status',
  'persona_ids',
  'repeats',
  'seed',
  'provider',
  'model',
  'source_kind',
  'draft_updated_at',
  'tokens_used',
  'budget_tokens',
  'progress_done',
  'progress_total',
  'error_summary',
  'question_names',
  'reasoning_effort',
  'created_at',
  'finished_at',
].join(',');

async function selectSiliconRuns(env, auth, queryBase, { serviceRole = false } = {}) {
  const token = serviceRole
    ? { serviceRole: true }
    : { accessToken: auth.accessToken };
  try {
    return await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      ...token,
      query: `${queryBase}&select=${RUN_LIST_SELECT}`,
    });
  } catch {
    return supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      ...token,
      query: `${queryBase}&select=${RUN_LIST_SELECT_BASIC}`,
    });
  }
}

function summarizeRun(run, counts = null) {
  const processed = counts?.processed ?? run.progress_processed ?? run.progress_done ?? null;
  const valid = counts?.valid ?? run.progress_valid ?? null;
  const failed = counts?.failed ?? run.progress_failed ?? null;
  const skipped = counts?.skipped ?? run.progress_skipped ?? null;
  return {
    ...run,
    progress_processed: processed,
    progress_valid: valid,
    progress_failed: failed,
    progress_skipped: skipped,
    counts_ready: processed != null && valid != null,
  };
}

export async function listSiliconRuns(env, auth, projectId) {
  requireProject(projectId);
  const rows = await selectSiliconRuns(
    env,
    auth,
    `?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc`,
  );
  const runs = [];
  for (const run of rows || []) {
    const units = await listSiliconUnits(env, run.id).catch(() => []);
    runs.push(summarizeRun(run, units.length ? countsFromUnits(units) : null));
  }
  return { success: true, runs };
}

export async function createSiliconRun(env, auth, body, request, ctx) {
  requireProject(body?.projectId);
  await requireSiliconBackgroundSchema(env);
  const settings = await loadUserAiSettings(env, auth.userId);
  const profiles = await listProviderProfiles(env, auth.userId);
  const credentials = await listProviderCredentials(env, auth.userId);
  const provider = body.provider || settings.silicon_provider || settings.default_provider || 'deepseek';
  const profile = profiles.find((row) => row.provider === provider);
  const model = availableModelId(provider, body.model || settings.silicon_model, {
    profile,
    vision: true,
  });
  const effort = body.reasoningEffort || body.reasoning_effort || settings.silicon_reasoning_effort || null;
  assertRoute({
    provider,
    model,
    profile,
    requireVision: true,
    effort,
    requireConfigured: true,
    credential: credentials.find((row) => row.provider === provider),
  });
  const draft = await getDraft(env, auth.accessToken, body.projectId, request);
  const projectMedia = await getOwnedProjectMedia(env, auth, body.projectId);
  const report = questionSupportReport(draft.surveyConfig || {}, null);
  const requestedNames = Array.isArray(body.questionNames) && body.questionNames.length
    ? body.questionNames
    : report.supported.map((item) => item.name);
  const unsupported = unsupportedQuestionReport(draft.surveyConfig || {}, requestedNames);
  if (unsupported.length) {
    throw Object.assign(new Error(
      `Silicon cannot run these questions: ${unsupported.map((item) => `${item.name} (${item.reason})`).join('; ')}`,
    ), { status: 400, code: 'SILICON_UNSUPPORTED_QUESTIONS', details: unsupported });
  }
  if (!requestedNames.length) {
    throw Object.assign(new Error('No Silicon-supported questions in this draft'), {
      status: 400,
      code: 'SILICON_NO_SUPPORTED_QUESTIONS',
    });
  }
  const personaIds = [...new Set(Array.isArray(body.personaIds) ? body.personaIds : [])]
    .slice(0, MAX_PERSONAS_PER_RUN);
  if (!personaIds.length) throw Object.assign(new Error('Select at least one persona'), { status: 400 });
  const ownedPersonas = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    accessToken: auth.accessToken,
    query: `?project_id=eq.${encodeURIComponent(body.projectId)}&select=*`,
  });
  const ownedPersonaIds = new Set((ownedPersonas || []).map((row) => row.id));
  if (personaIds.some((id) => !ownedPersonaIds.has(id))) {
    throw Object.assign(new Error('One or more personas do not belong to this project'), {
      status: 400,
      code: 'INVALID_PERSONA',
    });
  }
  const frozenPersonas = (ownedPersonas || []).filter((row) => personaIds.includes(row.id));
  const repeats = Math.max(1, Math.min(20, Number(body.repeats || 1)));
  const envelopes = personaIds.length * repeats;
  if (envelopes > MAX_RESPONSES_PER_RUN) {
    throw Object.assign(new Error(`A Silicon run is limited to ${MAX_RESPONSES_PER_RUN} responses`), {
      status: 400,
      code: 'RUN_TOO_LARGE',
    });
  }
  const plan = buildExecutionPlan({
    persona_ids: personaIds,
    repeats,
    question_names: requestedNames,
    survey_snapshot: draft.surveyConfig || {},
  });
  if (!plan.total) {
    throw Object.assign(new Error('No Silicon-supported questions in this draft'), {
      status: 400,
      code: 'SILICON_NO_SUPPORTED_QUESTIONS',
    });
  }
  if (plan.total > MAX_UNITS_PER_RUN) {
    throw Object.assign(new Error(`A Silicon run is limited to ${MAX_UNITS_PER_RUN} answer units`), {
      status: 400,
      code: 'RUN_TOO_LARGE',
    });
  }
  const sourceKind = body.sourceKind || body.source_kind || 'draft';
  const mediaSnap = await resolveSiliconMediaSnapshot(env, {
    projectImages: projectMedia.preloaded_images,
    dataset: projectMedia.image_dataset_config || {},
    sourceKind,
  });
  const preflight = preflightMediaForQuestions({
    surveyConfig: draft.surveyConfig || {},
    questionNames: requestedNames,
    pool: mediaSnap.images,
    dataset: mediaSnap.dataset,
  });
  if (!preflight.ok) {
    const first = preflight.errors[0] || {};
    const code = first.code === 'folder_empty'
      ? 'SILICON_FOLDER_EMPTY'
      : first.code === 'image_unreadable'
        ? 'SILICON_IMAGE_UNREADABLE'
        : 'SILICON_NO_MEDIA_SOURCE';
    throw Object.assign(new Error(first.error || 'No usable images for the selected questions'), {
      status: 400,
      code,
      details: preflight.errors,
    });
  }
  const requestedBudget = Number(body.budgetTokens || DEFAULT_BUDGET_TOKENS);
  const budgetTokens = Math.max(512, Math.min(MAX_BUDGET_TOKENS,
    Number.isFinite(requestedBudget) ? requestedBudget : DEFAULT_BUDGET_TOKENS));
  const insertBody = {
    project_id: body.projectId,
    user_id: auth.userId,
    status: 'queued',
    persona_ids: personaIds,
    repeats,
    seed: Number(body.seed || 42),
    provider,
    model,
    reasoning_effort: effort,
    profile_revision: CATALOG_VERSION,
    temperature: body.temperature ?? settings.temperature ?? 0.4,
    budget_tokens: budgetTokens,
    question_names: requestedNames,
    source_kind: sourceKind === 'published' ? 'published' : 'draft',
    draft_updated_at: draft.draftUpdatedAt || projectMedia.draft_updated_at || null,
    survey_snapshot: draft.surveyConfig || {},
    media_snapshot: {
      source: mediaSnap.source,
      images: mediaSnap.images,
      dataset: mediaSnap.dataset,
      availableCount: mediaSnap.availableCount,
      previewRevision: mediaSnap.revision,
    },
    persona_snapshot: frozenPersonas,
    runtime_version: RUNTIME_VERSION,
    prompt_version: 'silicon-v1',
    tokens_used: 0,
    progress_done: 0,
    progress_total: plan.total,
    progress_processed: 0,
    progress_valid: 0,
    progress_failed: 0,
    cancel_requested: false,
    current_stage: { phase: 'queued', started_at: new Date().toISOString() },
    execution_plan: {
      total: plan.total,
      repeats: plan.repeats,
      personas: plan.personas,
      questions: plan.questions,
      media: {
        source: mediaSnap.source,
        availableCount: mediaSnap.availableCount,
      },
    },
  };
  let run;
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      method: 'POST',
      serviceRole: true,
      body: insertBody,
      prefer: 'return=representation',
    });
    run = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    throw Object.assign(new Error('Silicon background columns are not applied'), {
      status: 503,
      code: 'SILICON_LEASE_UNAVAILABLE',
      cause: error,
    });
  }
  if (run?.id) {
    await materializeSiliconUnits(env, { ...run, ...insertBody, persona_ids: personaIds, repeats, question_names: requestedNames, survey_snapshot: draft.surveyConfig || {} });
    await dispatchSiliconRun(env, ctx, { runId: run.id, userId: auth.userId });
  }
  return { success: true, queued: true, run };
}

export async function processSiliconChunk(env, auth, runId, ctx) {
  await getSiliconRun(env, auth, runId);
  const dispatched = await nudgeSiliconRun(env, ctx, { runId, userId: auth.userId });
  return { success: true, queued: true, finished: false, dispatch: dispatched?.dispatch || 'nudge' };
}

export async function cancelSiliconRun(env, auth, runId) {
  const { run } = await getSiliconRun(env, auth, runId);
  const now = new Date().toISOString();
  const immediate = ['queued', 'draft'].includes(run.status);
  const query = `?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(auth.userId)}&status=in.(queued,draft,running)`;
  try {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      method: 'PATCH',
      serviceRole: true,
      query,
      body: immediate
        ? { status: 'cancelled', cancel_requested: true, updated_at: now, finished_at: now }
        : { cancel_requested: true, updated_at: now },
      prefer: 'return=minimal',
    });
  } catch {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      method: 'PATCH',
      serviceRole: true,
      query,
      body: { status: 'cancelled', updated_at: now, finished_at: now },
      prefer: 'return=minimal',
    });
    return { success: true, stopping: false, status: 'cancelled' };
  }
  return { success: true, stopping: !immediate, status: immediate ? 'cancelled' : run.status };
}

const TERMINAL_OR_STOP = new Set(['completed', 'cancelled', 'failed', 'partial']);

async function requeueSiliconRun(env, auth, run, { resetFailed = false } = {}) {
  const units = await listSiliconUnits(env, run.id);
  const reset = resetFailed
    ? units.filter((unit) => ['failed', 'unknown'].includes(unit.status))
    : [];
  if (reset.length) {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_units',
      method: 'PATCH',
      serviceRole: true,
      query: `?run_id=eq.${encodeURIComponent(run.id)}&status=in.(failed,unknown)`,
      body: {
        status: 'pending',
        error: null,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    });
  }
  const saved = units.filter((unit) => unit.status === 'saved' || unit.status === 'skipped');
  if (TERMINAL_OR_STOP.has(run.status) || run.cancel_requested) {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_runs',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(run.id)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
      body: {
        status: 'queued',
        cancel_requested: false,
        finished_at: null,
        error_summary: null,
        claimed_by: null,
        lease_expires_at: null,
        progress_processed: saved.length,
        progress_done: saved.length,
        updated_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    });
  }
  return { saved: saved.length, reset: reset.length };
}

export async function resumeSiliconRun(env, auth, runId, ctx) {
  const { run } = await getSiliconRun(env, auth, runId);
  const { saved } = await requeueSiliconRun(env, auth, run, { resetFailed: false });
  await dispatchSiliconRun(env, ctx, { runId, userId: auth.userId });
  return { success: true, queued: true, continued: true, saved };
}

export async function retryFailedSiliconRun(env, auth, runId, ctx) {
  const { run } = await getSiliconRun(env, auth, runId);
  const { reset } = await requeueSiliconRun(env, auth, run, { resetFailed: true });
  await dispatchSiliconRun(env, ctx, { runId, userId: auth.userId });
  return { success: true, queued: true, retried: reset };
}

const LIST_RECOVER_INTERVAL_MS = 30_000;
let lastListRecoverAt = 0;

export function resetSiliconListRecoverForTests() {
  lastListRecoverAt = 0;
}

export async function listSiliconTasks(env, auth, ctx) {
  const now = Date.now();
  if (now - lastListRecoverAt >= LIST_RECOVER_INTERVAL_MS) {
    lastListRecoverAt = now;
    await recoverSiliconRuns(env, ctx, { userId: auth.userId }).catch(() => null);
  }
  let active = await selectSiliconRuns(
    env,
    auth,
    `?user_id=eq.${encodeURIComponent(auth.userId)}&status=in.(queued,draft,running)&order=updated_at.desc`,
    { serviceRole: true },
  );
  let finalized = false;
  for (const run of active || []) {
    const next = await finalizeSiliconRunIfComplete(env, run).catch(() => null);
    if (next) finalized = true;
  }
  if (finalized) {
    active = await selectSiliconRuns(
      env,
      auth,
      `?user_id=eq.${encodeURIComponent(auth.userId)}&status=in.(queued,draft,running)&order=updated_at.desc`,
      { serviceRole: true },
    );
  }
  const recent = await selectSiliconRuns(
    env,
    auth,
    `?user_id=eq.${encodeURIComponent(auth.userId)}&status=in.(completed,cancelled,failed,partial)&order=updated_at.desc&limit=12`,
    { serviceRole: true },
  );
  const projectIds = [...new Set([...(active || []), ...(recent || [])].map((row) => row.project_id).filter(Boolean))];
  let projects = [];
  if (projectIds.length) {
    const encoded = projectIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
    projects = await supabaseRest(env, {
      path: '/rest/v1/projects',
      serviceRole: true,
      query: `?id=in.(${encoded})&select=id,name`,
    }).catch(() => []);
  }
  const names = new Map((projects || []).map((row) => [row.id, row.name]));
  const withCounts = async (rows) => {
    const out = [];
    for (const run of rows || []) {
      const units = await listSiliconUnits(env, run.id).catch(() => []);
      const counts = units.length ? countsFromUnits(units) : null;
      out.push(summarizeRun({
        ...run,
        project_name: names.get(run.project_id) || run.project_id,
      }, counts));
    }
    return out;
  };
  return {
    success: true,
    active: await withCounts(active),
    recent: await withCounts(recent),
    activeCount: (active || []).length,
  };
}

export async function getSiliconProgress(env, auth, runId, after = 0) {
  const { run } = await getSiliconRun(env, auth, runId);
  const units = await listSiliconUnits(env, runId);
  const counts = units.length ? countsFromUnits(units) : {
    processed: run.progress_processed ?? null,
    valid: run.progress_valid ?? null,
    failed: run.progress_failed ?? null,
    skipped: null,
    total: run.progress_total ?? null,
  };
  const cursor = Number(after || 0);
  const events = await supabaseRest(env, {
    path: '/rest/v1/silicon_answer_events',
    accessToken: auth.accessToken,
    query: `?run_id=eq.${encodeURIComponent(runId)}${cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ''}&select=id,type,question_name,payload,created_at,response_id&order=id.asc`,
  }).catch(() => []);
  return {
    success: true,
    run: summarizeRun(run, units.length ? counts : null),
    counts,
    current_stage: run.current_stage || null,
    events: events || [],
    nextCursor: (events || []).length ? events[events.length - 1].id : cursor,
    units: units.map((unit) => ({
      id: unit.id,
      persona_id: unit.persona_id,
      repeat_index: unit.repeat_index,
      question_name: unit.question_name,
      trial_index: unit.trial_index,
      status: unit.status,
      error: unit.error,
      rationale: unit.rationale,
      answer: unit.answer,
      images: unit.images || [],
    })),
  };
}

export async function getSiliconRun(env, auth, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    accessToken: auth.accessToken,
    query: `?id=eq.${encodeURIComponent(runId)}&select=*`,
  });
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  return { success: true, run };
}

export async function listSiliconResponses(env, auth, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    accessToken: auth.accessToken,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=*&order=created_at.asc`,
  });
  return { success: true, responses: rows || [] };
}

export async function getSiliconCompare(env, auth, runId) {
  const { run } = await getSiliconRun(env, auth, runId);
  const { responses } = await listSiliconResponses(env, auth, runId);
  const byQuestion = {};
  for (const row of responses) {
    for (const [name, value] of Object.entries(row.responses || {})) {
      if (!byQuestion[name]) byQuestion[name] = [];
      byQuestion[name].push({
        personaId: row.persona_id,
        persona_name: row.survey_metadata?.persona_name || null,
        answer: value?.answer != null ? value.answer : value,
        valid: row.status === 'ok' || (row.status !== 'error' && row.status !== 'skipped' && value != null),
        status: row.status || null,
        error: row.survey_metadata?.error || value?.error || null,
        images: row.displayed_images?.[name] || [],
        displayed_images: row.displayed_images?.[name] || [],
        responses: row.responses || {},
        participantId: row.participant_id,
      });
    }
  }
  const units = await listSiliconUnits(env, runId);
  const events = await supabaseRest(env, {
    path: '/rest/v1/silicon_answer_events',
    accessToken: auth.accessToken,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=type&order=id.asc`,
  }).catch(() => []);
  const eventCounts = units.length
    ? eventCountsFromUnits(units)
    : { answer: 0, skip: 0, error: 0 };
  if (!units.length) {
    for (const event of events || []) {
      if (eventCounts[event.type] != null) eventCounts[event.type] += 1;
    }
  }
  return {
    success: true,
    run: summarizeRun(run, units.length ? countsFromUnits(units) : null),
    responseCount: responses.length,
    byQuestion,
    eventCounts,
    responses,
    disclaimer: 'Silicon samples are for instrument pretest and hypothesis sketch. They do not replace human respondents, and they do not prove the design is scientifically valid.',
    response_source: 'silicon',
  };
}

export async function exportSiliconRun(env, auth, runId) {
  const { run } = await getSiliconRun(env, auth, runId);
  const { responses } = await listSiliconResponses(env, auth, runId);
  const units = await listSiliconUnits(env, runId);
  const counts = units.length ? countsFromUnits(units) : null;
  const events = await supabaseRest(env, {
    path: '/rest/v1/silicon_answer_events',
    accessToken: auth.accessToken,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=*&order=id.asc`,
  }).catch(() => []);
  return {
    success: true,
    format: 'silicon-pretest-v1',
    response_source: 'silicon',
    run: {
      id: run.id,
      projectId: run.project_id,
      status: run.status,
      provider: run.provider,
      model: run.model,
      reasoningEffort: run.reasoning_effort,
      temperature: run.temperature,
      repeats: run.repeats,
      seed: run.seed,
      budgetTokens: run.budget_tokens,
      tokensUsed: run.tokens_used,
      draftUpdatedAt: run.draft_updated_at,
      runtimeVersion: run.runtime_version,
      personaSnapshot: run.persona_snapshot || [],
      mediaDataset: run.media_snapshot?.dataset || null,
      mediaImages: Array.isArray(run.media_snapshot?.images) ? run.media_snapshot.images.length : 0,
      errorSummary: run.error_summary || null,
      counts,
    },
    units,
    responses,
    events: events || [],
    csv: siliconResponsesToCsv(responses, run),
    disclaimer: 'Synthetic pretest export. Do not mix with survey_responses.',
  };
}

export function siliconResponsesToCsv(responses = [], run = {}) {
  const snapshotFolders = [
    ...Object.keys(run.media_snapshot?.dataset?.mediaFolderTags || {}),
    ...((run.media_snapshot?.images || []).map((img) => img.folder || img.folderPath || img.mediaFolder).filter(Boolean)),
  ];
  const runFolders = [...new Set(snapshotFolders)].join('|');
  const rows = [[
    'response_source',
    'run_id',
    'model',
    'provider',
    'draft_updated_at',
    'media_folders',
    'media_ids',
    'participant_id',
    'persona_id',
    'persona_name',
    'repeat_index',
    'status',
    'question',
    'answer',
  ]];
  for (const row of responses) {
    const answers = Object.keys(row.responses || {}).length
      ? Object.entries(row.responses)
      : [['', '']];
    for (const [question, value] of answers) {
      const shown = row.displayed_images?.[question] || [];
      const mediaIds = (Array.isArray(shown) ? shown : []).map((img) => (
        typeof img === 'string' ? img : (img.id || img.url || '')
      )).join('|');
      rows.push([
        'silicon',
        run.id || row.survey_metadata?.silicon_run_id || '',
        run.model || row.survey_metadata?.model || '',
        run.provider || row.survey_metadata?.provider || '',
        run.draft_updated_at || row.survey_metadata?.draft_updated_at || '',
        runFolders || row.survey_metadata?.media_folders || '',
        mediaIds,
        row.participant_id || '',
        row.persona_id || '',
        row.survey_metadata?.persona_name || '',
        row.repeat_index ?? '',
        row.status || '',
        question,
        value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value)),
      ]);
    }
  }
  return rows.map((cols) => cols.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export { personaPrompt };
