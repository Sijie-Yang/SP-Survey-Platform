import { readAllResponsePages, responseCursorFilter } from '../../src/lib/responsePagination.js';
import { recordedRevisionSelection, recordedSurveyConfig } from '../../src/lib/recordedSurvey.js';
/**
 * Survey response list / export / light summary for Agent + MCP.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { loadOwned } from './projectLifecycle.mjs';
import { buildResponsesWideCsv, flattenQuestions, qualityFlags } from '../results/wideExport.mjs';
import {
  buildResultsExportBundle,
  buildManifest,
  buildQuestionLongCsv,
  buildQuestionSummaryCsv,
} from '../../src/lib/questionSummaryExport.js';
import { createAnalysisScope, toToolFilters } from '../../src/lib/analysisScope.js';
import {
  computeResultsOverview,
  computeResultsQuestion,
} from '../../src/lib/resultsWorkbench.js';

const LIST_DEFAULT_LIMIT = 100;
const EXPORT_MAX = 5000;
const DISPLAY_ONLY_TYPES = new Set(['expression', 'image', 'html', 'mediadisplay']);

function draftConfig(row) {
  return row.survey_config_draft ?? row.survey_config ?? {};
}

function requireKnownRevision(rows, revision) {
  if (revision && !rows.some((r) => (r.survey_metadata?.survey_revision || 'historical_unknown') === revision)) {
    throw Object.assign(new Error('Requested survey revision was not found in these responses.'), { status: 400, code: 'UNKNOWN_SURVEY_REVISION' });
  }
}

export function parseResultsQuery(raw = {}) {
  const scope = createAnalysisScope(raw);
  return {
    ...toToolFilters(scope),
    view: ['overview', 'question'].includes(raw.view) ? raw.view : (raw.questionName ? 'question' : 'overview'),
    catalogOffset: Math.max(Number(raw.catalogOffset) || 0, 0),
    catalogLimit: Math.min(Math.max(Number(raw.catalogLimit) || 12, 1), 50),
    includeAnswers: Boolean(raw.includeAnswers),
    limit: Math.min(Math.max(Number(raw.limit) || LIST_DEFAULT_LIMIT, 1), EXPORT_MAX),
    offset: Math.max(Number(raw.offset) || 0, 0),
  };
}

function parseFilters(raw = {}) {
  return parseResultsQuery(raw);
}

function rowTimestamp(row) {
  return row.created_at || row.survey_metadata?.completion_time || null;
}

function filterRows(rows, filters, surveyConfig) {
  const scope = createAnalysisScope({
    ...filters,
    includePractice: filters.dataSource === 'practice' ? true : filters.includePractice,
  });
  let out = Array.isArray(rows) ? [...rows] : [];
  if (filters.surveyRevision) {
    out = out.filter((r) => (r.survey_metadata?.survey_revision || 'historical_unknown') === filters.surveyRevision);
  }
  if (scope.dataSource === 'practice') {
    out = out.filter((r) => r.survey_metadata?.practice_mode);
  } else if (!scope.includePractice) {
    out = out.filter((r) => !r.survey_metadata?.practice_mode);
  }
  if (filters.sessionId) {
    out = out.filter((r) => r.survey_metadata?.session_id === filters.sessionId);
  }
  if (filters.dateFrom || filters.dateTo) {
    out = out.filter((r) => {
      const ts = rowTimestamp(r);
      if (!ts) return scope.untimedPolicy === 'include';
      const start = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : -Infinity;
      let end = Infinity;
      if (filters.dateTo) {
        const nextDay = new Date(`${filters.dateTo}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        end = nextDay.getTime();
      }
      return new Date(ts).getTime() >= start && new Date(ts).getTime() < end;
    });
  }
  if (filters.excludeFlagged && surveyConfig) {
    out = out.filter((r) => qualityFlags(r, recordedSurveyConfig([r], surveyConfig), out).length === 0);
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
    survey_revision: meta.survey_revision || null,
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
  return readAllResponsePages((offset, after) => supabaseRest(env, {
    path: '/rest/v1/survey_responses', serviceRole: true,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc.nullslast,id.desc&limit=1000${after ? `&or=${encodeURIComponent(`(${responseCursorFilter(after)})`)}` : ''}`,
  }));
}

async function fetchSiliconResponses(env, projectId, runId) {
  if (!runId) {
    throw Object.assign(new Error('siliconRunId is required when dataSource is silicon.'), {
      status: 400,
      code: 'SILICON_RUN_REQUIRED',
    });
  }
  const runs = await supabaseRest(env, {
    path: '/rest/v1/silicon_runs',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(runId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id&limit=1`,
  });
  if (!Array.isArray(runs) || !runs.length) {
    throw Object.assign(new Error('Silicon run was not found for this project.'), {
      status: 404,
      code: 'SILICON_RUN_NOT_FOUND',
    });
  }
  const rows = await readAllResponsePages((offset, after) => supabaseRest(env, {
    path: '/rest/v1/silicon_responses',
    serviceRole: true,
    query: `?run_id=eq.${encodeURIComponent(runId)}&project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc.nullslast,id.desc&limit=1000${after ? `&or=${encodeURIComponent(`(${responseCursorFilter(after)})`)}` : ''}`,
  }));
  return (rows || []).map((row) => ({
    ...row,
    source: 'silicon',
    survey_metadata: {
      ...(row.survey_metadata || {}),
      silicon_run_id: runId,
    },
  }));
}

async function loadScopedResponses(env, projectId, opts) {
  if (opts.dataSource === 'silicon') return fetchSiliconResponses(env, projectId, opts.siliconRunId);
  return fetchAllResponses(env, projectId);
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
  const all = await loadScopedResponses(env, projectId, opts);
  requireKnownRevision(all, opts.surveyRevision);
  const filtered = filterRows(all, opts, surveyConfig);
  const slice = filtered.slice(opts.offset, opts.offset + opts.limit);

  return {
    success: true,
    projectId,
    total: filtered.length,
    offset: opts.offset,
    limit: opts.limit,
    hasMore: opts.offset + slice.length < filtered.length,
    filters: toToolFilters(opts),
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
  if (!['json', 'wide_csv', 'both', 'long_csv', 'summary_csv', 'analysis_bundle'].includes(format)) {
    throw Object.assign(new Error('format must be json, wide_csv, both, long_csv, summary_csv, or analysis_bundle'), { status: 400 });
  }

  const all = await loadScopedResponses(env, projectId, opts);
  requireKnownRevision(all, opts.surveyRevision);
  opts.surveyRevision = format === 'json' ? opts.surveyRevision : recordedRevisionSelection(all, opts.surveyRevision);
  const surveyConfig = recordedSurveyConfig(all, draftConfig(project), opts.surveyRevision);
  const filtered = filterRows(all, opts, surveyConfig);
  if (filtered.length > EXPORT_MAX) {
    throw Object.assign(
      new Error(`Too many responses (${filtered.length}). Narrow filters (max ${EXPORT_MAX}).`),
      { status: 400, code: 'EXPORT_TOO_LARGE' },
    );
  }

  const allQuestions = flattenQuestions(surveyConfig)
    .filter((q) => q?.name && !DISPLAY_ONLY_TYPES.has(q.type));
  const questions = filters.questionName
    ? allQuestions.filter((q) => q.name === filters.questionName)
    : allQuestions;
  if (filters.questionName && !questions.length) {
    throw Object.assign(new Error(`Question not found: ${filters.questionName}`), { status: 404 });
  }
  const result = {
    kind: 'results',
    success: true,
    projectId,
    format,
    n: filtered.length,
    scope: toToolFilters({ ...opts, projectId, surveyRevision: opts.surveyRevision }),
    surveyRevision: opts.surveyRevision || null,
    availableRevisions: [...new Set(all.map((r) => r.survey_metadata?.survey_revision || 'historical_unknown'))],
    download: {
      format,
      available: true,
      filename: null,
    },
    note: 'Typed Skill exports use the frozen question contract. File bodies are for download, not for model context.',
  };

  if (format === 'json' || format === 'both') {
    result.responses = filtered.map(toFullRow);
  }
  if (format === 'wide_csv' || format === 'both') {
    result.wideCsv = buildResponsesWideCsv(filtered, questions, surveyConfig);
    result.wideCsvFilename = `responses_wide_${projectId}_${new Date().toISOString().slice(0, 10)}.csv`;
  }
  if (['long_csv', 'summary_csv', 'analysis_bundle'].includes(format)) {
    const analyses = questions.map((question) => ({
      question,
      longCsv: buildQuestionLongCsv(question, filtered, surveyConfig),
      summaryCsv: buildQuestionSummaryCsv(question, filtered),
    }));
    if (format === 'long_csv') {
      if (analyses.length === 1) {
        result.longCsv = analyses[0].longCsv;
        result.longCsvFilename = `${analyses[0].question.name}__long.csv`;
      } else {
        result.longCsvFiles = analyses.map(({ question, longCsv }) => ({
          questionName: question.name,
          filename: `${question.name}__long.csv`,
          content: longCsv,
        }));
        result.note = 'Question types have different native long schemas, so multi-question long_csv returns one file per question. Pass questionName for a single CSV.';
      }
    } else if (format === 'summary_csv') {
      if (analyses.length === 1) {
        result.summaryCsv = analyses[0].summaryCsv;
        result.summaryCsvFilename = `${analyses[0].question.name}__summary.csv`;
      } else {
        result.summaryCsvFiles = analyses.map(({ question, summaryCsv }) => ({
          questionName: question.name,
          filename: `${question.name}__summary.csv`,
          content: summaryCsv,
        }));
        result.note = 'Multi-question summary_csv returns one native-format file per question. Pass questionName for a single CSV.';
      }
    } else {
      const manifestFilters = {
        date_from: opts.dateFrom,
        date_to: opts.dateTo,
        session_id: opts.sessionId,
        include_practice: opts.includePractice,
        exclude_flagged: opts.excludeFlagged,
        survey_revision: opts.surveyRevision,
      };
      const files = buildResultsExportBundle({
        project, surveyConfig, questions, filteredResponses: filtered,
        dateFilteredResponses: filterRows(all, { ...opts, excludeFlagged: false }, surveyConfig),
        filters: manifestFilters, excludeFlagged: opts.excludeFlagged,
        wideCsv: buildResponsesWideCsv(filtered, questions, surveyConfig),
      });
      const manifest = JSON.parse(files.find((file) => file.path === 'manifest.json').content);
      result.analysisBundle = { manifest, files };
    }
  }
  return result;
}

/**
 * Light summary for quick inspection (not full Admin Results Analysis).
 */
