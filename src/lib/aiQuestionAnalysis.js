/**
 * One-click analysis for a question the platform does not analyse by itself
 * (a page converted online, a custom question, an advanced custom task).
 *
 * The Assistant model reads the question and a few real records and writes a
 * small `analyze(records, helpers)` function. That code runs in a sandbox with
 * no network and no access to the app; it only reshapes the records into
 * blocks. The statistics themselves (TrueSkill, Borda and Kendall's W, Wilson
 * intervals, descriptive stats, word frequency) are the platform's own, run
 * here on the blocks, so the charts and export files match native analysis.
 */
import { computeTrueSkillFromMatches, matchesFromOrderedRanking, trueSkillBoards } from './trueskill.js';
import { descriptiveStats, wilsonCI } from './stats.js';
import { computeBordaScores, kendallW, interpretKendallW } from './rankingStats.js';
import { wordFrequency, textLengthStats } from './textStats.js';

export const AI_ANALYSIS_VERSION = 1;
const SP_SITE_REQUESTS_KEY = '__sp_requests';
const SP_SITE_STATE_KEY = '__sp_page_state';

export const AI_ANALYSIS_BLOCK_TYPES = ['pairwise', 'ranking', 'choice', 'rating', 'text', 'table', 'bar', 'note'];

/**
 * The records the analysis code receives: one per submission.
 * `answer` is what the platform stored for this question (if anything);
 * `page_state` and `requests` are what an uploaded page saved and sent.
 */
export function buildAnalysisRecords(rows, question, { site = false } = {}) {
  const name = question?.name;
  const out = [];
  (rows || []).forEach((row, index) => {
    const responses = row?.responses && typeof row.responses === 'object' ? row.responses : {};
    const record = {
      participant_id: row?.participant_id || row?.id || `row_${index + 1}`,
      submitted_at: row?.created_at || row?.submitted_at || null,
    };
    if (name && !question?.pageOnly && responses[name] !== undefined && responses[name] !== null) {
      // Exactly as stored, so the code sees the same thing as the export.
      record.answer = responses[name];
      const shown = row?.displayed_images?.[name] || row?.displayed_images?.[`${name}__trials`];
      if (Array.isArray(shown) && shown.length) record.shown = shown;
    }
    if (site || question?.pageOnly) {
      if (responses[SP_SITE_STATE_KEY] !== undefined) record.page_state = responses[SP_SITE_STATE_KEY];
      if (Array.isArray(responses[SP_SITE_REQUESTS_KEY])) record.requests = responses[SP_SITE_REQUESTS_KEY];
    }
    const hasData = record.answer !== undefined || record.page_state !== undefined || (record.requests && record.requests.length);
    if (hasData) out.push(record);
  });
  return out;
}

