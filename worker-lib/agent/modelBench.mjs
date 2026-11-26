/**
 * Model comparison for the built-in Assistant's SP-Scheme page writer
 * (platform admins only, over MCP: model_bench_routes / _start / _result).
 *
 * Every model gets the same fixed study descriptions and goes through the
 * exact production path (writeSpSchemePage: Studio's import check plus up to
 * two repair rounds). Keys stay on the server: the admin's own provider keys,
 * else the free-model routes. Each description runs as its own queue job and
 * writes one result JSON (with the page) to R2 under a random bench id.
 */

import { writeSpSchemePage, MAX_REPAIR_ROUNDS } from './spSchemeGenerate.mjs';
import { listProviderCredentials, listProviderProfiles, resolveAssistantBinding } from './credentials.mjs';
import { loadActiveSubsidy } from './subsidy.mjs';
import { normalizeSubsidyRoutes } from './subsidy.mjs';
import { resolveModel } from './runtime/registry.mjs';
import { assertRoute } from './runtime/validators.mjs';
import { getPrefixObject, listPrefixObjects, putPrefixObject } from './r2AgentMedia.mjs';

export const BENCH_PREFIX = '_admin-model-bench/';

/** The same descriptions for every model: typical requests in both languages. */
export const BENCH_PROMPTS = Object.freeze([
  {
    id: 'pairwise-zh',
    text: '做一个街景感知实验：参与者两两比较街景照片，选出哪一张看起来骑自行车更安全，一共 20 组。最后问年龄、性别、是否经常骑车。',
  },
  {
    id: 'rating-en',
    text: 'Participants rate 30 street-view images, one at a time, on four perceptions: safe, lively, beautiful and boring, each on a 7-point scale. Start with consent, end with a thank-you page.',
  },
  {
    id: 'pick-zh',
    text: '给参与者看 12 张公园照片，请他们选出最想去的 3 张，然后用一句话说明原因。再问一题：你平时多久去一次公园（每天/每周/每月/很少）。',
  },
  {
    id: 'paste-en',
    text: 'Fit this existing survey to SP-Scheme, keep the wording:\nQ1. How satisfied are you with your neighbourhood? (1 Very dissatisfied - 5 Very satisfied)\nQ2. Which of these do you use at least weekly? Bus / Metro / Bicycle / Car / Walking\nQ3. Look at the photo and rate how green the street feels (0-100 slider). Show 10 photos.\nQ4. Any other comments? (open text)',
  },
  {
    id: 'before-after-zh',
    text: '比较街道改造前后：每次给参与者看同一条街的改造前和改造后两张照片，一共 8 对，用滑条（-50 到 50）表示更喜欢哪一张，并勾选改造后变好的方面（绿化、步行空间、座椅、安全感）。最后是简单的个人信息。',
  },
]);

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function benchKey(benchId, promptId) {
  return `${BENCH_PREFIX}${benchId}/${promptId}.json`;
}

/** Provider/model pairs this admin can run: their own keys and the free-model routes. */
export async function listBenchRoutes(env, userId) {
  const own = await listProviderCredentials(env, userId).catch(() => []);
  const subsidy = await loadActiveSubsidy(env).catch(() => null);
  return {
    ownProviders: own.map((row) => ({ provider: row.provider, models: Array.isArray(row.models) ? row.models : undefined })),
    freeModelRoutes: subsidy ? normalizeSubsidyRoutes(subsidy.allowed_routes) : [],
    prompts: BENCH_PROMPTS.map((p) => ({ id: p.id, text: p.text })),
    note: 'Any model of an own provider can be benched (catalog ids). Free-model routes run on the free-model key.',
  };
}

/** The same model route the Assistant's page tool gets. */
export async function benchRoute(env, userId, provider, model) {
  const profiles = await listProviderProfiles(env, userId).catch(() => []);
  const binding = await resolveAssistantBinding(env, userId, provider, model, { receiverProfiles: profiles });
  const cred = binding.credential;
  const checked = assertRoute({ provider, model, profile: binding.profile, requireConfigured: true, credential: cred });
  const resolved = checked.provider;
  const route = checked.route;
  const modelRecord = resolveModel(provider, model, binding.profile);
  return {
    apiKey: cred.apiKey,
    provider: cred.provider,
    baseUrl: route.baseUrl,
    model,
    modelRecord,
    protocol: route.protocol,
    compat: resolved.catalog ? (modelRecord?.compat || {}) : { ...resolved.compat, ...(modelRecord?.compat || {}) },
    extra: route.headers,
    retryPolicy: resolved.retryPolicy,
    keySource: binding.source,
  };
}

