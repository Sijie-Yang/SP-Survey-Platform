import { rpc, supabaseRest } from '../../supabaseUserClient.mjs';
import { eventsToModelMessages, RUNTIME_VERSION } from './events.mjs';

export function nextSessionSelection(session, requested = {}) {
  const incoming = {
    provider: requested.provider || null,
    model: requested.model || null,
    effort: requested.effort || requested.reasoningEffort || null,
  };
  if (!session) {
    return { ...incoming, pin: true, changed: true, reason: 'new' };
  }
  const current = {
    provider: session.provider || null,
    model: session.model || null,
    effort: session.reasoning_effort || null,
  };
  const explicit = Boolean(requested.provider && requested.model);
  const changed = explicit && (
    incoming.provider !== current.provider
    || incoming.model !== current.model
    || (incoming.effort || null) !== (current.effort || null)
  );
  if (session.selection_locked && !changed) {
    return { ...current, pin: false, changed: false, reason: 'pinned' };
  }
  if (changed) {
    return { ...incoming, pin: true, changed: true, reason: 'switch' };
  }
  if (!session.selection_locked) {
    return {
      provider: incoming.provider || current.provider,
      model: incoming.model || current.model,
      effort: incoming.effort || current.effort,
      pin: true,
      changed: false,
      reason: 'first',
    };
  }
  return { ...current, pin: false, changed: false, reason: 'pinned' };
}

export async function createSession(env, {
  userId,
  projectId,
  mode = 'designer',
  assistantMode = 'agent',
  title,
  provider,
  model,
  reasoningEffort,
}) {
  const now = new Date().toISOString();
  const body = {
    user_id: userId,
    project_id: projectId || null,
    mode,
    title: title || 'New chat',
    status: 'active',
    provider: provider || null,
    model: model || null,
    created_at: now,
    updated_at: now,
    assistant_mode: assistantMode,
  };
  if (reasoningEffort != null) body.reasoning_effort = reasoningEffort;
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch {
    delete body.reasoning_effort;
    delete body.assistant_mode;
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }
}

export async function updateSessionSelection(env, sessionId, { provider, model, effort }) {
  const patch = {
    provider,
    model,
    selection_locked: true,
    updated_at: new Date().toISOString(),
  };
  if (effort !== undefined) patch.reasoning_effort = effort;
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(sessionId)}`,
      body: patch,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch {
    delete patch.reasoning_effort;
    delete patch.selection_locked;
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(sessionId)}`,
      body: patch,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }
}

export async function updateSessionAssistantMode(env, sessionId, assistantMode) {
  try {
    await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(sessionId)}`,
      body: {
        assistant_mode: assistantMode,
        updated_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    });
  } catch {
    // Older schemas derive the current mode from append-only events.
  }
}

export async function listSessions(env, userId, { projectId, mode } = {}) {
  await expireStaleAiRuns(env, { userId }).catch(() => null);
  const build = (select) => {
    let query = `?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=${select}&order=updated_at.desc&limit=40`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    if (mode) query += `&mode=eq.${encodeURIComponent(mode)}`;
    return query;
  };
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      serviceRole: true,
      query: build('id,project_id,mode,assistant_mode,title,provider,model,reasoning_effort,selection_locked,updated_at,created_at'),
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_sessions',
      serviceRole: true,
      query: build('id,project_id,mode,title,provider,model,updated_at,created_at'),
    });
    return Array.isArray(rows) ? rows : [];
  }
}

export async function getSession(env, userId, sessionId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_sessions',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function renameSession(env, userId, sessionId, title) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_sessions',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: { title: String(title || '').slice(0, 120), updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function archiveSession(env, userId, sessionId) {
  await supabaseRest(env, {
    path: '/rest/v1/ai_sessions',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: { status: 'archived', updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return { success: true };
}

export async function listEvents(env, sessionId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_session_events',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}&select=seq,type,payload,run_id,created_at&order=seq.asc`,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listEventsAfter(env, sessionId, after = 0, limit = 500) {
  const safeAfter = Math.max(0, Number(after) || 0);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_session_events',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}`
      + `&seq=gt.${safeAfter}`
      + '&select=seq,type,payload,run_id,created_at'
      + `&order=seq.asc&limit=${safeLimit}`,
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * The append-only event stream is authoritative. This projection is used by
 * resumed/background runs instead of a separately maintained chat history.
 */
export function deriveModelHistory(events, options) {
  return eventsToModelMessages(events, options);
}

export async function loadModelHistory(env, sessionId, options) {
  return deriveModelHistory(await listEvents(env, sessionId), options);
}

export async function nextSeq(env, sessionId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_session_events',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}&select=seq&order=seq.desc&limit=1`,
  });
  const last = Array.isArray(rows) ? rows[0] : null;
  return (last?.seq || 0) + 1;
}