/** A string that holds a JSON object or array (pages often save state this way). */
function jsonInString(value) {
  if (typeof value !== 'string' || value.length < 2 || !/^\s*[[{]/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export const JSON_STRING_MARK = '(JSON string — helpers.parse it)';

function clipValue(value, depth = 0) {
  const inner = jsonInString(value);
  if (inner !== undefined) return { [JSON_STRING_MARK]: clipValue(inner, depth + 1) };
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…(${value.length} chars)` : value;
  if (!value || typeof value !== 'object') return value;
  if (depth > 6) return Array.isArray(value) ? `[array of ${value.length}]` : '{…}';
  if (Array.isArray(value)) {
    const head = value.slice(0, 4).map((item) => clipValue(item, depth + 1));
    if (value.length > 4) head.push(`…${value.length - 4} more items`);
    return head;
  }
  const out = {};
  Object.keys(value).slice(0, 40).forEach((key) => { out[key] = clipValue(value[key], depth + 1); });
  if (Object.keys(value).length > 40) out['…'] = `${Object.keys(value).length - 40} more keys`;
  return out;
}

/** A few real records, shortened, for the model to read. */
export function sampleRecords(records, { count = 3, maxChars = 14000 } = {}) {
  const picked = (records || []).slice(0, count).map((record) => clipValue(record));
  let text = JSON.stringify(picked, null, 1);
  while (text.length > maxChars && picked.length > 1) {
    picked.pop();
    text = JSON.stringify(picked, null, 1);
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Every field path seen across all records with its types and how many
 * records have it, e.g. `page_state.r10_state.trials[].choice  string  (24/24)`.
 * Small models write far better code from this than from samples alone.
 */
export function describeRecordShape(records, { maxPaths = 160 } = {}) {
  const paths = new Map();
  const visit = (raw, path, depth, seenInRecord) => {
    let value = raw;
    if (depth > 7) return;
    const key = path || '(record)';
    if (!seenInRecord.has(key)) {
      seenInRecord.add(key);
      const entry = paths.get(key) || { types: new Set(), records: 0, example: undefined };
      entry.records += 1;
      paths.set(key, entry);
    }
    const entry = paths.get(key);
    const inner = jsonInString(value);
    entry.types.add(inner !== undefined ? 'json-string' : typeName(value));
    if (inner !== undefined) value = inner;
    else if (entry.example === undefined && value !== null && typeof value !== 'object') entry.example = value;
    if (Array.isArray(value)) value.slice(0, 50).forEach((item) => visit(item, `${path}[]`, depth + 1, seenInRecord));
    else if (value && typeof value === 'object') Object.keys(value).slice(0, 80).forEach((k) => visit(value[k], path ? `${path}.${k}` : k, depth + 1, seenInRecord));
  };
  (records || []).forEach((record) => visit(record, '', 0, new Set()));
  const total = (records || []).length;
  const lines = [];
  for (const [path, entry] of paths) {
    if (path === '(record)') continue;
    const example = entry.example === undefined ? '' : `  e.g. ${JSON.stringify(entry.example).slice(0, 60)}`;
    lines.push(`${path}  ${[...entry.types].join('|')}  (${Math.min(entry.records, total)}/${total})${example}`);
    if (lines.length >= maxPaths) {
      lines.push(`… ${paths.size - maxPaths} more paths`);
      break;
    }
  }
  return lines.join('\n');
}

/**
 * Runs inside the sandbox (and in tests). Kept as source text so the browser
 * can load it into a Worker in an isolated frame. `runAnalysis` returns
 * { ok, result } or { ok: false, error }.
 */
export const ANALYSIS_RUNTIME_SOURCE = `
var helpers = {
  parse: function (v) { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } },
  list: function (v) { v = helpers.parse(v); if (Array.isArray(v)) return v; if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; }); return v == null ? [] : [v]; },
  num: function (v) { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; var n = Number(v); return isFinite(n) ? n : null; },
  get: function (obj, path) { var parts = String(path || '').split('.'); var cur = obj; for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = helpers.parse(cur)[parts[i]]; } return cur; },
  file: function (v) { var s = String(v == null ? '' : v).split('?')[0].split('#')[0]; var i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; },
  flat: function (arr) { var out = []; (arr || []).forEach(function (x) { if (Array.isArray(x)) out.push.apply(out, x); else out.push(x); }); return out; }
};
function runAnalysis(code, records) {
  var analyze;
  try {
    var src = String(code || '');
    var factory = /function\\s+analyze\\s*\\(/.test(src)
      ? new Function('helpers', '"use strict";\\n' + src + '\\n;return typeof analyze === "function" ? analyze : null;')
      : new Function('helpers', '"use strict";\\nreturn function analyze(records, helpers) {\\n' + src + '\\n};');
    analyze = factory(helpers);
  } catch (e) {
    return { ok: false, error: 'SyntaxError: ' + (e && e.message || e) };
  }
  if (typeof analyze !== 'function') return { ok: false, error: 'The code does not define function analyze(records, helpers).' };
  try {
    var result = analyze(JSON.parse(JSON.stringify(records)), helpers);
    var text = JSON.stringify(result === undefined ? null : result);
    if (text && text.length > 4000000) return { ok: false, error: 'The result is too large (over 4 MB). Return summaries, not raw records.' };
    return { ok: true, result: text ? JSON.parse(text) : null };
  } catch (e) {
    var where = e && e.stack ? String(e.stack).split('\\n').slice(0, 3).join(' | ') : '';
    return { ok: false, error: (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e)) + (where ? ' [' + where + ']' : '') };
  }
}
`;

/** Run analysis code directly (Node tests, never the browser UI). */
export function runAnalysisUnsandboxed(code, records) {
  // eslint-disable-next-line no-new-func
  const run = new Function(`${ANALYSIS_RUNTIME_SOURCE}\nreturn runAnalysis;`)();
  return run(code, records);
}

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : clean(value, 500));

/**
 * Check the code's result. Returns { blocks, problems }; `problems` are
 * written for the model, so a failed run can be sent back to it once.
 */
export function normalizeAnalysisResult(result) {
  const problems = [];
  const raw = Array.isArray(result) ? result : Array.isArray(result?.blocks) ? result.blocks : null;
  if (!raw) return { blocks: [], problems: ['analyze() must return { blocks: [...] }.'] };
  const blocks = [];
  raw.slice(0, 20).forEach((block, i) => {
    const at = `blocks[${i}]`;
    if (!block || typeof block !== 'object') { problems.push(`${at} is not an object.`); return; }
    const type = String(block.type || '').toLowerCase();
    const title = clean(block.title, 160);
    const note = clean(block.note, 400);
    if (!AI_ANALYSIS_BLOCK_TYPES.includes(type)) { problems.push(`${at}.type "${block.type}" is not one of ${AI_ANALYSIS_BLOCK_TYPES.join(', ')}.`); return; }
    if (type === 'pairwise') {
      const matches = (Array.isArray(block.matches) ? block.matches : [])
        .filter((m) => m && m.winner != null && m.loser != null && keyOf(m.winner) && keyOf(m.loser) && keyOf(m.winner) !== keyOf(m.loser))
        .map((m) => ({ winner: keyOf(m.winner), loser: keyOf(m.loser), ...(m.category != null && m.category !== '' ? { category: clean(m.category, 120) } : {}) }));
      if (!matches.length) { problems.push(`${at} (pairwise) has no matches with a winner and a different loser.`); return; }
      blocks.push({ type, title, note, matches });
    } else if (type === 'ranking') {
      const orders = (Array.isArray(block.orders) ? block.orders : [])
        .map((order) => (Array.isArray(order) ? order.map(keyOf).filter(Boolean) : []))
        .filter((order) => order.length >= 2);
      if (!orders.length) { problems.push(`${at} (ranking) has no orders with at least two items.`); return; }
      blocks.push({ type, title, note, orders });
    } else if (type === 'choice') {
      const values = (Array.isArray(block.values) ? block.values : []).flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => v !== null && v !== undefined && v !== '').map((v) => keyOf(v));
      if (!values.length) { problems.push(`${at} (choice) has no values.`); return; }
      blocks.push({ type, title, note, values, multi: Boolean(block.multi), total: Number.isFinite(Number(block.total)) && Number(block.total) > 0 ? Number(block.total) : null });
    } else if (type === 'rating') {
      const toNums = (list) => (Array.isArray(list) ? list : []).map((v) => (v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v))).filter(Number.isFinite);
      const items = Array.isArray(block.items)
        ? block.items.map((item) => ({ label: keyOf(item?.label ?? item?.key), values: toNums(item?.values) })).filter((item) => item.label && item.values.length)
        : [];
      const values = toNums(block.values);
      if (!items.length && !values.length) { problems.push(`${at} (rating) has no numeric values (use values: [numbers] or items: [{label, values}]).`); return; }
      const min = Number.isFinite(Number(block.min)) ? Number(block.min) : null;
      const max = Number.isFinite(Number(block.max)) ? Number(block.max) : null;
      blocks.push({ type, title, note, items, values, min, max });
    } else if (type === 'text') {
      const values = (Array.isArray(block.values) ? block.values : []).map((v) => String(v ?? '').trim()).filter(Boolean).map((v) => v.slice(0, 5000));
      if (!values.length) { problems.push(`${at} (text) has no non-empty strings.`); return; }
      blocks.push({ type, title, note, values });
    } else if (type === 'table') {
      const columns = (Array.isArray(block.columns) ? block.columns : []).map((c) => clean(c, 80)).slice(0, 30);
      const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, 2000)
        .map((row) => (Array.isArray(row) ? row : columns.map((c) => row?.[c])).slice(0, columns.length).map((cell) => (cell && typeof cell === 'object' ? JSON.stringify(cell) : cell ?? '')));
      if (!columns.length || !rows.length) { problems.push(`${at} (table) needs columns and rows.`); return; }
      blocks.push({ type, title, note, columns, rows });
    } else if (type === 'bar') {
      const items = (Array.isArray(block.items) ? block.items : []).map((item) => ({ label: keyOf(item?.label), value: Number(item?.value) }))
        .filter((item) => item.label && Number.isFinite(item.value)).slice(0, 200);
      if (!items.length) { problems.push(`${at} (bar) needs items: [{label, value}] with numeric values.`); return; }
      blocks.push({ type, title, note, items, unit: clean(block.unit, 40) });
    } else if (type === 'note') {
      const text = clean(block.text || block.note, 2000);
      if (text) blocks.push({ type, title, text });
    }
  });
  if (!blocks.some((b) => b.type !== 'note') && !problems.length) problems.push('No block carries data: every block was empty or a note. Check the field paths against FIELDS.');
  return { blocks, problems };
}

const round = (n, d = 3) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * Run the platform's own algorithms on normalized blocks. Each computed
 * block carries `table` ({ columns, rows }) used for display and export.
 */
export function computeAnalysisBlocks(blocks) {
  return (blocks || []).map((block) => {
    if (block.type === 'pairwise' || block.type === 'ranking') {
      const matches = block.type === 'pairwise' ? block.matches : block.orders.flatMap((order) => matchesFromOrderedRanking(order));
      const split = block.type === 'pairwise' && block.matches.some((m) => m.category);
      const trueskill = computeTrueSkillFromMatches(matches, { splitByCategory: split });
      const boards = trueSkillBoards(trueskill);
      let borda = null;
      let kendall = null;
      if (block.type === 'ranking') {
        const byItem = {};
        let maxLen = 0;
        block.orders.forEach((order) => {
          maxLen = Math.max(maxLen, order.length);
          order.forEach((item, idx) => { (byItem[item] = byItem[item] || []).push(idx + 1); });
        });
        borda = computeBordaScores(byItem, maxLen);
        const items = Object.keys(byItem);
        const w = kendallW(block.orders, items);
        kendall = { w: round(w), interpretation: interpretKendallW(w), judges: block.orders.length };
      }
      const columns = ['category', 'rank', 'item', 'mu', 'sigma', 'mu_std5', 'wins', 'losses', 'games'];
      if (borda) columns.push('borda', 'avg_rank');
      const rows = boards.flatMap((board) => board.rankings.map((r) => {
        const row = [board.label || '', r.rank, r.imageKey, round(r.mu), round(r.sigma), round(r.muStd5), r.wins, r.losses, r.games];
        if (borda) row.push(round(borda[r.imageKey]?.borda), round(borda[r.imageKey]?.avgRank));
        return row;
      }));
      return { ...block, boards, kendall, matchCount: matches.length, table: { columns, rows } };
    }
    if (block.type === 'choice') {
      const counts = new Map();
      block.values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      const n = block.total || block.values.length;
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => {
        const ci = wilsonCI(count, n);
        return [label, count, round(count / n * 100, 1), round(ci.low * 100, 1), round(ci.high * 100, 1)];
      });
      return { ...block, n, table: { columns: ['option', 'count', 'percent', 'ci95_low', 'ci95_high'], rows } };
    }
    if (block.type === 'rating') {
      const series = block.items.length ? block.items : [{ label: block.title || 'value', values: block.values }];
      const rows = series.map((item) => {
        const s = descriptiveStats(item.values);
        const se = s.n > 1 ? s.sd * Math.sqrt(s.n / (s.n - 1)) / Math.sqrt(s.n) : null;
        return [item.label, s.n, round(s.mean), round(s.sd), round(s.median), round(s.min), round(s.max), se == null ? null : round(s.mean - 1.96 * se), se == null ? null : round(s.mean + 1.96 * se)];
      });
      if (block.items.length) rows.sort((a, b) => (b[2] ?? -Infinity) - (a[2] ?? -Infinity));
      return { ...block, series, table: { columns: ['item', 'n', 'mean', 'sd', 'median', 'min', 'max', 'ci95_low', 'ci95_high'], rows } };
    }
    if (block.type === 'text') {
      const words = wordFrequency(block.values, 30);
      const lengths = textLengthStats(block.values);
      return { ...block, words, lengths, table: { columns: ['word', 'responses'], rows: words.map((w) => [w.word, w.count]) } };
    }
    if (block.type === 'bar') {
      return { ...block, table: { columns: ['label', block.unit || 'value'], rows: block.items.map((item) => [item.label, round(item.value, 4)]) } };
    }
    if (block.type === 'table') return { ...block, table: { columns: block.columns, rows: block.rows } };
    return { ...block, table: null };
  });
}

/** Run checked code on records (any runner) and compute: { ok, blocks, problems, error }. */
export async function evaluateAnalysis(code, records, runner) {
  const run = await runner(code, records);
  if (!run?.ok) return { ok: false, error: run?.error || 'The code did not run.', blocks: [], problems: [] };
  const { blocks, problems } = normalizeAnalysisResult(run.result);
  if (!blocks.length) return { ok: false, error: problems.join(' ') || 'No usable result.', blocks: [], problems };
  return { ok: true, blocks: computeAnalysisBlocks(blocks), problems };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeName(name) {
  return String(name || 'question').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'question';
}

/** Export files for one question's AI analysis: a CSV per block, the code, and a note. */
export function aiAnalysisExportFiles(question, saved, computedBlocks) {
  const base = `questions/${safeName(question?.name)}__ai`;
  const files = [];
  (computedBlocks || []).forEach((block, index) => {
    if (!block.table) return;
    const lines = [block.table.columns.map(csvCell).join(','), ...block.table.rows.map((row) => row.map(csvCell).join(','))];
    files.push({ path: `${base}__${index + 1}_${block.type}.csv`, content: `﻿${lines.join('\r\n')}\r\n` });
  });
  files.push({ path: `${base}__analyze.js`, content: `${aiAnalysisCodeHeader(question, saved)}${saved?.code || ''}\n` });
  return files;
}

export function aiAnalysisCodeHeader(question, saved) {
  return [
    '// AI-written analysis for SP-Survey question',
    `//   ${clean(question?.name)}${question?.title ? ` · ${clean(typeof question.title === 'string' ? question.title : Object.values(question.title)[0])}` : ''}`,
    `// Written by ${saved?.model || 'the Assistant model'} on ${saved?.createdAt || ''}. The question type was inferred by the model: check it.`,
    '// analyze(records, helpers) reshapes the records; SP-Survey runs TrueSkill, Borda/Kendall W,',
    '// Wilson intervals, descriptive stats and word frequency on the blocks it returns.',
    '',
  ].join('\n');
}

