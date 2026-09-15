import { supabaseRest } from '../../supabaseUserClient.mjs';
import { RUNTIME_VERSION } from './events.mjs';

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

export async function createSession(env, { userId, projectId, mode = 'designer', title, provider, model, reasoningEffort }) {
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

export async function listSessions(env, userId, { projectId, mode } = {}) {
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
      query: build('id,project_id,mode,title,provider,model,reasoning_effort,selection_locked,updated_at,created_at'),
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

export async function createRun(env, { sessionId, userId, projectId, provider, model }) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'POST',
    serviceRole: true,
    body: {
      session_id: sessionId,
      user_id: userId,
      project_id: projectId || null,
      status: 'running',
      provider,
      model,
      started_at: new Date().toISOString(),
    },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function finishRun(env, runId, patch) {
  await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}`,
    body: {
      ...patch,
      finished_at: new Date().toISOString(),
    },
    prefer: 'return=minimal',
  });
}

export async function cancelRun(env, userId, runId) {
  await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: { status: 'cancelled', finished_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return { success: true };
}

export { RUNTIME_VERSION };
