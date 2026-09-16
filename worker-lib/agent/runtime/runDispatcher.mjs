const MAX_QUEUE_ATTEMPTS = 5;

async function execute(job, env) {
  const { executeQueuedDesignerRun } = await import('./designerChat.mjs');
  return executeQueuedDesignerRun(env, job);
}

export async function dispatchAgentRun(env, ctx, job, { executeRun = execute } = {}) {
  if (env.AGENT_QUEUE?.send) {
    await env.AGENT_QUEUE.send(job, {
      contentType: 'json',
    });
    return { dispatch: 'queue' };
  }

  // Local Worker/dev fallback keeps the same asynchronous HTTP contract.
  if (ctx?.waitUntil) {
    ctx.waitUntil(executeRun(job, env).catch(() => null));
    return { dispatch: 'waitUntil' };
  }

  // Unit tests and the Node adapter do not always provide an ExecutionContext.
  // Execute inline there, while returning the same run identifiers to callers.
  await executeRun(job, env);
  return { dispatch: 'inline' };
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