export const AI_ANALYSIS_README_LINES = [
  '',
  'AI-written analyses',
  '-------------------',
  'questions/{name}__ai__{n}_{type}.csv   Results of the analysis the Assistant model wrote for a',
  '                                       question SP-Survey does not analyse by itself.',
  'questions/{name}__ai__analyze.js       The code it wrote. The question type was inferred by the model;',
  '                                       check it. Statistics are SP-Survey\'s own (TrueSkill, Borda,',
  '                                       Kendall W, Wilson 95% CI, descriptive stats, word frequency).',
];

/** Saved analyses live in the project's metadata, keyed by question name. */
export function readSavedAnalyses(project) {
  const saved = project?.metadata?.resultsAiAnalyses;
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

export function makeSavedAnalysis({ code, model, provider, instructions = '', questionTitle = '' }) {
  return {
    version: AI_ANALYSIS_VERSION,
    code: String(code || '').slice(0, 60000),
    model: model || '',
    provider: provider || '',
    instructions: String(instructions || '').slice(0, 2000),
    questionTitle: clean(questionTitle, 300),
    createdAt: new Date().toISOString(),
  };
}

/** The question text the model reads. */
export function questionBrief(question) {
  const text = (value) => (value && typeof value === 'object' ? Object.values(value)[0] : value);
  const parts = [`name: ${clean(question?.name, 160)}`];
  if (question?.type) parts.push(`type as recorded: ${clean(question.type, 60)}${question.pageOnly ? ' (seen on the page; the answers are only in page_state / requests)' : ''}`);
  if (text(question?.title)) parts.push(`title: ${clean(text(question.title), 600)}`);
  if (text(question?.description)) parts.push(`description: ${clean(text(question.description), 800)}`);
  if (Array.isArray(question?.choices) && question.choices.length) {
    parts.push(`choices: ${question.choices.slice(0, 30).map((c) => (c && typeof c === 'object' ? `${clean(c.value, 60)}=${clean(text(c.text), 80)}` : clean(c, 80))).join('; ')}`);
  }
  if (question?.rateMin != null || question?.rateMax != null) parts.push(`scale: ${question.rateMin ?? ''}..${question.rateMax ?? ''}`);
  return parts.join('\n');
}

/**
 * Ask the model for the code, run it on every record, and when it fails send
 * the error back once for a fix (automatic; the researcher clicks once).
 * `request(body)` posts to the worker; `runner(code, records)` is the sandbox.
 */
export async function generateQuestionAnalysis({ question, records, instructions = '', request, runner }) {
  const base = {
    question: questionBrief(question),
    sample: sampleRecords(records),
    fields: describeRecordShape(records),
    recordCount: records.length,
    instructions,
  };
  let reply = await request(base);
  let evaluation = await evaluateAnalysis(reply.code, records, runner);
  let attempts = 1;
  if (!evaluation.ok) {
    reply = await request({ ...base, previous: reply.code, error: evaluation.error });
    evaluation = await evaluateAnalysis(reply.code, records, runner);
    attempts = 2;
  }
  return {
    ok: evaluation.ok,
    error: evaluation.ok ? '' : evaluation.error,
    attempts,
    code: reply.code,
    saved: makeSavedAnalysis({ code: reply.code, model: reply.model, provider: reply.provider, instructions, questionTitle: question?.title }),
    blocks: evaluation.blocks,
    problems: evaluation.problems,
  };
}
