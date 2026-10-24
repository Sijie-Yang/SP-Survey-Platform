// Analysis that follows the experiment design: first check the design ran as
// planned, then the main result for each question the design drives.
// Deterministic (seeded bootstrap); no model is involved anywhere here.

import { isNoPreference } from './choiceTie.js';
import { hashSeed, seededRandom } from './designRandom.js';
import {
  MULTI_CHOICE_TYPES, PAIR_CHOICE_TYPES, designSizing, designSlotNames, mainUnits, perTrial, unitId, versionTrials,
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
 * Bradley–Terry / Luce strengths by the MM algorithm (Hunter 2004). A
 * comparison is `{ winner, loser }` or `{ winner, losers: [...] }` (one chosen
 * from a set). Each item gets one virtual win and loss against an average item
 * so every score exists. Returns log-strengths centred on 0.
 */
export function bradleyTerry(comparisons, items, { iterations = 100, start = null } = {}) {
  const idx = new Map(items.map((k, i) => [k, i]));
  const n = items.length;
  const wins = new Array(n).fill(1);
  const sets = new Map();
  comparisons.forEach((c) => {
    const i = idx.get(c.winner);
    const others = (c.losers || [c.loser]).map((k) => idx.get(k)).filter((j) => j != null && j !== i);
    if (i == null || !others.length) return;
    wins[i] += 1;
    const members = [i, ...others].sort((a, b) => a - b);
    const key = members.join(',');
    const entry = sets.get(key) || { members, count: 0 };
    entry.count += 1;
    sets.set(key, entry);
  });
  const groups = [...sets.values()];
  let p = start ? start.slice() : new Array(n).fill(1);
  for (let it = 0; it < iterations; it += 1) {
    const cur = p;
    const denom = cur.map((pi) => 2 / (pi + 1));
    groups.forEach(({ members, count }) => {
      const t = count / members.reduce((s, j) => s + cur[j], 0);
      members.forEach((j) => { denom[j] += t; });
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

function answerOf(trial) {
  return trial?.answer ?? trial?.value;
}

function indexOfShown(trial, answer) {
  const shown = trial.shown_images || [];
  const key = resolveMediaAnswerKey(answer, shown);
  const i = shown.findIndex((item) => mediaIdentityKey(item) === key);
  if (i >= 0) return i;
  const ids = trial.shown_media_ids || [];
  const j = ids.findIndex((id) => id === answer || mediaIdentityKey(id) === key);
  return j >= 0 ? j : null;
}

/** Index of the chosen image in a choose-one trial, 'tie' for no preference, null when unanswered. */
function chosenIndex(trial) {
  let answer = answerOf(trial);
  if (Array.isArray(answer)) answer = answer.length === 1 ? answer[0] : null;
  if (answer == null || answer === '' || isNoPreference(answer)) return isNoPreference(answer) ? 'tie' : null;
  return indexOfShown(trial, answer);
}

/** Indices of every selected image in a choose-any trial, or null when unanswered. */
function chosenIndices(trial) {
  const answer = answerOf(trial);
  if (answer == null || answer === '') return null;
  const list = Array.isArray(answer) ? answer : [answer];
  return [...new Set(list.map((a) => indexOfShown(trial, a)).filter((i) => i != null))];
}

function numericValue(trial, type) {
  const raw = answerOf(trial);
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
        slots: Array.isArray(trial.design_slots) ? trial.design_slots : null,
        position: trial.design_position ?? null,
        expected: trial.design_expected ?? null,
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
  if (MULTI_CHOICE_TYPES.has(question?.type)) return 'multi';
  if (NUMERIC_TYPES.has(question?.type)) return 'rating';
  if (BOOLEAN_TYPES.has(question?.type)) return 'yesno';
  return 'other';
}

const isAnswered = (trial) => {
  const a = answerOf(trial);
  return a != null && a !== '' && !(Array.isArray(a) && !a.length);
};

/** Did a catch trial get its expected answer? null when it cannot be judged. */
function catchCorrect(record, kind, type) {
  const { expected, trial } = record;
  if (expected == null || !isAnswered(trial)) return null;
  if (kind === 'choice') {
    const i = chosenIndex(trial);
    return typeof i === 'number' ? mediaIdentityKey(record.media[i]) === mediaIdentityKey(String(expected)) : null;
  }
  if (kind === 'multi') {
    const idx = chosenIndices(trial);
    return idx ? idx.some((i) => mediaIdentityKey(record.media[i]) === mediaIdentityKey(String(expected))) : null;
  }
  const v = numericValue(trial, type);
  if (v == null) return null;
  const e = typeof expected === 'number' ? expected : parseFloat(expected);
  return Number.isFinite(e) ? Math.abs(v - e) < 1e-9 : null;
}

/** Planned vs actual exposures, version use, claim source, position balance and catch trials. */
export function designExecution(design, rows, questions) {
  const inDesign = rows.filter((r) => r.survey_metadata?.experiment_design?.id === design.id);
  const sizing = designSizing(design);
  const planned = new Map(mainUnits(design).map((u) => [unitId(u), 0]));
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
  const firstSlot = designSlotNames(design)[0] || null;
  let firstAtLeft = 0;
  let ordered = 0;
  if (lead) {
    const seenTrial = new Set();
    designRecords(design, inDesign, lead).forEach((r) => {
      if (r.role !== 'main' || !isAnswered(r.trial)) return;
      const once = `${r.participant}|${r.trial.design_trial}`;
      if (seenTrial.has(once)) return;
      seenTrial.add(once);
      if (design.type === 'pool_pairs') r.media.forEach((k) => actual.set(k, (actual.get(k) || 0) + 1));
      else actual.set(r.unit, (actual.get(r.unit) || 0) + 1);
      if (firstSlot && r.order && r.order.length > 1) {
        ordered += 1;
        if (r.order.startsWith(firstSlot)) firstAtLeft += 1;
      }
    });
  }
  // Catch trials: judged on every design question that can be scored.
  let catchTrials = 0;
  let catchCorrectN = 0;
  const failed = new Set();
  if (design.catches.length) {
    questions.forEach((q) => {
      const kind = questionKind(q);
      if (kind === 'other') return;
      designRecords(design, inDesign, q).filter((r) => r.role === 'catch').forEach((r) => {
        const ok = catchCorrect(r, kind, q.type);
        if (ok == null) return;
        catchTrials += 1;
        if (ok) catchCorrectN += 1;
        else failed.add(r.participant);
      });
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
    leftRight: ordered ? { ab: firstAtLeft, ba: ordered - firstAtLeft, shareAB: firstAtLeft / ordered, slot: firstSlot } : null,
    catches: catchTrials ? { trials: catchTrials, correct: catchCorrectN, share: catchCorrectN / catchTrials, failedParticipants: [...failed] } : null,
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

const unitById = (design, id) => design.units.find((x) => unitId(x) === id);

function labelFor(design, unit) {
  const u = unitById(design, unit);
  return (u && typeof u === 'object' && u.label) || unit;
}

function wilsonRange(k, n) {
  if (!n) return { low: null, high: null };
  const ci = wilsonCI(k, n);
  return { low: ci.low ?? ci.lower ?? ci[0], high: ci.high ?? ci.upper ?? ci[1] };
}

/** How often each screen position was chosen (position 0 = left/first). */
/**
 * How often each screen position was chosen. With `probsOf` (per-trial win
 * probabilities from the fitted model) the expected share is model-based, so a
 * strong image that happened to sit on one side does not look like a position
 * effect; otherwise (counterbalanced fixed sets) the expectation is 1/k.
 */
function positionBias(outcomes, k, probsOf = null) {
  const decided = outcomes.length;
  if (!decided) return null;
  const counts = new Array(k).fill(0);
  outcomes.forEach((o) => { if (o.index < k) counts[o.index] += 1; });
  const shares = counts.map((c, j) => {
    const row = { chosen: c, share: c / decided, ...wilsonRange(c, decided), expected: 1 / k };
    if (probsOf) {
      let sum = 0;
      let varSum = 0;
      outcomes.forEach((o) => { const p = probsOf(o)[j] ?? 0; sum += p; varSum += p * (1 - p); });
      row.expected = sum / decided;
      row.se = Math.sqrt(varSum) / decided;
      row.biased = Math.abs(row.share - row.expected) > 1.96 * row.se;
    } else {
      row.biased = row.low > 1 / k || row.high < 1 / k;
    }
    return row;
  });
  return { k, decided, shares, left: counts[0], share: shares[0].share, low: shares[0].low, high: shares[0].high, expected: shares[0].expected, biased: shares.some((r) => r.biased), model: probsOf ? 'bt' : 'uniform' };
}

/** Main result for a choose-one question (two or more images on screen). */
function analyseChoice(design, records) {
  const main = records.filter((r) => r.role === 'main');
  let ties = 0;
  const outcomes = [];
  main.forEach((r) => {
    const i = chosenIndex(r.trial);
    if (i === 'tie') { ties += 1; return; }
    if (i == null || r.media.length < 2 || i >= r.media.length) return;
    outcomes.push({ ...r, index: i, chosen: r.media[i], others: r.media.filter((_, j) => j !== i) });
  });
  const k = design.type === 'pool_pairs' ? perTrial(design) : Math.max(2, ...outcomes.map((o) => o.media.length), 2);
  if (design.type === 'pool_pairs') {
    const items = mainUnits(design);
    const comparisons = outcomes.map((o) => ({ winner: o.chosen, losers: o.others, participant: o.participant }));
    const bt = bootstrapBT(comparisons, items, design.seed);
    const scoreOf = new Map(items.map((key, i) => [key, bt.scores[i]]));
    const position = positionBias(outcomes, k, (o) => {
      const w = o.media.map((m) => Math.exp(scoreOf.get(m) ?? 0));
      const total = w.reduce((a, b) => a + b, 0);
      return w.map((x) => x / total);
    });
    const shown = new Map(items.map((key) => [key, 0]));
    const won = new Map(items.map((key) => [key, 0]));
    comparisons.forEach((c) => {
      [c.winner, ...c.losers].forEach((key) => shown.set(key, (shown.get(key) || 0) + 1));
      won.set(c.winner, (won.get(c.winner) || 0) + 1);
    });
    const rowsOut = items.map((key, i) => ({
      unit: key, score: bt.scores[i], low: bt.low?.[i] ?? null, high: bt.high?.[i] ?? null,
      wins: won.get(key) || 0, shown: shown.get(key) || 0,
    })).sort((a, b) => b.score - a.score).map((r, i) => ({ rank: i + 1, ...r }));
    return { kind: 'bt', perTrial: k, comparisons: comparisons.length, ties, position, reps: bt.reps, rows: rowsOut };
  }
  // Fixed units: which slot gets chosen, per unit and overall.
  const position = positionBias(outcomes, k);
  const names = designSlotNames(design);
  const slotOf = (o) => (o.slots ? o.slots[o.index] : names[o.index]);
  if (names.length === 2) {
    const [first, second] = names;
    const byUnit = new Map();
    const perPerson = new Map();
    outcomes.forEach((o) => {
      const u = unitById(design, o.unit);
      if (!u) return;
      const row = byUnit.get(o.unit) || { unit: o.unit, label: labelFor(design, o.unit), a: u.slots[first], b: u.slots[second], chooseB: 0, n: 0 };
      row.n += 1;
      const pickedB = slotOf(o) === second;
      if (pickedB) row.chooseB += 1;
      byUnit.set(o.unit, row);
      const list = perPerson.get(o.participant) || [];
      list.push(pickedB ? 1 : 0);
      perPerson.set(o.participant, list);
    });
    const perPair = [...byUnit.values()].map((r) => ({ ...r, share: r.n ? r.chooseB / r.n : null, ...wilsonRange(r.chooseB, r.n) }));
    const overall = meanCI([...perPerson.values()].map(mean));
    return { kind: 'pair_share', slots: names, decided: outcomes.length, ties, position, overall, rows: perPair.sort((a, b) => (b.share ?? -1) - (a.share ?? -1)) };
  }
  const byUnit = new Map();
  outcomes.forEach((o) => {
    const u = unitById(design, o.unit);
    if (!u) return;
    const row = byUnit.get(o.unit) || { unit: o.unit, label: labelFor(design, o.unit), n: 0, counts: Object.fromEntries(names.map((n) => [n, 0])) };
    row.n += 1;
    const s = slotOf(o);
    if (s in row.counts) row.counts[s] += 1;
    byUnit.set(o.unit, row);
  });
  const rowsOut = [...byUnit.values()].map((r) => {
    const shares = Object.fromEntries(names.map((n) => [n, { chosen: r.counts[n], share: r.n ? r.counts[n] / r.n : null, ...wilsonRange(r.counts[n], r.n) }]));
    const top = names.slice().sort((x, y) => r.counts[y] - r.counts[x])[0];
    const u = unitById(design, r.unit);
    return { unit: r.unit, label: r.label, n: r.n, top, topShare: r.n ? r.counts[top] / r.n : null, shares, ...Object.fromEntries(names.map((n) => [`share_${n}`, r.n ? r.counts[n] / r.n : null])), ...Object.fromEntries(names.map((n) => [`media_${n}`, u?.slots?.[n] || ''])) };
  });
  const totals = Object.fromEntries(names.map((n) => [n, 0]));
  rowsOut.forEach((r) => names.forEach((n) => { totals[n] += r.shares[n].chosen; }));
  const overallShares = Object.fromEntries(names.map((n) => [n, { chosen: totals[n], share: outcomes.length ? totals[n] / outcomes.length : null, ...wilsonRange(totals[n], outcomes.length) }]));
  return { kind: 'slot_share', slots: names, decided: outcomes.length, ties, position, overallShares, rows: rowsOut.sort((a, b) => (b.topShare ?? -1) - (a.topShare ?? -1)) };
}

/** Main result for a choose-any question: how often each image gets selected when shown. */
function analyseMulti(design, records) {
  const main = records.filter((r) => r.role === 'main');
  const shown = new Map();
  const selected = new Map();
  let answered = 0;
  const perTrialCounts = [];
  main.forEach((r) => {
    const idx = chosenIndices(r.trial);
    if (idx == null) return;
    answered += 1;
    perTrialCounts.push(idx.length);
    r.media.forEach((key, i) => {
      shown.set(key, (shown.get(key) || 0) + 1);
      if (idx.includes(i)) selected.set(key, (selected.get(key) || 0) + 1);
    });
  });
  const rows = [...shown.entries()].map(([unit, n]) => {
    const k = selected.get(unit) || 0;
    return { unit, selected: k, shown: n, share: n ? k / n : null, ...wilsonRange(k, n) };
  }).sort((a, b) => (b.share ?? -1) - (a.share ?? -1)).map((r, i) => ({ rank: i + 1, ...r }));
  return { kind: 'select_share', answered, meanSelected: mean(perTrialCounts), rows };
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
  const names = designSlotNames(design);
  if (design.type === 'fixed_pairs' && names.length >= 2 && design.slotMode !== 'one') {
    // Within-person differences of every other slot against the first one (B − A, C − A, …).
    const [first, ...others] = names;
    const cells = new Map();
    values.forEach((r) => {
      const key = `${r.participant}|${r.unit}`;
      const cell = cells.get(key) || { unit: r.unit };
      if (r.side) cell[r.side] = r.value;
      cells.set(key, cell);
    });
    const diffs = new Map(); // unit -> slot -> values
    cells.forEach((c) => {
      if (c[first] == null) return;
      others.forEach((name) => {
        if (c[name] == null) return;
        if (!diffs.has(c.unit)) diffs.set(c.unit, new Map());
        const perSlot = diffs.get(c.unit);
        if (!perSlot.has(name)) perSlot.set(name, []);
        perSlot.get(name).push(c[name] - c[first]);
      });
    });
    const allOf = (name) => [...diffs.values()].flatMap((m) => m.get(name) || []);
    out.slots = names;
    out.diffs = others.map((name) => ({ slot: name, vs: first, ...meanCI(allOf(name)) }));
    out.overallDiff = out.diffs[0];
    out.pairRows = design.units.map((u) => {
      const perSlot = diffs.get(u.id) || new Map();
      const row = { unit: u.id, label: u.label || u.id };
      if (others.length === 1) return { ...row, ...meanCI(perSlot.get(others[0]) || []) };
      others.forEach((name) => {
        const m = meanCI(perSlot.get(name) || []);
        row[`${name}_minus_${first}`] = m.mean; row[`${name}_minus_${first}_low`] = m.low; row[`${name}_minus_${first}_high`] = m.high; row[`${name}_minus_${first}_n`] = m.n;
      });
      row.n = Math.max(0, ...others.map((name) => (perSlot.get(name) || []).length));
      return row;
    }).filter((r) => r.n > 0);
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
  if (kind === 'choice' || kind === 'multi') {
    let same = 0;
    let n = 0;
    pairsOut.forEach(([a, b]) => {
      const pick = (r) => (kind === 'multi' ? chosenIndices(r.trial)?.map((i) => r.media[i]).sort().join('|') : (typeof chosenIndex(r.trial) === 'number' ? r.media[chosenIndex(r.trial)] : null));
      const x = pick(a);
      const y = pick(b);
      if (x == null || y == null) return;
      n += 1;
      if (x === y) same += 1;
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

/** Each participant's own summary of a trial: share choosing the second slot, share selected, or the rating. */
function personValue(design, r, kind, type) {
  if (kind === 'choice') {
    const names = designSlotNames(design);
    if (names.length !== 2) return null;
    const i = chosenIndex(r.trial);
    if (typeof i !== 'number') return null;
    const slot = r.slots ? r.slots[i] : names[i];
    return slot === names[1] ? 1 : 0;
  }
  if (kind === 'multi') {
    const idx = chosenIndices(r.trial);
    return idx && r.media.length ? idx.length / r.media.length : null;
  }
  return numericValue(r.trial, type);
}

/** Condition comparison on each participant's own summary. */
function analyseConditions(design, records, kind, type, conditions) {
  if (conditions.length < 2 || design.type === 'pool_pairs') return null;
  const perPerson = new Map();
  records.filter((r) => r.role === 'main' && r.condition != null).forEach((r) => {
    const v = personValue(design, r, kind, type);
    if (v == null) return;
    const row = perPerson.get(r.participant) || { condition: r.condition, xs: [] };
    row.xs.push(v);
    perPerson.set(r.participant, row);
  });
  if (!perPerson.size) return null;
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

/** Does the higher-rated image of a pair get chosen? (two-slot units, choice + rating questions) */
function crossQuestionConsistency(design, choiceRecords, ratingRecords, ratingType) {
  const ratings = new Map();
  ratingRecords.filter((r) => r.role === 'main').forEach((r) => {
    const v = numericValue(r.trial, ratingType);
    if (v == null || !r.media[0]) return;
    ratings.set(`${r.participant}|${r.unit}|${r.media[0]}`, v);
  });
  let agree = 0;
  let n = 0;
  choiceRecords.filter((r) => r.role === 'main' && r.media.length === 2).forEach((r) => {
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
      : kind === 'multi' ? analyseMulti(design, records)
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
  if (design.type === 'fixed_pairs' && designSlotNames(design).length === 2) {
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
  if (kind === 'choice' || kind === 'multi') {
    const byUnit = new Map();
    anchorRecords.forEach((r) => {
      const idx = kind === 'multi' ? chosenIndices(r.trial) : (typeof chosenIndex(r.trial) === 'number' ? [chosenIndex(r.trial)] : null);
      if (!idx) return;
      const row = byUnit.get(r.unit) || { unit: r.unit, counts: new Map(), n: 0 };
      row.n += 1;
      idx.forEach((i) => row.counts.set(r.media[i], (row.counts.get(r.media[i]) || 0) + 1));
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
  const width = design.type === 'pool_pairs' ? perTrial(design) : Math.max(1, designSlotNames(design).length, ...design.catches.map((c) => c.media.length));
  const mediaCols = Array.from({ length: width }, (_, i) => `media_${i + 1}`);
  const tableRows = [];
  for (let v = 0; v < sizing.versions; v += 1) {
    versionTrials(design, v).forEach((t) => tableRows.push({
      version: v, trial: t.trial, role: t.role, unit: t.unit, order: t.order || '', expected: t.expected ?? '',
      ...Object.fromEntries(mediaCols.map((c, i) => [c, t.media[i] || ''])),
    }));
  }
  const files = [
    { path: `${prefix}/design.json`, content: JSON.stringify(design, null, 2) },
    { path: `${prefix}/design_table.csv`, content: csv(['version', 'trial', 'role', 'unit', 'order', 'expected', ...mediaCols], tableRows) },
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