export async function appendEvent(env, { sessionId, runId, type, payload }) {
  try {
    return await rpc(env, 'append_ai_session_event', {
      p_session_id: sessionId,
      p_run_id: runId || null,
      p_type: type,
      p_payload: payload || {},
    }, null, { serviceRole: true });
  } catch (error) {
    // Backward-compatible until the additive ai_runtime.sql migration is run.
    if (!/function|schema cache|append_ai_session_event/i.test(String(error?.message || ''))) {
      throw error;
    }
  }
  const seq = await nextSeq(env, sessionId);
  await supabaseRest(env, {
    path: '/rest/v1/ai_session_events',
    method: 'POST',
    serviceRole: true,
    body: {
      session_id: sessionId,
      run_id: runId || null,
      seq,
      type,
      payload: payload || {},
    },
    prefer: 'return=minimal',
  });
  await supabaseRest(env, {
    path: '/rest/v1/ai_sessions',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(sessionId)}`,
    body: { updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return seq;
}

export async function createRun(env, {
  sessionId,
  userId,
  projectId,
  provider,
  model,
  status = 'running',
  assistantMode = 'agent',
  requestPayload = {},
  parentRunId = null,
  inboxId = null,
}) {
  const body = {
    session_id: sessionId,
    user_id: userId,
    project_id: projectId || null,
    status,
    provider,
    model,
    started_at: status === 'running' ? new Date().toISOString() : null,
    mode: assistantMode,
    assistant_mode: assistantMode,
    request_payload: {
      ...requestPayload,
      ...(parentRunId ? { parentRunId } : {}),
      ...(inboxId ? { inboxId } : {}),
    },
    updated_at: new Date().toISOString(),
    ...(parentRunId ? { parent_run_id: parentRunId } : {}),
    ...(inboxId ? { inbox_id: inboxId } : {}),
  };
  try {
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_runs',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    delete body.mode;
    delete body.request_payload;
    delete body.updated_at;
    try {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/ai_runs',
        method: 'POST',
        serviceRole: true,
        body,
        prefer: 'return=representation',
      });
      return Array.isArray(rows) ? rows[0] : rows;
    } catch {
      throw Object.assign(new Error('Assistant run columns are not applied'), {
        status: 503,
        code: 'ASSISTANT_RUN_SCHEMA_MISSING',
        cause: error,
      });
    }
  }
}

export const TERMINAL_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed']);
export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);

function firstRow(rows) {
  if (Array.isArray(rows)) return rows[0] || null;
  return rows || null;
}

async function patchRun(env, runId, body, extraQuery = '', { required = false } = {}) {
  const query = `?id=eq.${encodeURIComponent(runId)}${extraQuery}`;
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'PATCH',
    serviceRole: true,
    query,
    body,
    prefer: 'return=representation',
  });
  const row = firstRow(rows);
  if (required && !row) {
    throw Object.assign(new Error('Run was not updated.'), {
      code: 'RUN_NOT_UPDATED',
      retryable: false,
    });
  }
  return row;
}

export async function finishRun(env, runId, patch) {
  const body = {
    ...patch,
    claimed_by: null,
    lease_expires_at: null,
    updated_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
  try {
    return await patchRun(
      env,
      runId,
      body,
      '&status=in.(queued,running,awaiting_approval)',
    );
  } catch {
    delete body.updated_at;
    delete body.result;
    delete body.checkpoint;
    delete body.approval_request;
    delete body.claimed_by;
    delete body.lease_expires_at;
    return patchRun(env, runId, body, '&status=in.(queued,running,awaiting_approval)');
  }
}

export async function markRunRunning(env, runId) {
  const now = new Date().toISOString();
  const row = await patchRun(
    env,
    runId,
    { status: 'running', started_at: now, updated_at: now },
    '&status=in.(queued,running)',
    { required: true },
  );
  return row;
}

export async function claimRun(env, runId, claimedBy, { leaseSeconds = 90 } = {}) {
  const current = await getRunStatus(env, runId);
  if (!current) {
    throw Object.assign(new Error('Run not found.'), { code: 'RUN_NOT_FOUND', retryable: false });
  }
  if (TERMINAL_RUN_STATUSES.has(current.status)) {
    return null;
  }
  try {
    const claimed = await rpc(env, 'claim_ai_run', {
      p_run_id: runId,
      p_claimed_by: claimedBy,
      p_lease_seconds: leaseSeconds,
    }, null, { serviceRole: true });
    return firstRow(claimed);
  } catch {
    const now = new Date();
    const leaseValid = current.claimed_by
      && current.claimed_by !== claimedBy
      && current.lease_expires_at
      && Date.parse(current.lease_expires_at) > now.getTime();
    if (leaseValid) return null;
    try {
      return await patchRun(env, runId, {
        status: 'running',
        claimed_by: claimedBy,
        lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        started_at: current.started_at || now.toISOString(),
        updated_at: now.toISOString(),
      }, '&status=in.(queued,running)', { required: true });
    } catch (error) {
      if (error?.code === 'RUN_NOT_UPDATED') return null;
      throw error;
    }
  }
}

export async function getRunStatus(env, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&select=*&limit=1`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function isRunCancellationRequested(env, runId) {
  const run = await getRunStatus(env, runId);
  return run?.status === 'cancelled' || run?.cancel_requested === true;
}

export async function refreshRunLease(env, runId, claimedBy, { leaseSeconds = 90 } = {}) {
  if (!runId || !claimedBy) return null;
  try {
    return firstRow(await rpc(env, 'claim_ai_run', {
      p_run_id: runId,
      p_claimed_by: claimedBy,
      p_lease_seconds: leaseSeconds,
    }, null, { serviceRole: true }));
  } catch {
    const now = new Date();
    return patchRun(env, runId, {
      lease_expires_at: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
      updated_at: now.toISOString(),
    }, `&claimed_by=eq.${encodeURIComponent(claimedBy)}&status=eq.running`).catch(() => null);
  }
}

function runWasUserCancelled(row) {
  return row?.cancel_requested === true || row?.status === 'cancelled';
}

export async function expireStaleAiRuns(env, { userId } = {}) {
  const now = new Date().toISOString();
  let query = `?status=eq.running&lease_expires_at=lt.${encodeURIComponent(now)}`
    + '&select=id,user_id,status,checkpoint,checkpoint_seq,cancel_requested,claimed_by,lease_expires_at&limit=20';
  if (userId) query += `&user_id=eq.${encodeURIComponent(userId)}`;
  let rows = [];
  try {
    rows = await supabaseRest(env, {
      path: '/rest/v1/ai_runs',
      serviceRole: true,
      query,
    });
  } catch {
    return { expired: [], released: [], cancelled: [] };
  }
  const released = [];
  const cancelled = [];
  for (const row of rows || []) {
    if (!row?.id) continue;
    if (runWasUserCancelled(row)) {
      await finishRun(env, row.id, {
        status: 'cancelled',
        cancel_requested: true,
        error_summary: 'Cancelled by the user.',
      }).catch(() => null);
      cancelled.push(row.id);
      continue;
    }
    // Executor lease expiry is not user abandonment. Release the holder so a
    // delayed queue continue or list-sessions refresh can reclaim the checkpoint.
    // CAS on the expired timestamp so a concurrent refresh wins cleanly.
    const releasedRow = await patchRun(env, row.id, {
      claimed_by: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }, `&status=eq.running&lease_expires_at=lt.${encodeURIComponent(now)}`).catch(() => null);
    if (releasedRow?.id) released.push(row.id);
  }
  return { expired: [...released, ...cancelled], released, cancelled };
}

/**
 * Cheap cooperative cancellation probe for the model/tool loop. The returned
 * callback is intentionally compatible with runToolLoop({ checkCancelled }).
 */
export function createRunCancellationCheck(env, runId, {
  signal,
  claimedBy = null,
  cacheMs = 250,
  refreshEveryMs = 20000,
  now = () => Date.now(),
} = {}) {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let refreshedAt = Number.NEGATIVE_INFINITY;
  let cancelled = false;
  return async () => {
    if (signal?.aborted || cancelled) return true;
    const current = now();
    if (current - checkedAt < cacheMs) return false;
    checkedAt = current;
    if (claimedBy && current - refreshedAt >= refreshEveryMs) {
      refreshedAt = current;
      await refreshRunLease(env, runId, claimedBy).catch(() => null);
    }
    cancelled = await isRunCancellationRequested(env, runId);
    return cancelled || Boolean(signal?.aborted);
  };
}

export async function cancelRun(env, userId, runId) {
  const query = `?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(userId)}`;
  try {
    await supabaseRest(env, {
      path: '/rest/v1/ai_runs',
      method: 'PATCH',
      serviceRole: true,
      query,
      body: {
        status: 'cancelled',
        cancel_requested: true,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
      prefer: 'return=minimal',
    });
  } catch {
    await supabaseRest(env, {
      path: '/rest/v1/ai_runs',
      method: 'PATCH',
      serviceRole: true,
      query,
      body: { status: 'cancelled', finished_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }
  const run = await getOwnedRun(env, userId, runId).catch(() => null);
  if (run?.session_id) {
    await voidQueuedSessionInput(env, run.session_id);
  }
  return { success: true };
}

export async function voidQueuedSessionInput(env, sessionId) {
  if (!sessionId) return { success: true };
  await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    method: 'PATCH',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}&status=eq.queued`,
    body: { status: 'voided', claimed_at: new Date().toISOString() },
    prefer: 'return=minimal',
  }).catch(() => null);
  return { success: true };
}

export async function getOwnedRun(env, userId, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}`
      + `&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function listSessionRuns(env, userId, sessionId, limit = 20) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}`
      + `&user_id=eq.${encodeURIComponent(userId)}`
      + `&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(100, Number(limit) || 20))}`,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function updateRunCheckpoint(env, runId, checkpoint, status = 'running') {
  const current = await getRunStatus(env, runId);
  if (!current || TERMINAL_RUN_STATUSES.has(current.status)) {
    throw Object.assign(new Error('Checkpoint was not saved onto an active run.'), {
      code: 'CHECKPOINT_NOT_SAVED',
      retryable: false,
    });
  }
  const row = await patchRun(env, runId, {
    checkpoint: checkpoint || {},
    status,
    checkpoint_seq: Number(current.checkpoint_seq || 0) + 1,
    updated_at: new Date().toISOString(),
  }, '&status=in.(queued,running,awaiting_approval)', { required: true });
  if (!row) {
    throw Object.assign(new Error('Checkpoint was not saved.'), {
      code: 'CHECKPOINT_NOT_SAVED',
      retryable: false,
    });
  }
  return row;
}

export async function enqueueSessionInput(env, {
  sessionId,
  userId,
  content,
  kind = 'followup',
  target = 'next-step',
  payload = {},
}) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    method: 'POST',
    serviceRole: true,
    body: {
      session_id: sessionId,
      user_id: userId,
      content: String(content || '').slice(0, 12000),
      kind,
      target,
      status: 'queued',
      payload: payload && typeof payload === 'object' ? payload : {},
    },
    prefer: 'return=representation',
  }).catch(async (error) => {
    if (!/payload|schema cache|column/i.test(String(error?.message || ''))) throw error;
    return supabaseRest(env, {
      path: '/rest/v1/ai_agent_inbox',
      method: 'POST',
      serviceRole: true,
      body: {
        session_id: sessionId,
        user_id: userId,
        content: String(content || '').slice(0, 12000),
        kind,
        target,
        status: 'queued',
      },
      prefer: 'return=representation',
    });
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function markInboxFailed(env, itemId, errorSummary = '', existingPayload = {}) {
  if (!itemId) return;
  const payload = {
    ...(existingPayload && typeof existingPayload === 'object' ? existingPayload : {}),
    error: String(errorSummary || 'dispatch failed').slice(0, 400),
  };
  await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(itemId)}`,
    body: { status: 'failed', payload },
    prefer: 'return=minimal',
  }).catch(async () => {
    await supabaseRest(env, {
      path: '/rest/v1/ai_agent_inbox',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(itemId)}`,
      body: { status: 'failed' },
      prefer: 'return=minimal',
    }).catch(() => null);
  });
}

function inboxTargetIsImmediate(target) {
  return !target || target === 'next-step' || target === 'current';
}

export async function claimSessionInput(env, sessionId, { includeAfterRun = false } = {}) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}`
      + '&status=eq.queued&select=*&order=created_at.asc&limit=20',
  });
  const items = (Array.isArray(rows) ? rows : []).filter((item) => (
    includeAfterRun ? true : inboxTargetIsImmediate(item.target)
  ));
  if (items.length) {
    await supabaseRest(env, {
      path: '/rest/v1/ai_agent_inbox',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=in.(${items.map((item) => item.id).join(',')})`,
      body: { status: 'claimed', claimed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }
  return items;
}

export async function claimAfterRunInput(env, sessionId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}`
      + '&status=eq.queued&select=*&order=created_at.asc&limit=20',
  });
  const next = (Array.isArray(rows) ? rows : []).find((item) => (
    item.target === 'after-run' || item.target === 'after'
  ));
  if (!next) return [];
  await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(next.id)}&status=eq.queued`,
    body: { status: 'claimed', claimed_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return [next];
}

export async function listQueuedSessionInput(env, sessionId) {
  if (!sessionId) return [];
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    serviceRole: true,
    query: `?session_id=eq.${encodeURIComponent(sessionId)}`
      + '&status=eq.queued&select=*&order=created_at.asc&limit=50',
  });
  return Array.isArray(rows) ? rows : [];
}

export async function discardSessionInput(env, userId, itemId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_agent_inbox',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(itemId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.queued`,
    body: { status: 'discarded', claimed_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export { RUNTIME_VERSION };
