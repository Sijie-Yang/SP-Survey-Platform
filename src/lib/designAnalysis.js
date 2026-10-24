// Analysis that follows the experiment design: first check the design ran as
// planned, then the main result for each question the design drives.
// Deterministic (seeded bootstrap); no model is involved anywhere here.

import { isNoPreference } from './choiceTie.js';
import { hashSeed, seededRandom } from './designRandom.js';
import {
  PAIR_CHOICE_TYPES, designSizing, mainUnits, unitId, versionTrials,
} from './experimentDesign.js';
import { mediaIdentityKey, resolveMediaAnswerKey } from './mediaIdentity.js';
import { normalizeBooleanAnswer } from './responseAnswerUnits.js';
import { tQuantile, tTwoSidedP } from './statDistributions.js';
import { wilsonCI } from './stats.js';

export const BOOTSTRAP_REPS = 200;
const NUMERIC_TYPES = new Set(['imagerating', 'mediarating']);
const BOOLEAN_TYPES = new Set(['imageboolean', 'mediaboolean']);

const participantOf = (row) => row.participant_id || row.id || '';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Mean with a 95% t interval. */
export function meanCI(xs) {
  const n = xs.length;
  const m = mean(xs);
  const s = sd(xs);
  if (n < 2 || s == null) return { n, mean: m, sd: s, low: null, high: null };
  const half = tQuantile(0.975, n - 1) * (s / Math.sqrt(n));
  return { n, mean: m, sd: s, low: m - half, high: m + half };
}

/** Welch two-sample comparison of b − a with a 95% interval and Cohen's d. */
export function welch(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  const va = sd(a) ** 2;
  const vb = sd(b) ** 2;
  if (a.length < 2 || b.length < 2 || !Number.isFinite(va) || !Number.isFinite(vb)) {
    return { diff: ma != null && mb != null ? mb - ma : null, low: null, high: null, p: null, d: null, na: a.length, nb: b.length };
  }
  const se = Math.sqrt(va / a.length + vb / b.length);
  const df = (va / a.length + vb / b.length) ** 2
    / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  const diff = mb - ma;
  const half = tQuantile(0.975, df) * se;
  const pooled = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
  return {
    diff, low: diff - half, high: diff + half,
    p: se > 0 ? tTwoSidedP(diff / se, df) : null,
    d: pooled > 0 ? diff / pooled : null,
    na: a.length, nb: b.length,
  };
}

/**
 * Bradley–Terry strengths by the MM algorithm (Hunter 2004). Each item gets one
 * virtual win and loss against an average item so every score exists.
 * Returns log-strengths centred on 0.
 */
export function bradleyTerry(comparisons, items, { iterations = 100, start = null } = {}) {
  const idx = new Map(items.map((k, i) => [k, i]));
  const n = items.length;
  const wins = new Array(n).fill(1);
  const games = new Map();
  const bump = (i, j) => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    games.set(key, (games.get(key) || 0) + 1);
  };
  comparisons.forEach(({ winner, loser }) => {
    const i = idx.get(winner);
    const j = idx.get(loser);
    if (i == null || j == null || i === j) return;
    wins[i] += 1;
    bump(i, j);
  });
  const pairs = [...games.entries()].map(([key, c]) => {
    const [i, j] = key.split(',').map(Number);
    return [i, j, c];
  });
  let p = start ? start.slice() : new Array(n).fill(1);
  for (let it = 0; it < iterations; it += 1) {
    const cur = p;
    const denom = cur.map((pi) => 2 / (pi + 1));
    pairs.forEach(([i, j, c]) => {
      const t = c / (cur[i] + cur[j]);
      denom[i] += t;
      denom[j] += t;
    });
    let change = 0;
    const next = p.map((pi, i) => {
      const v = wins[i] / denom[i];
      change = Math.max(change, Math.abs(v - pi) / pi);
      return v;
    });
    const g = Math.exp(mean(next.map(Math.log)));
    p = next.map((v) => v / g);
    if (change < 1e-6) break;
  }
  return p.map(Math.log);
}

