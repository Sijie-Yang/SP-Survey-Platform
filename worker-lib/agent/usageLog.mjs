import { supabaseRest } from '../supabaseUserClient.mjs';
import { catalogModel } from './runtime/catalog.mjs';

// One row per model call in public.ai_usage_log (supabase/platform_dashboard.sql),
// so the admin dashboard can show what the shared free model costs.
// Logging never breaks a model call: any failure is swallowed.

const FEATURES = new Set(['assistant', 'assistant-spscheme', 'sp-scheme-page', 'review', 'results-analysis', 'translate']);

function count(value) {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
}

/**
 * Estimated price in USD from the catalog price (USD per million tokens).
 * `usage` is resultFromMessage().usage: prompt_tokens already includes cache
 * reads, which DeepSeek bills at a much lower rate. Returns null when the
 * model has no known price.
 */
export function estimateCostUsd(usage = {}, price = null) {
  if (!price || typeof price !== 'object') return null;
  const input = Number(price.input);
  const output = Number(price.output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || (input <= 0 && output <= 0)) return null;
  const cacheRead = Number.isFinite(Number(price.cacheRead)) ? Number(price.cacheRead) : input;
  const cacheWrite = Number.isFinite(Number(price.cacheWrite)) && Number(price.cacheWrite) > 0
    ? Number(price.cacheWrite)
    : input;
  const read = count(usage.cache_read_tokens);
  const write = count(usage.cache_write_tokens);
  const fresh = Math.max(0, count(usage.prompt_tokens) - read - write);
  const usd = (fresh * input + read * cacheRead + write * cacheWrite + count(usage.completion_tokens) * output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/** The row to store for one call, or null when there is nothing to record. */
export function usageRow(meter = {}, call = {}, usage = {}) {
  if (!meter?.userId) return null;
  const prompt = count(usage.prompt_tokens);
  const completion = count(usage.completion_tokens);
  if (!prompt && !completion) return null;
  const price = call.modelRecord?.cost || catalogModel(call.provider, call.model)?.cost || null;
  const source = meter.source === 'subsidy' ? 'subsidy' : 'user';
  return {
    user_id: meter.userId,
    key_owner_id: source === 'subsidy' ? (meter.keyOwnerId || null) : meter.userId,
    source,
    feature: FEATURES.has(meter.feature) ? meter.feature : 'assistant',
    project_id: meter.projectId ? String(meter.projectId).slice(0, 200) : null,
    run_id: meter.runId || null,
    provider: String(call.provider || '').slice(0, 64) || null,
    model: String(call.model || '').slice(0, 200) || null,
    prompt_tokens: prompt,
    cache_read_tokens: count(usage.cache_read_tokens),
    completion_tokens: completion,
    cost_usd: estimateCostUsd(usage, price),
  };
}

/**
 * Meter for chatCompletions({ meter }): who is paying for this call.
 * `binding` is resolveAssistantBinding()'s result.
 */
export function usageMeter(env, { userId, binding, feature, projectId = null, runId = null } = {}) {
  if (!env || !userId) return null;
  return {
    env,
    userId,
    source: binding?.source === 'subsidy' ? 'subsidy' : 'user',
    keyOwnerId: binding?.credential?.donorUserId || null,
    feature,
    projectId,
    runId,
  };
}

export async function recordUsage(meter, call, usage) {
  try {
    const row = usageRow(meter, call, usage);
    if (!row || !meter?.env) return;
    await supabaseRest(meter.env, {
      path: '/rest/v1/ai_usage_log',
      method: 'POST',
      serviceRole: true,
      body: row,
      prefer: 'return=minimal',
    });
  } catch {
    // The table may not exist yet (SQL not run) — never fail the model call.
  }
}