export async function summarizeResponses(env, ctx, projectId, filters = {}) {
  const project = await loadOwned(env, { ...ctx, projectId });
  const opts = parseFilters({ ...filters, projectId, limit: EXPORT_MAX });
  const all = await loadScopedResponses(env, projectId, opts);
  requireKnownRevision(all, opts.surveyRevision);
  opts.surveyRevision = recordedRevisionSelection(all, opts.surveyRevision);
  const surveyConfig = recordedSurveyConfig(all, draftConfig(project), opts.surveyRevision);
  if (all.length > EXPORT_MAX) {
    throw Object.assign(
      new Error(`Too many responses (${all.length}). Narrow by date or questionName (max ${EXPORT_MAX}); statistics were not truncated or sampled.`),
      { status: 400, code: 'RESULTS_TOO_LARGE' },
    );
  }

  const payload = opts.view === 'question' || opts.questionName
    ? computeResultsQuestion({
      scope: { ...opts, projectId, surveyRevision: opts.surveyRevision },
      rows: all,
      surveyConfig,
    })
    : computeResultsOverview({
      scope: { ...opts, projectId, surveyRevision: opts.surveyRevision },
      rows: all,
      surveyConfig,
    });
  payload.catalogOffset = opts.catalogOffset;
  payload.catalogLimit = opts.catalogLimit;
  payload.projectName = project.name;
  payload.availableRevisions = [...new Set(all.map((r) => r.survey_metadata?.survey_revision || 'historical_unknown'))];
  payload.n_total = all.length;
  payload.n_practice = payload.counts?.nPractice ?? 0;
  payload.n_in_export = payload.counts?.nIncluded ?? 0;
  payload.n_flagged = payload.counts?.nFlagged ?? 0;
  payload.flag_counts = payload.quality?.flagCounts || {};
  payload.filters = toToolFilters(payload.scope || opts);
  payload.questions = (payload.catalog || []).map((item) => ({
    name: item.name,
    type: item.type,
    n_answered: item.nAnswered,
    method: item.method,
    family: item.family,
    summary_rows: payload.question?.questionName === item.name ? (payload.question.metrics || []) : undefined,
  }));
  payload.note = 'Platform-computed metrics. Do not invent statistics. Use view=question for full rows.';
  return payload;
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