function chosenIndex(trial) {
  let answer = trial?.answer ?? trial?.value;
  if (Array.isArray(answer)) answer = answer.length === 1 ? answer[0] : null;
  if (answer == null || answer === '' || isNoPreference(answer)) return isNoPreference(answer) ? 'tie' : null;
  const shown = trial.shown_images || [];
  const key = resolveMediaAnswerKey(answer, shown);
  const i = shown.findIndex((item) => mediaIdentityKey(item) === key);
  if (i >= 0) return i;
  const ids = trial.shown_media_ids || [];
  const j = ids.findIndex((id) => id === answer || mediaIdentityKey(id) === key);
  return j >= 0 ? j : null;
}

function numericValue(trial, type) {
  const raw = trial?.answer ?? trial?.value;
  if (BOOLEAN_TYPES.has(type)) {
    const b = normalizeBooleanAnswer(raw);
    return b === '' ? null : b;
  }
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** One record per trial of a design question, from the rows in this design. */
export function designRecords(design, rows, question) {
  const out = [];
  rows.forEach((row) => {
    const trials = row?.responses?.[question.name]?.trials;
    if (!Array.isArray(trials)) return;
    const meta = row.survey_metadata?.experiment_design || {};
    trials.forEach((trial, i) => {
      if (!trial || trial.design_id !== design.id) return;
      out.push({
        participant: participantOf(row),
        condition: row.survey_metadata?.condition ?? null,
        version: Number(trial.design_version ?? meta.version),
        role: trial.design_role || 'main',
        unit: trial.design_unit,
        order: trial.design_order || null,
        side: trial.design_side || null,
        position: trial.design_position ?? null,
        // The design's own keys; shown_media_ids may be full storage keys.
        media: Array.isArray(trial.design_media) ? trial.design_media : (trial.shown_media_ids || []),
        trialIndex: i,
        trial,
      });
    });
  });
  return out;
}

export function questionKind(question) {
  if (PAIR_CHOICE_TYPES.has(question?.type)) return 'choice';
  if (NUMERIC_TYPES.has(question?.type)) return 'rating';
  if (BOOLEAN_TYPES.has(question?.type)) return 'yesno';
  return 'other';
}

/** Planned vs actual exposures, version use, claim source and left/right balance. */
export function designExecution(design, rows, questions) {
  const inDesign = rows.filter((r) => r.survey_metadata?.experiment_design?.id === design.id);
  const sizing = designSizing(design);
  const keyOf = (u) => unitId(u);
  const planned = new Map(mainUnits(design).map((u) => [keyOf(u), 0]));
  const versionCache = new Map();
  const versionsUsed = new Map();
  let server = 0;
  inDesign.forEach((row) => {
    const meta = row.survey_metadata.experiment_design;
    if (meta.claim === 'server') server += 1;
    const v = Number(meta.version);
    versionsUsed.set(v, (versionsUsed.get(v) || 0) + 1);
    if (!versionCache.has(v)) versionCache.set(v, versionTrials(design, v));
    versionCache.get(v).forEach((t) => {
      if (t.role !== 'main') return;
      if (design.type === 'pool_pairs') t.media.forEach((k) => planned.set(k, (planned.get(k) || 0) + 1));
      else planned.set(t.unit, (planned.get(t.unit) || 0) + 1);
    });
  });
  const lead = questions[0];
  const actual = new Map([...planned.keys()].map((k) => [k, 0]));
  let ab = 0;
  let ba = 0;
  if (lead) {
    const seenTrial = new Set();
    designRecords(design, inDesign, lead).forEach((r) => {
      if (r.role !== 'main') return;
      const answered = (r.trial.answer ?? r.trial.value) != null && (r.trial.answer ?? r.trial.value) !== '';
      if (!answered) return;
      const once = `${r.participant}|${r.trial.design_trial}`;
      if (seenTrial.has(once)) return;
      seenTrial.add(once);
      if (design.type === 'pool_pairs') r.media.forEach((k) => actual.set(k, (actual.get(k) || 0) + 1));
      else actual.set(r.unit, (actual.get(r.unit) || 0) + 1);
      if (r.order === 'ab') ab += 1;
      if (r.order === 'ba') ba += 1;
    });
  }
  const values = (m) => [...m.values()];
  const range = (xs) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: 0, max: 0 });
  const plannedRange = range(values(planned));
  const actualRange = range(values(actual));
  const short = [...actual.entries()]
    .filter(([k, n]) => n < (planned.get(k) || 0))
    .map(([unit, n]) => ({ unit, shown: n, planned: planned.get(unit) || 0 }));
  return {
    participants: inDesign.length,
    outsideDesign: rows.length - inDesign.length,
    serverClaims: server,
    localClaims: inDesign.length - server,
    versionsUsed: versionsUsed.size,
    versionsTotal: sizing.versions,
    planned: plannedRange,
    actual: actualRange,
    perUnit: [...planned.keys()].map((unit) => ({ unit, planned: planned.get(unit), shown: actual.get(unit) || 0 })),
    short,
    leftRight: ab + ba ? { ab, ba, shareAB: ab / (ab + ba) } : null,
  };
}

