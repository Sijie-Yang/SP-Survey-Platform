/**
 * Deterministic SP-Bench scoring (no LLM-as-judge).
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mae(pairs) {
  if (!pairs.length) return null;
  return mean(pairs.map(([y, yhat]) => Math.abs(y - yhat)));
}

function rmse(pairs) {
  if (!pairs.length) return null;
  return Math.sqrt(mean(pairs.map(([y, yhat]) => (y - yhat) ** 2)));
}

function pearson(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

function rank(values) {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j += 1;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k += 1) ranks[indexed[k].i] = avg;
    i = j;
  }
  return ranks;
}

function spearman(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const rx = rank(xs);
  const ry = rank(ys);
  return pearson(rx.map((x, i) => [x, ry[i]]));
}

function macroF1(yTrue, yPred, labels) {
  const classes = labels?.length
    ? labels
    : [...new Set([...yTrue, ...yPred].filter((x) => x != null))];
  if (!classes.length) return null;
  const scores = classes.map((label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
      const t = yTrue[i] === label;
      const p = yPred[i] === label;
      if (t && p) tp += 1;
      else if (!t && p) fp += 1;
      else if (t && !p) fn += 1;
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  });
  return mean(scores);
}

function balancedAccuracy(yTrue, yPred, labels) {
  const classes = labels?.length
    ? labels
    : [...new Set(yTrue.filter((x) => x != null))];
  if (!classes.length) return null;
  const recalls = classes.map((label) => {
    let tp = 0;
    let support = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
      if (yTrue[i] !== label) continue;
      support += 1;
      if (yPred[i] === label) tp += 1;
    }
    return support ? tp / support : null;
  }).filter((x) => x != null);
  return mean(recalls);
}

function multiLabelF1(yTrueLists, yPredLists, labels) {
  const classes = labels?.length
    ? labels
    : [...new Set(yTrueLists.flat())];
  if (!classes.length) return null;
  const scores = classes.map((label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrueLists.length; i += 1) {
      const t = (yTrueLists[i] || []).includes(label);
      const p = (yPredLists[i] || []).includes(label);
      if (t && p) tp += 1;
      else if (!t && p) fp += 1;
      else if (t && !p) fn += 1;
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  });
  return mean(scores);
}

function pairwiseAccuracy(pairs) {
  if (!pairs.length) return null;
  let correct = 0;
  for (const [truth, pred] of pairs) {
    const t = typeof truth === 'object' ? truth?.preferred : truth;
    const p = typeof pred === 'object' ? pred?.preferred : pred;
    if (t && p && t === p) correct += 1;
  }
  return correct / pairs.length;
}

function primaryMetric(dim, metrics) {
  const preferred = Array.isArray(dim.metrics) && dim.metrics.length
    ? dim.metrics[0]
    : null;
  if (preferred && metrics[preferred] != null) return metrics[preferred];
  for (const key of ['macro_f1', 'balanced_accuracy', 'spearman', 'pearson', 'pairwise_accuracy', 'mae']) {
    if (metrics[key] != null) {
      if (key === 'mae' || key === 'rmse') {
        const range = (dim.value_range?.max ?? 1) - (dim.value_range?.min ?? 0) || 1;
        return Math.max(0, 1 - metrics[key] / range);
      }
      return metrics[key];
    }
  }
  return null;
}

/**
 * @param {Array<{ labels: object, prediction: object }>} rows
 * @param {Array<object>} dimensions
 */
export function scoreRun(rows, dimensions = []) {
  const dimensionScores = {};
  const groupBuckets = { objective: [], subjective: [], cognition: [] };

  for (const dim of dimensions.filter((d) => d.enabled !== false)) {
    const field = dim.prompt_field || dim.key;
    const metrics = {};

    if (dim.label_type === 'continuous') {
      const pairs = [];
      for (const row of rows) {
        const y = toNumber(row.labels?.[field]);
        const yhat = toNumber(row.prediction?.[field]);
        if (y == null || yhat == null) continue;
        pairs.push([y, yhat]);
      }
      metrics.n = pairs.length;
      metrics.mae = mae(pairs);
      metrics.rmse = rmse(pairs);
      metrics.pearson = pearson(pairs);
      metrics.spearman = spearman(pairs);
    } else if (dim.label_type === 'category') {
      const yTrue = [];
      const yPred = [];
      for (const row of rows) {
        const y = row.labels?.[field];
        const yhat = row.prediction?.[field];
        if (y == null || yhat == null) continue;
        yTrue.push(y);
        yPred.push(yhat);
      }
      metrics.n = yTrue.length;
      metrics.macro_f1 = macroF1(yTrue, yPred, dim.value_range?.choices);
      metrics.balanced_accuracy = balancedAccuracy(yTrue, yPred, dim.value_range?.choices);
    } else if (dim.label_type === 'multi_label') {
      const yTrue = [];
      const yPred = [];
      for (const row of rows) {
        const y = row.labels?.[field];
        const yhat = row.prediction?.[field];
        if (!Array.isArray(y) || !Array.isArray(yhat)) continue;
        yTrue.push(y);
        yPred.push(yhat);
      }
      metrics.n = yTrue.length;
      metrics.macro_f1 = multiLabelF1(yTrue, yPred, dim.value_range?.choices);
    } else if (dim.label_type === 'pairwise') {
      const pairs = [];
      for (const row of rows) {
        const y = row.labels?.[field];
        const yhat = row.prediction?.[field];
        if (y == null || yhat == null) continue;
        pairs.push([y, yhat]);
      }
      metrics.n = pairs.length;
      metrics.pairwise_accuracy = pairwiseAccuracy(pairs);
    }

    const score = primaryMetric(dim, metrics);
    const weight = Number(dim.weight) > 0 ? Number(dim.weight) : 1;
    dimensionScores[dim.key] = { ...metrics, score, weight, group_key: dim.group_key };
    if (score != null && groupBuckets[dim.group_key]) {
      groupBuckets[dim.group_key].push({ score, weight });
    }
  }

  const groupScores = {};
  const overallParts = [];
  for (const [group, parts] of Object.entries(groupBuckets)) {
    if (!parts.length) {
      groupScores[group] = null;
      continue;
    }
    const wSum = parts.reduce((a, p) => a + p.weight, 0) || 1;
    const g = parts.reduce((a, p) => a + p.score * p.weight, 0) / wSum;
    groupScores[group] = g;
    overallParts.push({ score: g, weight: wSum });
  }
  const overallWeight = overallParts.reduce((a, p) => a + p.weight, 0) || 1;
  const overallScore = overallParts.length
    ? overallParts.reduce((a, p) => a + p.score * p.weight, 0) / overallWeight
    : null;

  return {
    overall_score: overallScore,
    group_scores: groupScores,
    dimension_scores: dimensionScores,
    sample_size: rows.length,
  };
}

export {
  mae,
  rmse,
  pearson,
  spearman,
  macroF1,
  balancedAccuracy,
  multiLabelF1,
  pairwiseAccuracy,
};
