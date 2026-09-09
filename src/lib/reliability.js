import { mediaIdentityKey, stimulusUnitKey, resolveMediaAnswerKey } from './mediaIdentity.js';
/** Inter-rater reliability: Krippendorff's alpha and agreement rate. */

import { expandQuestionAnswerUnits } from './responseAnswerUnits.js';

/**
 * One coder per participant (fallback: response), one unit per ordered stimulus.
 * Repeated interval observations are averaged; conflicting nominal repeats are omitted.
 */
export function buildIrrMatrix(responses, questionName, { interval = false, dimension = null } = {}) {
  const observations = new Map();
  responses.forEach((row, index) => {
    const coder = row.participant_id || row.id || String(index);
    expandQuestionAnswerUnits(row, questionName).forEach(({ answer, shown_images: shown }) => {
      const value = dimension ? answer?.[dimension] : answer;
      const add = (unit, v) => {
        if (!observations.has(unit)) observations.set(unit, new Map());
        const coders = observations.get(unit);
        if (!coders.has(coder)) coders.set(coder, []);
        coders.get(coder).push(v);
      };
      if (typeof value === 'number' && Number.isFinite(value)) {
        add(shown.length ? stimulusUnitKey(shown) : questionName, value);
      } else if (!interval && typeof value === 'string' && shown.length) {
        const chosen = resolveMediaAnswerKey(value, shown);
        if (chosen) shown.forEach((img) => add(mediaIdentityKey(img), mediaIdentityKey(img) === chosen ? 1 : 0));
      }
    });
  });
  const unitMap = new Map();
  observations.forEach((coders, unit) => {
    const values = {};
    coders.forEach((repeats, coder) => {
      if (interval) values[coder] = repeats.reduce((a, b) => a + b, 0) / repeats.length;
      else if (repeats.every((v) => v === repeats[0])) values[coder] = repeats[0];
    });
    unitMap.set(unit, values);
  });
  return { units: [...unitMap.keys()], coderCount: new Set(responses.map((r, i) => r.participant_id || r.id || String(i))).size, unitMap };
}

function nominalDistance(a, b) {
  return a === b ? 0 : 1;
}

function intervalDistance(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return nominalDistance(a, b);
  return (na - nb) ** 2;
}

/**
 * Krippendorff's alpha (nominal or interval).
 * Returns null when insufficient overlapping ratings.
 */
export function krippendorffAlpha(responses, questionName, { level = 'interval', dimension = null } = {}) {
  const { units, unitMap } = buildIrrMatrix(responses, questionName, { interval: level === 'interval', dimension });
  if (units.length < 2) return null;

  const distFn = level === 'interval' ? intervalDistance : nominalDistance;
  let obsDisagreement = 0;
  let obsPairs = 0;
  const allValues = [];

  units.forEach((unit) => {
    const coders = Object.entries(unitMap.get(unit) || {});
    if (coders.length < 2) return;
    coders.forEach(([, v]) => allValues.push(v));
    for (let i = 0; i < coders.length; i += 1) {
      for (let j = i + 1; j < coders.length; j += 1) {
        obsDisagreement += distFn(coders[i][1], coders[j][1]);
        obsPairs += 1;
      }
    }
  });

  if (obsPairs === 0) return null;

  const valueFreq = {};
  allValues.forEach((v) => { valueFreq[v] = (valueFreq[v] || 0) + 1; });
  const totalVals = allValues.length;
  let expDisagreement = 0;
  let expPairs = 0;
  const vals = Object.keys(valueFreq);
  for (let i = 0; i < vals.length; i += 1) {
    for (let j = i; j < vals.length; j += 1) {
      const ni = valueFreq[vals[i]];
      const nj = valueFreq[vals[j]];
      const pairs = i === j ? ni * (ni - 1) / 2 : ni * nj;
      expDisagreement += pairs * distFn(vals[i], vals[j]);
      expPairs += pairs;
    }
  }
  if (expPairs === 0) return null;

  const Do = obsDisagreement / obsPairs;
  const De = expDisagreement / expPairs;
  if (De === 0) return Do === 0 ? 1 : null;
  return 1 - Do / De;
}

export function percentAgreement(responses, questionName, options = {}) {
  const { units, unitMap } = buildIrrMatrix(responses, questionName, options);
  let agree = 0;
  let total = 0;
  units.forEach((unit) => {
    const vals = Object.values(unitMap.get(unit) || {});
    if (vals.length < 2) return;
    const first = vals[0];
    if (vals.every((v) => v === first)) agree += 1;
    total += 1;
  });
  return total === 0 ? null : agree / total;
}

export function irrLevelForQuestion(question) {
  if (['rating', 'imagerating', 'mediarating', 'slidergroup', 'imageslidergroup', 'mediaslidergroup', 'skillquestion'].includes(question.type)) {
    return 'interval';
  }
  return 'nominal';
}

export function interpretAlpha(alpha) {
  if (alpha == null) return 'Insufficient overlapping ratings';
  if (alpha >= 0.8) return 'Excellent reliability (α ≥ 0.80)';
  if (alpha >= 0.667) return 'Acceptable for exploratory research (α ≥ 0.667)';
  if (alpha >= 0.4) return 'Moderate — interpret with caution';
  return 'Poor reliability — review data quality';
}

export function computeQuestionIrr(responses, question) {
  const level = irrLevelForQuestion(question);
  const calculate = (dimension = null) => {
    const alpha = krippendorffAlpha(responses, question.name, { level, dimension });
    const agreement = percentAgreement(responses, question.name, { interval: level === 'interval', dimension });
    return { alpha, agreement, level, interpretation: interpretAlpha(alpha) };
  };
  if (['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(question.type)) {
    return { alpha: null, agreement: null, level, dimensions: (question.dimensions || []).map((d) => ({
      id: d.id, label: d.label || d.id, ...calculate(d.id),
    })) };
  }
  return calculate();
}
