import { supabaseRest } from '../supabaseUserClient.mjs';
import { getDraft } from '../agent/projectHandlers.mjs';
import { listProviderCredentials, listProviderProfiles, loadUserAiSettings } from '../agent/credentials.mjs';
import { CATALOG_VERSION } from '../agent/runtime/catalog.mjs';
import { resolveProvider } from '../agent/runtime/registry.mjs';
import { assertRoute } from '../agent/runtime/validators.mjs';
import { processSiliconRunChunk } from './runner.mjs';
import { RUNTIME_VERSION } from '../agent/runtime/events.mjs';

const MAX_PERSONAS_PER_RUN = 20;
const MAX_RESPONSES_PER_RUN = 100;
const DEFAULT_BUDGET_TOKENS = 25000;
const MAX_BUDGET_TOKENS = 100000;

function requireProject(projectId) {
  if (!projectId) throw Object.assign(new Error('projectId is required'), { status: 400 });
}

async function getOwnedProjectMedia(env, auth, projectId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken: auth.accessToken,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=id,preloaded_images,draft_updated_at`,
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

export async function listSiliconRuns(env, auth, projectId) {
  requireProject(projectId);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    accessToken: auth.accessToken,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&select=id,status,persona_ids,repeats,seed,provider,model,source_kind,draft_updated_at,tokens_used,budget_tokens,progress_done,progress_total,error_summary,created_at,finished_at&order=created_at.desc`,
  });
  return { success: true, runs: rows || [] };
}

export async function createSiliconRun(env, auth, body, request) {
  requireProject(body?.projectId);
  const settings = await loadUserAiSettings(env, auth.userId);
  const profiles = await listProviderProfiles(env, auth.userId);
  const credentials = await listProviderCredentials(env, auth.userId);
  const provider = body.provider || settings.silicon_provider || settings.default_provider || 'deepseek';
  const model = body.model || settings.silicon_model || resolveProvider(provider).defaultModels.silicon;
  const effort = body.reasoningEffort || body.reasoning_effort || settings.silicon_reasoning_effort || null;
  const profile = profiles.find((row) => row.provider === provider);
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
  const personaIds = [...new Set(Array.isArray(body.personaIds) ? body.personaIds : [])]
    .slice(0, MAX_PERSONAS_PER_RUN);
  if (!personaIds.length) throw Object.assign(new Error('Select at least one persona'), { status: 400 });
  const ownedPersonas = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    accessToken: auth.accessToken,
    query: `?project_id=eq.${encodeURIComponent(body.projectId)}&select=id`,
  });
  const ownedPersonaIds = new Set((ownedPersonas || []).map((row) => row.id));
  if (personaIds.some((id) => !ownedPersonaIds.has(id))) {
    throw Object.assign(new Error('One or more personas do not belong to this project'), {
      status: 400,
      code: 'INVALID_PERSONA',
    });
  }
  const repeats = Math.max(1, Math.min(20, Number(body.repeats || 1)));
  const total = personaIds.length * repeats;
  if (total > MAX_RESPONSES_PER_RUN) {
    throw Object.assign(new Error(`A Silicon run is limited to ${MAX_RESPONSES_PER_RUN} responses`), {
      status: 400,
      code: 'RUN_TOO_LARGE',
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
    question_names: body.questionNames || null,
    source_kind: 'draft',
    draft_updated_at: draft.draftUpdatedAt || projectMedia.draft_updated_at || null,
    survey_snapshot: draft.surveyConfig || {},
    media_snapshot: Array.isArray(projectMedia.preloaded_images) ? projectMedia.preloaded_images : [],
    runtime_version: RUNTIME_VERSION,
    prompt_version: 'silicon-v1',
    tokens_used: 0,
    progress_done: 0,
    progress_total: total,
  };
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    method: 'POST',
    serviceRole: true,
    body: insertBody,
    prefer: 'return=representation',
  });
  const run = Array.isArray(rows) ? rows[0] : rows;
  return { success: true, run };
}

export async function processSiliconChunk(env, auth, runId) {
  await getSiliconRun(env, auth, runId);
  const result = await processSiliconRunChunk(env, runId);
  return { success: true, ...result };
}

export async function cancelSiliconRun(env, auth, runId) {
  await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
    body: { status: 'cancelled', updated_at: new Date().toISOString(), finished_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return { success: true };
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
        answer: value?.answer != null ? value.answer : value,
        participantId: row.participant_id,
      });
    }
  }
  return {
    success: true,
    run,
    responseCount: responses.length,
    byQuestion,
    disclaimer: 'Silicon samples are for instrument pretest and hypothesis sketch. They do not replace human respondents.',
    response_source: 'silicon',
  };
}

export { personaPrompt };
