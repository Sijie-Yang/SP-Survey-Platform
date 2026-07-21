/**
 * Process SP-Bench run chunks (queue consumer or /process endpoint).
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { decryptApiKey } from '../crypto/byokAesGcm.mjs';
import { fromBytea } from './bytea.mjs';
import { evaluateItemWithProvider } from './providers.mjs';
import { scoreRun } from './scoring.mjs';

const CHUNK_SIZE = 3;

async function getRunBundle(env, runId) {
  const runs = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&select=*`,
  });
  const run = Array.isArray(runs) ? runs[0] : null;
  if (!run) throw new Error('Run not found');

  const models = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_models',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(run.model_row_id)}&select=*`,
  });
  const model = Array.isArray(models) ? models[0] : null;
  if (!model) throw new Error('Model not found');

  const providers = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_providers',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(model.provider_id)}&select=*`,
  });
  const provider = Array.isArray(providers) ? providers[0] : null;
  if (!provider?.configured || !provider.key_ciphertext) {
    throw new Error(`Provider ${model.provider_id} has no API key`);
  }

  const methods = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_methods',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(run.method_id)}&select=*`,
  });
  const method = Array.isArray(methods) ? methods[0] : null;
  if (!method) throw new Error('Method not found');

  const apiKey = await decryptApiKey(
    env,
    fromBytea(provider.key_ciphertext),
    fromBytea(provider.key_nonce),
  );

  return { run, model, provider, method, apiKey };
}

async function patchRun(env, runId, patch) {
  await supabaseRest(env, {
    path: '/rest/v1/sp_bench_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}`,
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
}

async function finalizeRun(env, runId, method) {
  const preds = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_predictions',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=item_id,status,prediction,latency_ms,input_tokens,output_tokens`,
  });
  const okPreds = (Array.isArray(preds) ? preds : []).filter((p) => p.status === 'ok');
  const itemIds = okPreds.map((p) => p.item_id);
  let items = [];
  if (itemIds.length) {
    const filter = itemIds.map((id) => `"${id}"`).join(',');
    items = await supabaseRest(env, {
      path: '/rest/v1/sp_bench_items',
      serviceRole: true,
      query: `?id=in.(${filter})&select=id,labels`,
    });
  }
  const byId = new Map((Array.isArray(items) ? items : []).map((i) => [i.id, i]));
  const rows = okPreds.map((p) => ({
    labels: byId.get(p.item_id)?.labels || {},
    prediction: p.prediction || {},
  }));
  const scored = scoreRun(rows, method.dimensions || []);
  const latencies = okPreds.map((p) => p.latency_ms).filter((n) => Number.isFinite(n));
  const latencyAvg = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : null;
  const errCount = (Array.isArray(preds) ? preds : []).filter((p) => p.status === 'error').length;
  const total = Array.isArray(preds) ? preds.length : 0;
  const errorRate = total ? errCount / total : 1;

  await supabaseRest(env, {
    path: '/rest/v1/sp_bench_results',
    method: 'POST',
    serviceRole: true,
    body: {
      run_id: runId,
      overall_score: scored.overall_score,
      group_scores: scored.group_scores,
      dimension_scores: scored.dimension_scores,
      sample_size: scored.sample_size,
      updated_at: new Date().toISOString(),
    },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });

  await patchRun(env, runId, {
    status: 'needs_review',
    progress_done: total,
    progress_total: total,
    latency_ms_avg: latencyAvg,
    finished_at: new Date().toISOString(),
    metrics: {
      error_rate: errorRate,
      ok_count: okPreds.length,
      error_count: errCount,
      overall_score: scored.overall_score,
    },
    error_summary: errorRate > 0.5
      ? `High error rate (${(errorRate * 100).toFixed(0)}%). Review before approving.`
      : null,
  });

  return { scored, errorRate, total };
}

/**
 * Process up to CHUNK_SIZE pending predictions for a run.
 * Returns { done, remaining, finished }.
 */
export async function processRunChunk(env, runId, { limit = CHUNK_SIZE } = {}) {
  const { run, model, provider, method, apiKey } = await getRunBundle(env, runId);
  if (['approved', 'published', 'rejected', 'cancelled'].includes(run.status)) {
    return { done: 0, remaining: 0, finished: true, status: run.status };
  }

  if (run.status === 'queued' || run.status === 'draft') {
    await patchRun(env, runId, {
      status: 'running',
      started_at: run.started_at || new Date().toISOString(),
    });
  }

  const pending = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_predictions',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}&status=eq.pending&select=id,item_id&order=created_at.asc&limit=${Math.max(1, limit)}`,
  });
  const batch = Array.isArray(pending) ? pending : [];
  if (!batch.length) {
    await finalizeRun(env, runId, method);
    return { done: 0, remaining: 0, finished: true, status: 'needs_review' };
  }

  const itemIds = batch.map((b) => b.item_id);
  const filter = itemIds.map((id) => `"${id}"`).join(',');
  const items = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_items',
    serviceRole: true,
    query: `?id=in.(${filter})&select=*`,
  });
  const itemById = new Map((Array.isArray(items) ? items : []).map((i) => [i.id, i]));
  const prompt = method.prompt_template || 'Return JSON ratings for the urban image.';

  let done = 0;
  for (const row of batch) {
    const item = itemById.get(row.item_id);
    if (!item) {
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_predictions',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(row.id)}`,
        body: { status: 'error', error_message: 'Item missing' },
        prefer: 'return=minimal',
      });
      done += 1;
      continue;
    }
    try {
      const urls = Array.isArray(item.media_urls) ? item.media_urls : [];
      const result = await evaluateItemWithProvider({
        provider,
        apiKey,
        modelId: model.model_id,
        prompt,
        imageUrls: urls,
      });
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_predictions',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(row.id)}`,
        body: {
          status: 'ok',
          prediction: result.prediction,
          latency_ms: result.latencyMs,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          error_message: null,
        },
        prefer: 'return=minimal',
      });
    } catch (err) {
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_predictions',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(row.id)}`,
        body: {
          status: 'error',
          error_message: String(err.message || err).slice(0, 500),
        },
        prefer: 'return=minimal',
      });
    }
    done += 1;
  }

  const counts = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_predictions',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}&select=status`,
  });
  const all = Array.isArray(counts) ? counts : [];
  const pendingLeft = all.filter((r) => r.status === 'pending').length;
  const completed = all.length - pendingLeft;
  await patchRun(env, runId, {
    status: 'running',
    progress_done: completed,
    progress_total: all.length,
  });

  if (!pendingLeft) {
    await finalizeRun(env, runId, method);
    return { done, remaining: 0, finished: true, status: 'needs_review' };
  }
  return { done, remaining: pendingLeft, finished: false, status: 'running' };
}

export async function enqueueOrProcess(env, ctx, runId) {
  if (env.SP_BENCH_QUEUE && typeof env.SP_BENCH_QUEUE.send === 'function') {
    await env.SP_BENCH_QUEUE.send({ runId, type: 'process_chunk' });
    return { mode: 'queue' };
  }
  // Local Express / Workers without queue: process with waitUntil / fire-and-forget.
  const loop = async () => {
    let guard = 0;
    while (guard < 200) {
      const result = await processRunChunk(env, runId);
      if (result.finished) break;
      guard += 1;
    }
  };
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(loop());
  } else {
    // Express: do not block HTTP forever — kick off async chain.
    Promise.resolve().then(loop).catch(() => {});
  }
  return { mode: 'inline' };
}
