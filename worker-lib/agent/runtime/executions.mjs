import { rpc, supabaseRest } from '../../supabaseUserClient.mjs';

function firstRow(rows) {
  if (Array.isArray(rows)) return rows[0] || null;
  return rows || null;
}

export async function getToolExecution(env, runId, toolCallId) {
  if (!env || !runId || !toolCallId) return null;
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_tool_executions',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}`
      + `&tool_call_id=eq.${encodeURIComponent(toolCallId)}&select=*&limit=1`,
  }).catch(() => null);
  return firstRow(rows);
}

export async function recordToolExecution(env, {
  runId,
  toolCallId,
  toolName,
  idempotencyKey,
  status,
  result = null,
}) {
  if (!env || !runId || !toolCallId || !status) return null;
  try {
    const row = await rpc(env, 'record_ai_tool_execution', {
      p_run_id: runId,
      p_tool_call_id: toolCallId,
      p_tool_name: toolName || '',
      p_idempotency_key: idempotencyKey || toolCallId,
      p_status: status,
      p_result: result,
    }, null, { serviceRole: true });
    return firstRow(row);
  } catch {
    const existing = await getToolExecution(env, runId, toolCallId);
    if (existing?.status === 'succeeded') return existing;
    const body = {
      run_id: runId,
      tool_call_id: toolCallId,
      tool_name: toolName || existing?.tool_name || '',
      idempotency_key: idempotencyKey || existing?.idempotency_key || toolCallId,
      status,
      result,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/ai_tool_executions',
        method: 'PATCH',
        serviceRole: true,
        query: `?run_id=eq.${encodeURIComponent(runId)}&tool_call_id=eq.${encodeURIComponent(toolCallId)}`,
        body,
        prefer: 'return=representation',
      });
      return firstRow(rows);
    }
    const rows = await supabaseRest(env, {
      path: '/rest/v1/ai_tool_executions',
      method: 'POST',
      serviceRole: true,
      body,
      prefer: 'return=representation',
    });
    return firstRow(rows);
  }
}

export function createToolExecutionHooks(env, runId) {
  return {
    lookupToolExecution: (toolCallId) => getToolExecution(env, runId, toolCallId),
    recordToolExecution: (entry) => recordToolExecution(env, {
      runId,
      toolCallId: entry.id || entry.toolCallId,
      toolName: entry.name || entry.toolName,
      idempotencyKey: entry.idempotencyKey || entry.id || entry.toolCallId,
      status: entry.status,
      result: entry.result ?? null,
    }),
  };
}