function bootstrapBT(records, items, seed) {
  const byPerson = new Map();
  records.forEach((r) => {
    if (!byPerson.has(r.participant)) byPerson.set(r.participant, []);
    byPerson.get(r.participant).push(r);
  });
  const people = [...byPerson.values()];
  const full = bradleyTerry(records, items);
  if (people.length < 5) return { scores: full, low: null, high: null, reps: 0 };
  const rand = seededRandom(hashSeed(seed, 'bootstrap'));
  const reps = records.length > 20000 ? 100 : BOOTSTRAP_REPS;
  const samples = items.map(() => []);
  const start = full.map(Math.exp);
  for (let b = 0; b < reps; b += 1) {
    const draw = [];
    for (let i = 0; i < people.length; i += 1) draw.push(...people[Math.floor(rand() * people.length)]);
    bradleyTerry(draw, items, { iterations: 40, start }).forEach((s, i) => samples[i].push(s));
  }
  const q = (xs, p) => {
    const sorted = xs.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  };
  return { scores: full, low: samples.map((s) => q(s, 0.025)), high: samples.map((s) => q(s, 0.975)), reps };
}

function labelFor(design, unit) {
  const u = design.units.find((x) => unitId(x) === unit);
  return (u && typeof u === 'object' && u.label) || unit;
}

/** Main result for a two-image choice question. */
function analyseChoice(design, records) {
  const main = records.filter((r) => r.role === 'main');
  let ties = 0;
  let left = 0;
  let decided = 0;
  const outcomes = [];
  main.forEach((r) => {
    const i = chosenIndex(r.trial);
    if (i === 'tie') { ties += 1; return; }
    if (i == null || r.media.length < 2) return;
    decided += 1;
    if (i === 0) left += 1;
    outcomes.push({ ...r, chosen: r.media[i], other: r.media[1 - i] });
  });
  const position = decided ? { left, decided, share: left / decided, ...wilsonRange(left, decided) } : null;
  if (design.type === 'pool_pairs') {
    const items = mainUnits(design);
    const comparisons = outcomes.map((o) => ({ winner: o.chosen, loser: o.other, participant: o.participant }));
    const bt = bootstrapBT(comparisons, items, design.seed);
    const shown = new Map(items.map((k) => [k, 0]));
    const won = new Map(items.map((k) => [k, 0]));
    comparisons.forEach((c) => {
      shown.set(c.winner, (shown.get(c.winner) || 0) + 1);
      shown.set(c.loser, (shown.get(c.loser) || 0) + 1);
      won.set(c.winner, (won.get(c.winner) || 0) + 1);
    });
    const rowsOut = items.map((k, i) => ({
      unit: k, score: bt.scores[i], low: bt.low?.[i] ?? null, high: bt.high?.[i] ?? null,
      wins: won.get(k) || 0, shown: shown.get(k) || 0,
    })).sort((a, b) => b.score - a.score).map((r, i) => ({ rank: i + 1, ...r }));
    return { kind: 'bt', comparisons: comparisons.length, ties, position, reps: bt.reps, rows: rowsOut };
  }
  // Fixed pairs: share choosing b over a, per pair and overall.
  const byUnit = new Map();
  outcomes.forEach((o) => {
    const u = design.units.find((x) => x.id === o.unit);
    if (!u) return;
    const row = byUnit.get(o.unit) || { unit: o.unit, label: labelFor(design, o.unit), a: u.a, b: u.b, chooseB: 0, n: 0 };
    row.n += 1;
    if (o.chosen === u.b) row.chooseB += 1;
    byUnit.set(o.unit, row);
  });
  const perPair = [...byUnit.values()].map((r) => ({ ...r, share: r.n ? r.chooseB / r.n : null, ...wilsonRange(r.chooseB, r.n) }));
  const perPerson = new Map();
  outcomes.forEach((o) => {
    const u = design.units.find((x) => x.id === o.unit);
    if (!u) return;
    const list = perPerson.get(o.participant) || [];
    list.push(o.chosen === u.b ? 1 : 0);
    perPerson.set(o.participant, list);
  });
  const overall = meanCI([...perPerson.values()].map(mean));
  return { kind: 'pair_share', decided, ties, position, overall, rows: perPair.sort((a, b) => (b.share ?? -1) - (a.share ?? -1)) };
}

