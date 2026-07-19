/**
 * Survey response list / export / light summary for Agent + MCP.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { loadOwned } from './projectLifecycle.mjs';
import { buildResponsesWideCsv, flattenQuestions, qualityFlags } from '../results/wideExport.mjs';

const LIST_DEFAULT_LIMIT = 100;
const EXPORT_MAX = 5000;

function draftConfig(row) {
  return row.survey_config_draft ?? row.survey_config ?? {};
}

function parseFilters(raw = {}) {
  return {
    includePractice: Boolean(raw.includePractice),
    dateFrom: raw.dateFrom ? String(raw.dateFrom) : null,
    dateTo: raw.dateTo ? String(raw.dateTo) : null,
    sessionId: raw.sessionId ? String(raw.sessionId) : null,
    includeAnswers: Boolean(raw.includeAnswers),
    limit: Math.min(Math.max(Number(raw.limit) || LIST_DEFAULT_LIMIT, 1), EXPORT_MAX),
    offset: Math.max(Number(raw.offset) || 0, 0),
    excludeFlagged: Boolean(raw.excludeFlagged),
  };
}

function rowTimestamp(row) {
  return row.created_at || row.survey_metadata?.completion_time || null;
}

function filterRows(rows, filters, surveyConfig) {
  let out = Array.isArray(rows) ? [...rows] : [];
  if (!filters.includePractice) {
    out = out.filter((r) => !r.survey_metadata?.practice_mode);
  }
  if (filters.sessionId) {
    out = out.filter((r) => r.survey_metadata?.session_id === filters.sessionId);
  }
  if (filters.dateFrom) {
    const start = new Date(`${filters.dateFrom}T00:00:00`);
    out = out.filter((r) => {
      const ts = rowTimestamp(r);
      return !ts || new Date(ts) >= start;
    });
  }
  if (filters.dateTo) {
    const end = new Date(`${filters.dateTo}T23:59:59`);
    out = out.filter((r) => {
      const ts = rowTimestamp(r);
      return !ts || new Date(ts) <= end;
    });
  }
  if (filters.excludeFlagged && surveyConfig) {
    out = out.filter((r) => qualityFlags(r, surveyConfig, out).length === 0);
  }
  return out;
}

function metaSummary(meta = {}) {
  return {
    completion_code: meta.completion_code || null,
    session_id: meta.session_id || null,
    attempt_index: meta.attempt_index ?? null,
    practice_mode: Boolean(meta.practice_mode),
    practice_question: meta.practice_question || null,
    timing_total_seconds: meta.timing?.total_seconds ?? null,
    browser_id: meta.browser_id || null,
  };
}

function answerQuestionCount(responses) {
  if (!responses || typeof responses !== 'object') return 0;
  return Object.keys(responses).filter((k) => {
    const v = responses[k];
    if (v == null || v === '') return false;
    if (typeof v === 'object' && !Array.isArray(v) && 'answer' in v) {
      return v.answer != null && v.answer !== '';
    }
    return true;
  }).length;
}

function hasAnswer(qData) {
  if (qData == null || qData === '') return false;
  if (typeof qData === 'object' && !Array.isArray(qData)) {
    if (Array.isArray(qData.trials) && qData.trials.length) {
      return qData.trials.some((t) => t?.answer != null && t.answer !== '');
    }
    if ('answer' in qData) return qData.answer != null && qData.answer !== '';
  }
  return true;
}

async function fetchAllResponses(env, projectId) {
  // Ownership already verified; service role avoids opaque-token RLS gaps.
  const rows = await supabaseRest(env, {
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc`,
  });
  return Array.isArray(rows) ? rows : [];
}

function toFullRow(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    participant_id: row.participant_id,
    created_at: row.created_at,
    responses: row.responses || {},
    displayed_images: row.displayed_images || null,
    survey_metadata: row.survey_metadata || {},
  };
}

/**
 * List response summaries for an owned project.
 */
export async function listResponses(env, ctx, projectId, filters = {}) {
  const project = await loadOwned(env, { ...ctx, projectId });
  const opts = parseFilters(filters);
  const surveyConfig = draftConfig(project);
  const all = await fetchAllResponses(env, projectId);
  const filtered = filterRows(all, opts, surveyConfig);
  const slice = filtered.slice(opts.offset, opts.offset + opts.limit);

  return {
    success: true,
    projectId,
    total: filtered.length,
    offset: opts.offset,
    limit: opts.limit,
    hasMore: opts.offset + slice.length < filtered.length,
    filters: {
      includePractice: opts.includePractice,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      sessionId: opts.sessionId,
      includeAnswers: opts.includeAnswers,
    },
    responses: slice.map((row) => {
      const base = {
        id: row.id,
        project_id: row.project_id,
        participant_id: row.participant_id,
        created_at: row.created_at,
        survey_metadata: metaSummary(row.survey_metadata || {}),
        answer_question_count: answerQuestionCount(row.responses),
      };
      if (opts.includeAnswers) {
        base.responses = row.responses || {};
        base.displayed_images = row.displayed_images || null;
      }
      return base;
    }),
  };
}

