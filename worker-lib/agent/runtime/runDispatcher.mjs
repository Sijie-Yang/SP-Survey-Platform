const MAX_QUEUE_ATTEMPTS = 5;

async function execute(job, env, ctx) {
  if (job?.kind === 'silicon') {
    const { executeSiliconJob } = await import('../../silicon/runner.mjs');
    return executeSiliconJob(env, job, ctx);
  }
  const { executeQueuedDesignerRun } = await import('./designerChat.mjs');
  return executeQueuedDesignerRun(env, job, ctx);
}

export async function dispatchAgentRun(env, ctx, job, { executeRun = execute, delaySeconds = 0 } = {}) {
  const delay = Math.max(0, Number(delaySeconds) || 0);
  const nextJob = {
    ...job,
    claimedBy: job.claimedBy || (job.runId
      ? `queue:${job.runId}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
      : job.claimedBy),
  };
  const options = { contentType: 'json' };
  if (delay > 0) options.delaySeconds = delay;

  if (env.AGENT_QUEUE?.send) {
    await env.AGENT_QUEUE.send(nextJob, options);
    return { dispatch: 'queue', delaySeconds: delay, claimedBy: nextJob.claimedBy };
  }

  const start = () => executeRun(nextJob, env, ctx).catch(() => null);

  // Local Worker/dev fallback keeps the same asynchronous HTTP contract.
  if (ctx?.waitUntil) {
    ctx.waitUntil(delay > 0
      ? new Promise((resolve) => { setTimeout(() => resolve(start()), delay * 1000); })
      : start());
    return { dispatch: 'waitUntil', delaySeconds: delay, claimedBy: nextJob.claimedBy };
  }

  if (delay > 0) {
    await new Promise((resolve) => { setTimeout(resolve, delay * 1000); });
  }
  await executeRun(nextJob, env, ctx);
  return { dispatch: 'inline', delaySeconds: delay, claimedBy: nextJob.claimedBy };
}

export async function processAgentQueue(batch, env, { executeRun = execute } = {}) {
  for (const message of batch.messages || []) {
    try {
      await executeRun(message.body, env);
      message.ack();
    } catch (error) {
      if ((message.attempts || 1) >= MAX_QUEUE_ATTEMPTS || error?.retryable === false) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