function wilsonRange(k, n) {
  if (!n) return { low: null, high: null };
  const ci = wilsonCI(k, n);
  return { low: ci.low ?? ci.lower ?? ci[0], high: ci.high ?? ci.upper ?? ci[1] };
}

/** Main result for a rating or yes/no question. */
function analyseRating(design, records, type) {
  const main = records.filter((r) => r.role === 'main');
  const values = main.map((r) => ({ ...r, value: numericValue(r.trial, type) })).filter((r) => r.value != null);
  const keyOf = (r) => r.media[0];
  const byItem = new Map();
  values.forEach((r) => {
    const k = keyOf(r);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(r.value);
  });
  const items = [...byItem.entries()].map(([unit, xs]) => ({ unit, ...meanCI(xs) }))
    .sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity));
  const out = { kind: 'item_means', answered: values.length, rows: items };
  if (design.type === 'fixed_pairs') {
    const cells = new Map();
    values.forEach((r) => {
      const key = `${r.participant}|${r.unit}`;
      const cell = cells.get(key) || { unit: r.unit };
      if (r.side) cell[r.side] = r.value;
      cells.set(key, cell);
    });
    const diffs = new Map();
    cells.forEach((c) => {
      if (c.a == null || c.b == null) return;
      if (!diffs.has(c.unit)) diffs.set(c.unit, []);
      diffs.get(c.unit).push(c.b - c.a);
    });
    out.pairRows = design.units.map((u) => ({ unit: u.id, label: u.label || u.id, ...meanCI(diffs.get(u.id) || []) }))
      .filter((r) => r.n > 0);
    out.overallDiff = meanCI([...diffs.values()].flat());
  }
  return out;
}

/** Same participant, same item, seen twice: how often the answer held. */
function analyseRepeats(records, kind, type) {
  const firsts = new Map();
  const pairsOut = [];
  records.forEach((r) => {
    const key = `${r.participant}|${r.unit}|${r.side || ''}`;
    if (r.role === 'main') firsts.set(key, r);
  });
  records.filter((r) => r.role === 'repeat').forEach((r) => {
    const first = firsts.get(`${r.participant}|${r.unit}|${r.side || ''}`);
    if (first) pairsOut.push([first, r]);
  });
  if (!pairsOut.length) return null;
  if (kind === 'choice') {
    let same = 0;
    let n = 0;
    pairsOut.forEach(([a, b]) => {
      const ia = chosenIndex(a.trial);
      const ib = chosenIndex(b.trial);
      if (typeof ia !== 'number' || typeof ib !== 'number') return;
      n += 1;
      if (a.media[ia] === b.media[ib]) same += 1;
    });
    return n ? { kind: 'agreement', n, same, share: same / n } : null;
  }
  const xs = [];
  const ys = [];
  pairsOut.forEach(([a, b]) => {
    const x = numericValue(a.trial, type);
    const y = numericValue(b.trial, type);
    if (x != null && y != null) { xs.push(x); ys.push(y); }
  });
  if (!xs.length) return null;
  const mx = mean(xs);
  const my = mean(ys);
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const vy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  return {
    kind: 'retest', n: xs.length,
    r: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null,
    meanAbsDiff: mean(xs.map((x, i) => Math.abs(x - ys[i]))),
  };
}

