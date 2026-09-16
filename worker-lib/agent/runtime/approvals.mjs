import { supabaseRest } from '../../supabaseUserClient.mjs';
import { appendEvent } from './sessions.mjs';

export const APPROVAL_RISKS = new Set(['publish', 'delete', 'upload']);

export function requiresApproval(tool = {}) {
  return APPROVAL_RISKS.has(tool.risk);
}

export async function requestRunApproval(env, {
  runId,
  sessionId,
  userId,
  toolCallId,
  toolName,
  risk,
  argumentsPreview = {},
}) {
  if (!APPROVAL_RISKS.has(risk)) {
    throw Object.assign(new Error(`Unsupported approval risk: ${risk}`), {
      status: 400,
      code: 'INVALID_APPROVAL_RISK',
    });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_run_approvals',
    method: 'POST',
    serviceRole: true,
    body: {
      run_id: runId,
      session_id: sessionId,
      user_id: userId,
      tool_call_id: toolCallId,
      tool_name: toolName,
      risk,
      arguments_preview: argumentsPreview,
      status: 'pending',
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  const approval = Array.isArray(rows) ? rows[0] : rows;
  await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: {
      status: 'awaiting_approval',
      approval_request: approval || {
        toolCallId,
        toolName,
        risk,
        argumentsPreview,
      },
      updated_at: new Date().toISOString(),
    },
    prefer: 'return=minimal',
  });
  await appendEvent(env, {
    sessionId,
    runId,
    type: 'approval.ask',
    payload: {
      approvalId: approval?.id,
      toolCallId,
      toolName,
      risk,
      argumentsPreview,
    },
  });
  return approval;
}

export async function listPendingApprovals(env, userId, runId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_run_approvals',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}`
      + `&user_id=eq.${encodeURIComponent(userId)}`
      + '&status=eq.pending&select=*&order=created_at.asc',
  });
  return Array.isArray(rows) ? rows : [];
}

export async function answerRunApproval(env, userId, approvalId, approved) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/ai_run_approvals',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(approvalId)}`
      + `&user_id=eq.${encodeURIComponent(userId)}`
      + '&status=eq.pending',
    body: {
      status: approved ? 'approved' : 'denied',
      decided_at: new Date().toISOString(),
    },
    prefer: 'return=representation',
  });
  const approval = Array.isArray(rows) ? rows[0] : rows;
  if (!approval) {
    throw Object.assign(new Error('Approval request not found or already decided.'), {
      status: 404,
      code: 'APPROVAL_NOT_FOUND',
    });
  }
  await appendEvent(env, {
    sessionId: approval.session_id,
    runId: approval.run_id,
    type: 'approval.answer',
    payload: {
      approvalId: approval.id,
      toolCallId: approval.tool_call_id,
      approved: Boolean(approved),
    },
  });
  await supabaseRest(env, {
    path: '/rest/v1/ai_runs',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(approval.run_id)}`
      + `&user_id=eq.${encodeURIComponent(userId)}`,
    body: {
      status: approved ? 'queued' : 'cancelled',
      approval_request: null,
      updated_at: new Date().toISOString(),
      ...(approved ? {} : { finished_at: new Date().toISOString() }),
    },
    prefer: 'return=minimal',
  });
  return { approval, resume: Boolean(approved) };
}
