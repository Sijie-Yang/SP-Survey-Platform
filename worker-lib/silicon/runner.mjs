import { supabaseRest } from '../supabaseUserClient.mjs';
import { chatCompletions, assertVisionModel } from '../agent/runtime/providers.mjs';
import { listProviderProfiles, loadProviderCredential } from '../agent/credentials.mjs';
import { resolveModel, resolveProvider } from '../agent/runtime/registry.mjs';
import { assignMediaForSurvey } from './mediaAssign.mjs';
import { classifyQuestion, collectQuestions, validateSiliconAnswer } from './answerValidate.mjs';

const CHUNK = 1;

async function getRun(env, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&select=*`,
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function patchRun(env, runId, patch) {
  await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}`,
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
}

export async function processSiliconRunChunk(env, runId) {
  const run = await getRun(env, runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (['completed', 'cancelled', 'failed'].includes(run.status)) {
    return { done: 0, finished: true, status: run.status };
  }
  if (run.status === 'queued' || run.status === 'draft') {
    await patchRun(env, runId, { status: 'running', started_at: run.started_at || new Date().toISOString() });
  }
  if (run.budget_tokens && Number(run.tokens_used || 0) >= Number(run.budget_tokens)) {
    await patchRun(env, runId, {
      status: 'failed',
      error_summary: 'Token budget exhausted before the run completed.',
      finished_at: new Date().toISOString(),
    });
    return { done: 0, finished: true, status: 'failed', code: 'TOKEN_BUDGET_EXHAUSTED' };
  }

  const existing = await supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=persona_id,repeat_index`,
  });
  const doneKeys = new Set((existing || []).map((r) => `${r.persona_id}:${r.repeat_index}`));
  const personaIds = run.persona_ids || [];
  const repeats = Math.max(1, run.repeats || 1);
  const pending = [];
  for (const personaId of personaIds) {
    for (let r = 1; r <= repeats; r += 1) {
      const key = `${personaId}:${r}`;
      if (!doneKeys.has(key)) pending.push({ personaId, repeat: r });
    }
  }
  if (!pending.length) {
    await patchRun(env, runId, {
      status: 'completed',
      progress_done: run.progress_total,
      finished_at: new Date().toISOString(),
    });
    return { done: 0, finished: true, status: 'completed' };
  }

  const batch = pending.slice(0, CHUNK);
  const cred = await loadProviderCredential(env, run.user_id, run.provider);
  const profiles = await listProviderProfiles(env, run.user_id);
  const profile = (profiles || []).find((row) => row.provider === run.provider);
  assertVisionModel(run.provider, run.model, profile);
  run._profile = profile;

  let completed = 0;
  try {
    for (const item of batch) {
      const latest = await getRun(env, runId);
      if (latest?.status === 'cancelled') return { done: completed, finished: true, status: 'cancelled' };
      const remainingBudget = Math.max(0,
        Number(latest?.budget_tokens || run.budget_tokens || 0) - Number(latest?.tokens_used || 0));
      const answered = await answerOnePersona(env, run, cred, item, remainingBudget);
      completed += 1;
      await patchRun(env, runId, {
        progress_done: (latest?.progress_done || 0) + 1,
        tokens_used: Number(latest?.tokens_used || 0) + Number(answered.tokensUsed || 0),
        status: 'running',
      });
    }
  } catch (error) {
    await patchRun(env, runId, {
      status: 'failed',
      error_summary: String(error.message || 'Silicon run failed').slice(0, 400),
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
  const after = await getRun(env, runId);
  const finished = (after.progress_done || 0) >= (after.progress_total || 0);
  if (finished) {
    await patchRun(env, runId, { status: 'completed', finished_at: new Date().toISOString() });
  }
  return { done: completed, finished, status: finished ? 'completed' : 'running' };
}

async function answerOnePersona(env, run, cred, { personaId, repeat }, initialBudget) {
  const personas = await supabaseRest(env, {
    path: '/rest/v1/silicon_personas',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(personaId)}&select=*`,
  });
  const persona = Array.isArray(personas) ? personas[0] : null;
  const survey = run.survey_snapshot || {};
  const pool = run.media_snapshot || [];
  const seed = `${run.seed}:${personaId}:${repeat}`;
  const questions = collectQuestions(survey, run.question_names);
  const displayed = assignMediaForSurvey({
    surveyConfig: survey,
    pool,
    seed,
    questionNames: questions.map((q) => q.name),
  });
  const responses = {};
  const events = [];
  let tokensUsed = 0;

  for (const question of questions) {
    const kind = classifyQuestion(question);
    if (!kind.supported) {
      events.push({
        question_name: question.name,
        type: 'skip',
        payload: { reason: kind.reason },
      });
      continue;
    }
    const remainingBudget = Math.max(0, Number(initialBudget || 0) - tokensUsed);
    if (run.budget_tokens && remainingBudget < 64) {
      events.push({
        question_name: question.name,
        type: 'skip',
        payload: { reason: 'Token budget exhausted' },
      });
      break;
    }
    const images = displayed[question.name] || [];
    try {
      const raw = await askVlm(cred, run, persona, question, images, remainingBudget);
      tokensUsed += Number(raw.tokensUsed || 0);
      const checked = validateSiliconAnswer(question, raw.answer);
      if (checked.ok) responses[question.name] = checked.answer;
      events.push({
        question_name: question.name,
        type: checked.ok ? 'answer' : 'error',
        payload: {
          answer: checked.ok ? checked.answer : raw.answer,
          rationale: raw.rationale,
          images,
          error: checked.ok ? null : checked.reason,
        },
      });
    } catch (error) {
      events.push({
        question_name: question.name,
        type: 'error',
        payload: { error: error.message, images },
      });
    }
  }

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
      responses,
      displayed_images: displayed,
      survey_metadata: {
        response_source: 'silicon',
        silicon_run_id: run.id,
        persona_id: personaId,
        persona_name: persona?.name,
        model: run.model,
        provider: run.provider,
        seed,
        source_kind: run.source_kind || 'draft',
        draft_updated_at: run.draft_updated_at || null,
        runtime_version: run.runtime_version || null,
        profile_revision: run.profile_revision || null,
        practice_mode: false,
      },
      status: Object.keys(responses).length
        ? (events.some((event) => event.type === 'error') ? 'partial' : 'ok')
        : (events.every((event) => event.type === 'skip') ? 'skipped' : 'partial'),
    },
    prefer: 'return=representation',
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  for (const ev of events) {
    await supabaseRest(env, {
      path: '/rest/v1/silicon_answer_events',
      method: 'POST',
      serviceRole: true,
      body: {
        run_id: run.id,
        response_id: row?.id,
        question_name: ev.question_name,
        type: ev.type,
        payload: ev.payload,
      },
      prefer: 'return=minimal',
    });
  }
  return { tokensUsed };
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
Choices: ${JSON.stringify(question.choices || question.rateValues || null)}`,
    },
    ...images.slice(0, 6).map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const profile = run._profile || {};
  const resolved = resolveProvider(run.provider, profile);
  const modelRecord = resolveModel(run.provider, run.model, profile);
  const result = await chatCompletions({
    apiKey: cred.apiKey,
    provider: cred.provider,
    baseUrl: cred.baseUrl || resolved.baseUrl,
    model: run.model,
    protocol: resolved.protocol,
    compat: { ...resolved.compat, ...(modelRecord?.compat || {}) },
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