/** Condition comparison on each participant's own summary (mean rating or share choosing b). */
function analyseConditions(design, records, kind, type, conditions) {
  if (conditions.length < 2 || design.type === 'pool_pairs') return null;
  const perPerson = new Map();
  records.filter((r) => r.role === 'main' && r.condition != null).forEach((r) => {
    let v = null;
    if (kind === 'choice') {
      const i = chosenIndex(r.trial);
      const u = design.units.find((x) => x.id === r.unit);
      if (typeof i === 'number' && u) v = r.media[i] === u.b ? 1 : 0;
    } else {
      v = numericValue(r.trial, type);
    }
    if (v == null) return;
    const row = perPerson.get(r.participant) || { condition: r.condition, xs: [] };
    row.xs.push(v);
    perPerson.set(r.participant, row);
  });
  const byCondition = new Map(conditions.map((c) => [c.id, []]));
  perPerson.forEach(({ condition, xs }) => {
    if (byCondition.has(condition)) byCondition.get(condition).push(mean(xs));
  });
  const [ref, ...rest] = conditions;
  const refValues = byCondition.get(ref.id) || [];
  return {
    groups: conditions.map((c) => ({ id: c.id, label: c.label || c.id, ...meanCI(byCondition.get(c.id) || []) })),
    contrasts: rest.map((c) => ({ id: c.id, label: c.label || c.id, vs: ref.label || ref.id, ...welch(refValues, byCondition.get(c.id) || []) })),
  };
}

/** Does the higher-rated image of a pair get chosen? (fixed pairs, choice + rating questions) */
function crossQuestionConsistency(design, choiceRecords, ratingRecords, ratingType) {
  const ratings = new Map();
  ratingRecords.filter((r) => r.role === 'main').forEach((r) => {
    const v = numericValue(r.trial, ratingType);
    if (v == null || !r.media[0]) return;
    ratings.set(`${r.participant}|${r.unit}|${r.media[0]}`, v);
  });
  let agree = 0;
  let n = 0;
  choiceRecords.filter((r) => r.role === 'main').forEach((r) => {
    const i = chosenIndex(r.trial);
    if (typeof i !== 'number') return;
    const chosen = ratings.get(`${r.participant}|${r.unit}|${r.media[i]}`);
    const other = ratings.get(`${r.participant}|${r.unit}|${r.media[1 - i]}`);
    if (chosen == null || other == null || chosen === other) return;
    n += 1;
    if (chosen > other) agree += 1;
  });
  return n ? { n, agree, share: agree / n } : null;
}