/**
 * Export responses as JSON and/or wide CSV.
 */
export async function exportResponses(env, ctx, projectId, filters = {}) {
  const project = await loadOwned(env, { ...ctx, projectId });
  const opts = parseFilters({
    ...filters,
    limit: filters.limit != null ? filters.limit : EXPORT_MAX,
  });
  const format = String(filters.format || 'json').toLowerCase();
  if (!['json', 'wide_csv', 'both'].includes(format)) {
    throw Object.assign(new Error('format must be json, wide_csv, or both'), { status: 400 });
  }

  const surveyConfig = draftConfig(project);
  const all = await fetchAllResponses(env, projectId);
  const filtered = filterRows(all, opts, surveyConfig);
  if (filtered.length > EXPORT_MAX) {
    throw Object.assign(
      new Error(`Too many responses (${filtered.length}). Narrow filters (max ${EXPORT_MAX}).`),
      { status: 400, code: 'EXPORT_TOO_LARGE' },
    );
  }

  const questions = flattenQuestions(surveyConfig);
  const result = {
    success: true,
    projectId,
    format,
    n: filtered.length,
    note: 'Custom skill answers are exported as stored JSON. Platform does not provide dedicated skill analysis via MCP.',
  };

  if (format === 'json' || format === 'both') {
    result.responses = filtered.map(toFullRow);
  }
  if (format === 'wide_csv' || format === 'both') {
    result.wideCsv = buildResponsesWideCsv(filtered, questions, surveyConfig);
    result.wideCsvFilename = `responses_wide_${projectId}_${new Date().toISOString().slice(0, 10)}.csv`;
  }
  return result;
}

/**
 * Light summary for quick inspection (not full Admin Results Analysis).
 */
export async function summarizeResponses(env, ctx, projectId, filters = {}) {
  const project = await loadOwned(env, { ...ctx, projectId });
  const opts = parseFilters({ ...filters, limit: EXPORT_MAX });
  const surveyConfig = draftConfig(project);
  const all = await fetchAllResponses(env, projectId);
  const nPractice = all.filter((r) => r.survey_metadata?.practice_mode).length;
  const filtered = filterRows(all, { ...opts, excludeFlagged: false }, surveyConfig);

  let flagged = 0;
  const flagCounts = {};
  filtered.forEach((row) => {
    const flags = qualityFlags(row, surveyConfig, filtered);
    if (flags.length) {
      flagged += 1;
      flags.forEach((f) => {
        flagCounts[f] = (flagCounts[f] || 0) + 1;
      });
    }
  });

  const forAnalysis = opts.excludeFlagged
    ? filtered.filter((r) => qualityFlags(r, surveyConfig, filtered).length === 0)
    : filtered;

  const timestamps = forAnalysis.map(rowTimestamp).filter(Boolean).map((t) => new Date(t).getTime());
  const questions = flattenQuestions(surveyConfig).filter((q) => q?.name && q.type !== 'html' && q.type !== 'expression');

  const perQuestion = questions.map((q) => {
    let nAnswered = 0;
    forAnalysis.forEach((row) => {
      if (hasAnswer(row.responses?.[q.name])) nAnswered += 1;
    });
    return { name: q.name, type: q.type || 'unknown', n_answered: nAnswered };
  });

  return {
    success: true,
    projectId,
    projectName: project.name,
    n_total: all.length,
    n_practice: nPractice,
    n_in_export: forAnalysis.length,
    n_flagged: flagged,
    flag_counts: flagCounts,
    date_from: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    date_to: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    questions: perQuestion,
    filters: {
      includePractice: opts.includePractice,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      sessionId: opts.sessionId,
      excludeFlagged: opts.excludeFlagged,
    },
    note: 'Light summary only. Use survey_export_responses for full data; Admin Results Analysis has charts/TrueSkill/etc.',
  };
}

/**
 * Delete one response row for an owned project.
 */
export async function deleteResponse(env, ctx, projectId, body = {}) {
  await loadOwned(env, { ...ctx, projectId });
  const responseId = body.responseId ?? body.id;
  if (responseId == null || responseId === '') {
    throw Object.assign(new Error('responseId is required'), { status: 400 });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(String(responseId))}&project_id=eq.${encodeURIComponent(projectId)}&select=id`,
  });
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('Response not found for this project'), { status: 404 });
  }
  await supabaseRest(env, {
    path: '/rest/v1/survey_responses',
    method: 'DELETE',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(String(responseId))}&project_id=eq.${encodeURIComponent(projectId)}`,
  });
  return { success: true, projectId, responseId: String(responseId), deleted: true };
}