export async function startModelBench(env, userId, args = {}, { dispatch, now = () => new Date(), resolveRoute = benchRoute, write = null } = {}) {
  const provider = String(args.provider || '').trim();
  const model = String(args.model || '').trim();
  if (!provider || !model) throw fail('provider and model are required');
  const ids = Array.isArray(args.prompts) && args.prompts.length ? args.prompts.map(String) : BENCH_PROMPTS.map((p) => p.id);
  const unknown = ids.filter((id) => !BENCH_PROMPTS.some((p) => p.id === id));
  if (unknown.length) throw fail(`Unknown prompt ids: ${unknown.join(', ')}`);
  // Fail now (no key, unknown model) rather than in five queue jobs.
  await resolveRoute(env, userId, provider, model);
  const benchId = String(args.benchId || '').match(/^[a-z0-9-]{8,64}$/)
    ? String(args.benchId)
    : globalThis.crypto.randomUUID();
  const startedAt = now().toISOString();
  for (const promptId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const queued = { status: 'queued', provider, model, promptId, startedAt };
    const key = benchKey(benchId, `${slug(provider)}__${slug(model)}__${promptId}`);
    if (write) await write(key, queued);
    else await putPrefixObject(env, key, JSON.stringify(queued), 'application/json');
    // eslint-disable-next-line no-await-in-loop
    await dispatch({ kind: 'model-bench', userId, benchId, provider, model, promptId });
  }
  return { benchId, provider, model, prompts: ids, startedAt, next: 'Call model_bench_result with this benchId in a few minutes.' };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 80);
}

/** Queue job: one description through one model; writes its result. */
export async function runModelBenchJob(env, job, { chat, write, resolveRoute = benchRoute } = {}) {
  const prompt = BENCH_PROMPTS.find((p) => p.id === job.promptId);
  const key = benchKey(job.benchId, `${slug(job.provider)}__${slug(job.model)}__${job.promptId}`);
  const save = write || ((body) => putPrefixObject(env, key, JSON.stringify(body), 'application/json'));
  const base = { provider: job.provider, model: job.model, promptId: job.promptId };
  const started = Date.now();
  const calls = [];
  try {
    if (!prompt) throw fail(`Unknown prompt ${job.promptId}`);
    const route = await resolveRoute(env, job.userId, job.provider, job.model);
    const chatFn = chat || (await import('./runtime/providers.mjs')).chatCompletions;
    const timedChat = async (options) => {
      const t0 = Date.now();
      try {
        const result = await chatFn(options);
        calls.push({ ms: Date.now() - t0, usage: result?.usage || null, chars: String(result?.content || '').length });
        return result;
      } catch (error) {
        calls.push({ ms: Date.now() - t0, error: String(error?.message || error).slice(0, 300) });
        throw error;
      }
    };
    const written = await writeSpSchemePage({ chat: timedChat, route, request: prompt.text });
    await save({
      ...base,
      status: 'done',
      keySource: route.keySource,
      passed: written.passed,
      firstTry: written.passed && written.rounds === 1,
      rounds: written.rounds,
      maxRounds: MAX_REPAIR_ROUNDS + 1,
      questionCount: written.check.questionCount,
      matchLevel: written.check.matchLevel,
      problems: written.check.problems.slice(0, 15),
      note: written.reply,
      ms: Date.now() - started,
      calls,
      htmlChars: written.html.length,
      html: written.html,
    });
  } catch (error) {
    await save({ ...base, status: 'failed', error: String(error?.message || error).slice(0, 500), ms: Date.now() - started, calls });
  }
  return { success: true };
}

/** Results of a bench: a summary row per model and description; the page itself only when asked. */
export async function readModelBench(env, args = {}) {
  const benchId = String(args.benchId || '');
  if (!/^[a-z0-9-]{8,64}$/.test(benchId)) throw fail('benchId is required');
  const listed = await listPrefixObjects(env, `${BENCH_PREFIX}${benchId}/`);
  const keys = (listed.objects || []).map((o) => o.key || o.Key || o).filter((k) => typeof k === 'string' && k.endsWith('.json'));
  const rows = [];
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    const got = await getPrefixObject(env, key);
    if (!got.bytes) continue;
    let row;
    try { row = JSON.parse(new TextDecoder().decode(got.bytes)); } catch { continue; }
    const wantHtml = args.includeHtml && row.promptId === args.includeHtml.promptId
      && (!args.includeHtml.model || row.model === args.includeHtml.model);
    if (!wantHtml) delete row.html;
    rows.push(row);
  }
  rows.sort((a, b) => `${a.model}${a.promptId}`.localeCompare(`${b.model}${b.promptId}`));
  return { benchId, results: rows, pending: rows.filter((r) => r.status === 'queued').length };
}