/** Everything the Results page shows for a design. */
export function analyseDesign(design, rows, surveyConfig) {
  const all = [];
  const walk = (els) => (els || []).forEach((el) => {
    if (Array.isArray(el?.elements)) walk(el.elements);
    else if (el?.name) all.push(el);
  });
  (surveyConfig?.pages || []).forEach((p) => walk(p.elements));
  const questions = design.questions.map((n) => all.find((q) => q.name === n)).filter(Boolean);
  const inDesign = rows.filter((r) => r.survey_metadata?.experiment_design?.id === design.id);
  const conditions = (Array.isArray(surveyConfig?.conditions) ? surveyConfig.conditions : [])
    .map((c) => (typeof c === 'string' ? { id: c, label: c } : c))
    .filter((c) => c?.id);
  const execution = designExecution(design, rows, questions);
  const perQuestion = questions.map((q) => {
    const kind = questionKind(q);
    const records = designRecords(design, inDesign, q);
    const main = kind === 'choice' ? analyseChoice(design, records)
      : kind === 'rating' || kind === 'yesno' ? analyseRating(design, records, q.type)
        : null;
    return {
      name: q.name,
      title: q.title || q.name,
      type: q.type,
      kind,
      records: records.length,
      main,
      repeats: kind === 'other' ? null : analyseRepeats(records, kind, q.type),
      conditions: kind === 'other' ? null : analyseConditions(design, records, kind, q.type, conditions),
      anchors: design.anchors.length && kind !== 'other' ? analyseAnchors(design, records, kind, q.type) : null,
    };
  });
  let consistency = null;
  if (design.type === 'fixed_pairs') {
    const choiceQ = perQuestion.find((p) => p.kind === 'choice');
    const ratingQ = perQuestion.find((p) => p.kind === 'rating');
    if (choiceQ && ratingQ) {
      const cq = questions.find((q) => q.name === choiceQ.name);
      const rq = questions.find((q) => q.name === ratingQ.name);
      consistency = crossQuestionConsistency(design, designRecords(design, inDesign, cq), designRecords(design, inDesign, rq), rq.type);
      if (consistency) consistency = { ...consistency, choice: cq.title || cq.name, rating: rq.title || rq.name };
    }
  }
  return { execution, perQuestion, consistency, conditions };
}

function analyseAnchors(design, records, kind, type) {
  const anchorRecords = records.filter((r) => r.role === 'anchor');
  if (!anchorRecords.length) return null;
  if (kind === 'choice') {
    const byUnit = new Map();
    anchorRecords.forEach((r) => {
      const i = chosenIndex(r.trial);
      if (typeof i !== 'number') return;
      const row = byUnit.get(r.unit) || { unit: r.unit, counts: new Map(), n: 0 };
      row.n += 1;
      row.counts.set(r.media[i], (row.counts.get(r.media[i]) || 0) + 1);
      byUnit.set(r.unit, row);
    });
    return [...byUnit.values()].map((r) => {
      const [top, k] = [...r.counts.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
      return { unit: r.unit, n: r.n, top, share: r.n ? k / r.n : null };
    });
  }
  const byKey = new Map();
  anchorRecords.forEach((r) => {
    const v = numericValue(r.trial, type);
    if (v == null) return;
    const k = r.media[0];
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(v);
  });
  return [...byKey.entries()].map(([unit, xs]) => ({ unit, ...meanCI(xs) }));
}

/** Long tables for the export: the design table and each question's main result. */
export function designExportFiles(design, analysis, { prefix = 'experiment_design' } = {}) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = (header, rowsOut) => [header.join(','), ...rowsOut.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n');
  const sizing = designSizing(design);
  const tableRows = [];
  for (let v = 0; v < sizing.versions; v += 1) {
    versionTrials(design, v).forEach((t) => tableRows.push({
      version: v, trial: t.trial, role: t.role, unit: t.unit, order: t.order || '', media_left: t.media[0], media_right: t.media[1] || '',
    }));
  }
  const files = [
    { path: `${prefix}/design.json`, content: JSON.stringify(design, null, 2) },
    { path: `${prefix}/design_table.csv`, content: csv(['version', 'trial', 'role', 'unit', 'order', 'media_left', 'media_right'], tableRows) },
    { path: `${prefix}/execution_per_unit.csv`, content: csv(['unit', 'planned', 'shown'], analysis.execution.perUnit) },
  ];
  analysis.perQuestion.forEach((q) => {
    if (!q.main) return;
    const rowsOut = q.main.rows || [];
    if (!rowsOut.length) return;
    const header = Object.keys(rowsOut[0]).filter((k) => typeof rowsOut[0][k] !== 'object');
    files.push({ path: `${prefix}/${q.name}__${q.main.kind}.csv`, content: csv(header, rowsOut) });
    if (q.main.pairRows?.length) {
      const h = Object.keys(q.main.pairRows[0]);
      files.push({ path: `${prefix}/${q.name}__pair_differences.csv`, content: csv(h, q.main.pairRows) });
    }
  });
  return files;
}
