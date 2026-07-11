/**
 * Browser-side multi-model ablation for Image × Perception.
 * VIF screen → OLS / Ridge / Lasso / RF / Gradient Boosting / MLP.
 * Cooperative cancel via AbortSignal + onProgress yields.
 */
import { perceptionFeatureValue, featureKeyMatchesModelFilter } from './imagePerceptionJoin';

export const ABLATION_MODELS = [
  { id: 'ols', label: 'OLS' },
  { id: 'ridge', label: 'Ridge' },
  { id: 'lasso', label: 'Lasso' },
  { id: 'elasticnet', label: 'Elastic Net' },
  { id: 'rf', label: 'Random Forest' },
  { id: 'gbm', label: 'Gradient Boosting (XGBoost-style)' },
  { id: 'mlp', label: 'Neural Net (MLP)' },
];

const META_SKIP = new Set([
  'media_id', 'name', 'url', 'mean_score', 'n_ratings', 'question_name',
  'attribute_id', 'score_kind',
  'l0_status', 'seg_status', 'sam_status', 'seg_vocab',
]);

function assertNotAborted(signal) {
  if (signal?.aborted) {
    // Plain Error only — Safari throws if anything assigns to DOMException.name/message.
    throw new Error('Aborted');
  }
}

export function isAbortError(err) {
  return err?.message === 'Aborted' || err?.name === 'AbortError';
}

async function yieldToUi(signal) {
  assertNotAborted(signal);
  await new Promise((r) => setTimeout(r, 0));
  assertNotAborted(signal);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function variance(xs, m = mean(xs)) {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const v of xs) s += (v - m) ** 2;
  return s / xs.length;
}

function std(xs, m = mean(xs)) {
  return Math.sqrt(variance(xs, m)) || 1e-12;
}

function r2Score(yTrue, yPred) {
  const m = mean(yTrue);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    ssTot += (yTrue[i] - m) ** 2;
    ssRes += (yTrue[i] - yPred[i]) ** 2;
  }
  if (ssTot < 1e-18) return 0;
  return 1 - ssRes / ssTot;
}

function rmse(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i += 1) s += (yTrue[i] - yPred[i]) ** 2;
  return Math.sqrt(s / Math.max(yTrue.length, 1));
}

function mae(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i += 1) s += Math.abs(yTrue[i] - yPred[i]);
  return s / Math.max(yTrue.length, 1);
}

function metrics(yTrue, yPred) {
  return {
    r2: r2Score(yTrue, yPred),
    rmse: rmse(yTrue, yPred),
    mae: mae(yTrue, yPred),
  };
}

/** Gaussian elimination solve Ax = b. A is n×n (mutated copy). */
function solveLinear(Ain, bin, pivotEps = 1e-10) {
  const n = bin.length;
  const A = Ain.map((row, i) => [...row, bin[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < pivotEps) return null;
    if (piv !== col) {
      const tmp = A[col];
      A[col] = A[piv];
      A[piv] = tmp;
    }
    const div = A[col][col];
    for (let c = col; c <= n; c += 1) A[col][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[n]);
}

function matVec(X, beta) {
  return X.map((row) => {
    let s = 0;
    for (let j = 0; j < beta.length; j += 1) s += row[j] * beta[j];
    return s;
  });
}

function transpose(X) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const T = Array.from({ length: p }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < p; j += 1) T[j][i] = X[i][j];
  }
  return T;
}

function matMul(A, B) {
  const n = A.length;
  const m = B[0]?.length || 0;
  const k = B.length;
  const C = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < k; t += 1) {
      const a = A[i][t];
      if (!a) continue;
      for (let j = 0; j < m; j += 1) C[i][j] += a * B[t][j];
    }
  }
  return C;
}

/** Drop near-constant columns (cause singular XtX). */
function dropConstantColumns(X, featureNames, eps = 1e-10) {
  if (!X.length) return { X, featureNames, dropped: [] };
  const p = X[0].length;
  const keep = [];
  const dropped = [];
  for (let j = 0; j < p; j += 1) {
    const col = X.map((r) => r[j]);
    if (std(col) <= eps) dropped.push(featureNames[j]);
    else keep.push(j);
  }
  if (keep.length === p) return { X, featureNames, dropped: [] };
  return {
    X: X.map((row) => keep.map((j) => row[j])),
    featureNames: keep.map((j) => featureNames[j]),
    dropped,
  };
}

/**
 * OLS / Ridge closed form. X includes intercept column.
 * Falls back to increasing ridge when XtX is singular (collinearity / p≈n).
 */
function fitRidge(X, y, lambda = 0) {
  if (!X?.length || !X[0]?.length) return null;
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const p = XtX.length;
  const Xty = Xt.map((row) => {
    let s = 0;
    for (let i = 0; i < y.length; i += 1) s += row[i] * y[i];
    return s;
  });

  const trySolve = (lam) => {
    // Always allocate a fresh matrix — never mutate XtX (may be shared / frozen).
    const reg = XtX.map((row, i) => row.map((v, j) => v + (i === j && i !== 0 ? lam : 0)));
    return solveLinear(reg, Xty);
  };

  // Always start with a tiny stabilizer for OLS (lambda=0) to avoid singular pivots.
  const n = X.length;
  const floor = p >= n ? 1e-2 : 1e-8;
  const bumps = [
    Math.max(lambda, floor),
    Math.max(lambda, 1e-6),
    Math.max(lambda, 1e-4),
    Math.max(lambda, 1e-2),
    Math.max(lambda, 0.1),
    Math.max(lambda, 1),
    Math.max(lambda, 10),
  ];
  const tried = new Set();
  for (const lam of bumps) {
    const key = String(lam);
    if (tried.has(key)) continue;
    tried.add(key);
    const beta = trySolve(lam);
    if (beta) return beta;
  }
  return null;
}

function fitLasso(X, y, {
  alpha = 0.01,
  l1Ratio = 1,
  maxIter = 400,
  tol = 1e-5,
} = {}) {
  const n = X.length;
  const p = X[0].length;
  const beta = Array(p).fill(0);
  beta[0] = mean(y);
  const soft = (z, t) => {
    if (z > t) return z - t;
    if (z < -t) return z + t;
    return 0;
  };
  for (let iter = 0; iter < maxIter; iter += 1) {
    let maxDelta = 0;
    for (let j = 0; j < p; j += 1) {
      let residDot = 0;
      let zj = 0;
      for (let i = 0; i < n; i += 1) {
        let pred = 0;
        for (let k = 0; k < p; k += 1) {
          if (k === j) continue;
          pred += X[i][k] * beta[k];
        }
        const r = y[i] - pred;
        residDot += X[i][j] * r;
        zj += X[i][j] * X[i][j];
      }
      if (zj < 1e-18) continue;
      const rho = residDot / n;
      const zjN = zj / n;
      let next;
      if (j === 0) {
        next = rho / zjN;
      } else {
        const l1 = alpha * l1Ratio;
        const l2 = alpha * (1 - l1Ratio);
        next = soft(rho, l1) / (zjN + l2);
      }
      maxDelta = Math.max(maxDelta, Math.abs(next - beta[j]));
      beta[j] = next;
    }
    if (maxDelta < tol) break;
  }
  return beta;
}

function withIntercept(X) {
  return X.map((row) => [1, ...row]);
}

function standardizeColumns(X) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const means = Array(p).fill(0);
  const sds = Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    const col = X.map((r) => r[j]);
    means[j] = mean(col);
    sds[j] = std(col, means[j]);
  }
  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / sds[j]));
  return { Xs, means, sds };
}

/** VIF for each feature (no intercept). Drop until all VIF <= maxVif. */
export async function screenByVif(X, featureNames, maxVif = 10, minFeatures = 2, signal = null) {
  let names = [...featureNames];
  let cols = X.map((row) => [...row]);
  const dropped = [];
  while (names.length > minFeatures) {
    assertNotAborted(signal);
    const { Xs } = standardizeColumns(cols);
    const p = names.length;
    const vifs = [];
    for (let j = 0; j < p; j += 1) {
      const yj = Xs.map((r) => r[j]);
      const Xj = Xs.map((r) => r.filter((_, k) => k !== j));
      if (Xj[0].length === 0) {
        vifs.push({ j, name: names[j], vif: 1 });
        continue;
      }
      const Xi = withIntercept(Xj);
      const beta = fitRidge(Xi, yj, 1e-8);
      if (!beta) {
        vifs.push({ j, name: names[j], vif: Infinity });
        continue;
      }
      const pred = matVec(Xi, beta);
      const r2 = r2Score(yj, pred);
      const vif = r2 >= 0.999999 ? Infinity : 1 / (1 - r2);
      vifs.push({ j, name: names[j], vif });
    }
    vifs.sort((a, b) => b.vif - a.vif);
    const worst = vifs[0];
    if (!(worst.vif > maxVif)) {
      return {
        featureNames: names,
        X: cols,
        vifs: vifs.map((v) => ({ feature: v.name, vif: Number.isFinite(v.vif) ? v.vif : null })),
        dropped,
      };
    }
    dropped.push({ feature: worst.name, vif: Number.isFinite(worst.vif) ? worst.vif : null });
    names = names.filter((_, i) => i !== worst.j);
    cols = cols.map((row) => row.filter((_, i) => i !== worst.j));
    await yieldToUi(signal);
  }
  const { Xs } = standardizeColumns(cols);
  const finalVifs = names.map((name, j) => {
    const yj = Xs.map((r) => r[j]);
    const Xj = Xs.map((r) => r.filter((_, k) => k !== j));
    if (!Xj[0]?.length) return { feature: name, vif: 1 };
    const Xi = withIntercept(Xj);
    const beta = fitRidge(Xi, yj, 1e-8);
    if (!beta) return { feature: name, vif: null };
    const r2 = r2Score(yj, matVec(Xi, beta));
    return { feature: name, vif: r2 >= 0.999999 ? null : 1 / (1 - r2) };
  });
  return { featureNames: names, X: cols, vifs: finalVifs, dropped };
}

function trainTestSplit(X, y, testFrac, rng) {
  const idx = X.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  const nTest = Math.max(1, Math.floor(X.length * testFrac));
  const nTrain = X.length - nTest;
  if (nTrain < 5) {
    return {
      Xtrain: X,
      ytrain: y,
      Xtest: X,
      ytest: y,
      trainIdx: idx,
      testIdx: idx,
    };
  }
  const testIdx = idx.slice(0, nTest);
  const trainIdx = idx.slice(nTest);
  return {
    Xtrain: trainIdx.map((i) => X[i]),
    ytrain: trainIdx.map((i) => y[i]),
    Xtest: testIdx.map((i) => X[i]),
    ytest: testIdx.map((i) => y[i]),
    trainIdx,
    testIdx,
  };
}

function importanceFromAbsBeta(names, betaWithIntercept) {
  const coeffs = names.map((name, i) => ({
    feature: name,
    weight: betaWithIntercept[i + 1] || 0,
  }));
  const maxAbs = Math.max(...coeffs.map((c) => Math.abs(c.weight)), 1e-12);
  return coeffs
    .map((c) => ({ ...c, importance: Math.abs(c.weight) / maxAbs }))
    .sort((a, b) => b.importance - a.importance);
}

/* ---------- trees / RF / GBM ---------- */

function buildTree(X, y, rng, {
  maxDepth = 5,
  minLeaf = 5,
  maxFeatures = null,
} = {}, depth = 0) {
  const n = y.length;
  const m = mean(y);
  if (depth >= maxDepth || n <= minLeaf * 2) {
    return { type: 'leaf', value: m };
  }
  const p = X[0].length;
  const nFeat = maxFeatures ? Math.min(p, maxFeatures) : p;
  const feats = Array.from({ length: p }, (_, i) => i);
  for (let i = feats.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = feats[i];
    feats[i] = feats[j];
    feats[j] = t;
  }
  const candidates = feats.slice(0, nFeat);
  let best = null;
  for (const j of candidates) {
    const vals = X.map((r) => r[j]);
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    if (uniq.length < 2) continue;
    const step = Math.max(1, Math.floor(uniq.length / 12));
    for (let t = step; t < uniq.length; t += step) {
      const thr = (uniq[t - 1] + uniq[t]) / 2;
      const leftY = [];
      const rightY = [];
      for (let i = 0; i < n; i += 1) {
        if (X[i][j] <= thr) leftY.push(y[i]);
        else rightY.push(y[i]);
      }
      if (leftY.length < minLeaf || rightY.length < minLeaf) continue;
      const varTot = variance(y);
      const gain = varTot - (leftY.length / n) * variance(leftY) - (rightY.length / n) * variance(rightY);
      if (!best || gain > best.gain) best = { j, thr, gain };
    }
  }
  if (!best || best.gain <= 1e-12) return { type: 'leaf', value: m };
  const leftX = [];
  const leftY = [];
  const rightX = [];
  const rightY = [];
  for (let i = 0; i < n; i += 1) {
    if (X[i][best.j] <= best.thr) {
      leftX.push(X[i]);
      leftY.push(y[i]);
    } else {
      rightX.push(X[i]);
      rightY.push(y[i]);
    }
  }
  return {
    type: 'split',
    feature: best.j,
    threshold: best.thr,
    left: buildTree(leftX, leftY, rng, { maxDepth, minLeaf, maxFeatures }, depth + 1),
    right: buildTree(rightX, rightY, rng, { maxDepth, minLeaf, maxFeatures }, depth + 1),
  };
}

function predictTree(tree, row) {
  let node = tree;
  while (node && node.type === 'split') {
    node = row[node.feature] <= node.threshold ? node.left : node.right;
  }
  return node?.value ?? 0;
}

function accumulateTreeImportance(tree, counts) {
  if (!tree || tree.type === 'leaf') return;
  const j = tree.feature;
  counts[j] = (counts[j] || 0) + 1;
  accumulateTreeImportance(tree.left, counts);
  accumulateTreeImportance(tree.right, counts);
}

async function fitRandomForest(X, y, rng, signal, onProgress, {
  nTrees = 40,
  maxDepth = 6,
  minLeaf = 4,
} = {}) {
  const p = X[0].length;
  const maxFeatures = Math.max(1, Math.floor(Math.sqrt(p)));
  const trees = [];
  const counts = Object.create(null);
  for (let t = 0; t < nTrees; t += 1) {
    assertNotAborted(signal);
    const bagX = [];
    const bagY = [];
    for (let i = 0; i < X.length; i += 1) {
      const k = Math.floor(rng() * X.length);
      bagX.push(X[k]);
      bagY.push(y[k]);
    }
    const tree = buildTree(bagX, bagY, rng, { maxDepth, minLeaf, maxFeatures });
    trees.push(tree);
    accumulateTreeImportance(tree, counts);
    onProgress?.({ model: 'rf', done: t + 1, total: nTrees });
    if (t % 2 === 1) await yieldToUi(signal);
  }
  const predict = (rows) => rows.map((row) => {
    let s = 0;
    for (const tree of trees) s += predictTree(tree, row);
    return s / trees.length;
  });
  const imp = Array.from({ length: p }, (_, i) => counts[i] || 0);
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
  };
}

async function fitGbm(X, y, rng, signal, onProgress, {
  nEstimators = 60,
  learningRate = 0.08,
  maxDepth = 3,
  minLeaf = 5,
} = {}) {
  const p = X[0].length;
  const F0 = mean(y);
  const trees = [];
  const counts = Object.create(null);
  let residual = y.map((v) => v - F0);
  for (let t = 0; t < nEstimators; t += 1) {
    assertNotAborted(signal);
    const tree = buildTree(X, residual, rng, {
      maxDepth,
      minLeaf,
      maxFeatures: Math.max(1, Math.floor(Math.sqrt(p))),
    });
    trees.push(tree);
    accumulateTreeImportance(tree, counts);
    residual = residual.map((r, i) => r - learningRate * predictTree(tree, X[i]));
    onProgress?.({ model: 'gbm', done: t + 1, total: nEstimators });
    if (t % 2 === 1) await yieldToUi(signal);
  }
  const predict = (rows) => rows.map((row) => {
    let s = F0;
    for (const tree of trees) s += learningRate * predictTree(tree, row);
    return s;
  });
  const imp = Array.from({ length: p }, (_, i) => counts[i] || 0);
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
  };
}

/* ---------- tiny MLP ---------- */

function relu(x) { return x > 0 ? x : 0; }
function drelu(x) { return x > 0 ? 1 : 0; }

async function fitMlp(X, y, rng, signal, onProgress, {
  hidden = 16,
  epochs = 120,
  lr = 0.02,
} = {}) {
  const n = X.length;
  const p = X[0].length;
  const W1 = Array.from({ length: hidden }, () => Array.from({ length: p }, () => (rng() * 2 - 1) * 0.2));
  const b1 = Array(hidden).fill(0);
  const W2 = Array.from({ length: hidden }, () => (rng() * 2 - 1) * 0.2);
  let b2 = mean(y);

  for (let ep = 0; ep < epochs; ep += 1) {
    assertNotAborted(signal);
    let loss = 0;
    for (let i = 0; i < n; i += 1) {
      const x = X[i];
      const h = Array(hidden);
      const hPre = Array(hidden);
      for (let j = 0; j < hidden; j += 1) {
        let s = b1[j];
        for (let k = 0; k < p; k += 1) s += W1[j][k] * x[k];
        hPre[j] = s;
        h[j] = relu(s);
      }
      let pred = b2;
      for (let j = 0; j < hidden; j += 1) pred += W2[j] * h[j];
      const err = pred - y[i];
      loss += err * err;
      // grads
      b2 -= lr * err;
      for (let j = 0; j < hidden; j += 1) {
        const dW2 = err * h[j];
        const dh = err * W2[j] * drelu(hPre[j]);
        W2[j] -= lr * dW2;
        b1[j] -= lr * dh;
        for (let k = 0; k < p; k += 1) W1[j][k] -= lr * dh * x[k];
      }
    }
    onProgress?.({ model: 'mlp', done: ep + 1, total: epochs, loss: loss / n });
    if (ep % 5 === 4) await yieldToUi(signal);
  }

  const predict = (rows) => rows.map((x) => {
    let pred = b2;
    for (let j = 0; j < hidden; j += 1) {
      let s = b1[j];
      for (let k = 0; k < p; k += 1) s += W1[j][k] * x[k];
      pred += W2[j] * relu(s);
    }
    return pred;
  });

  // Input sensitivity importance: |W2| * mean(|W1|)
  const imp = Array(p).fill(0);
  for (let k = 0; k < p; k += 1) {
    let s = 0;
    for (let j = 0; j < hidden; j += 1) s += Math.abs(W2[j]) * Math.abs(W1[j][k]);
    imp[k] = s;
  }
  const maxImp = Math.max(...imp, 1e-12);
  return {
    predict,
    importance: imp.map((v, i) => ({ featureIndex: i, importance: v / maxImp })),
  };
}

/**
 * Collect numeric feature matrix from perception rows.
 */
export function buildAblationMatrix(rows, modelFilter = 'all') {
  const scored = (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0);
  const keySet = new Set();
  scored.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (META_SKIP.has(k)) return;
      if (!featureKeyMatchesModelFilter(k, modelFilter)) return;
      if (Number.isFinite(perceptionFeatureValue(r, k))) keySet.add(k);
    });
  });
  const featureNames = [...keySet].sort((a, b) => a.localeCompare(b));
  const Xraw = [];
  const y = [];
  const keepIds = [];
  for (const r of scored) {
    const row = featureNames.map((k) => perceptionFeatureValue(r, k));
    if (row.every((v) => Number.isFinite(v))) {
      Xraw.push(row);
      y.push(r.mean_score);
      keepIds.push(r.media_id);
    }
  }
  return { featureNames, X: Xraw, y, mediaIds: keepIds, n: y.length };
}

/**
 * Run full ablation pipeline. Cancel with signal.abort().
 */
export async function runPerceptionAblation({
  rows,
  modelFilter = 'all',
  models = ABLATION_MODELS.map((m) => m.id),
  vifMax = 10,
  testFraction = 0.25,
  seed = 42,
  signal = null,
  onProgress = null,
} = {}) {
  const report = (msg, extra = {}) => {
    onProgress?.({ message: msg, ...extra });
  };

  report('Building feature matrix…', { phase: 'prep', pct: 2 });
  await yieldToUi(signal);
  const built = buildAblationMatrix(rows, modelFilter);
  // Detach from any frozen / shared row vectors before later bagging / splits.
  built.X = built.X.map((row) => Float64Array.from(row, (v) => +v));
  built.y = Float64Array.from(built.y, (v) => +v);
  if (built.n < 12) {
    throw new Error(`Need ≥12 scored images with complete features (have ${built.n}).`);
  }
  if (built.featureNames.length < 2) {
    throw new Error('Need ≥2 numeric features for ablation.');
  }

  report(`VIF screening (${built.featureNames.length} features, max VIF=${vifMax})…`, {
    phase: 'vif',
    pct: 8,
  });
  await yieldToUi(signal);
  const screened = await screenByVif(built.X, built.featureNames, vifMax, 2, signal);
  assertNotAborted(signal);

  const pruned = dropConstantColumns(screened.X, screened.featureNames);
  if (pruned.featureNames.length < 2) {
    throw new Error('Too few non-constant features left after VIF / variance filter.');
  }

  const { Xs, means, sds } = standardizeColumns(pruned.X);
  const rng = mulberry32(seed);
  const split = trainTestSplit(Xs, built.y, testFraction, rng);

  const selectedModels = models.filter((id) => ABLATION_MODELS.some((m) => m.id === id));
  const results = [];
  const totalSteps = selectedModels.length;
  let step = 0;

  for (const modelId of selectedModels) {
    assertNotAborted(signal);
    step += 1;
    const basePct = 15 + ((step - 1) / Math.max(totalSteps, 1)) * 80;
    report(`Training ${modelId}…`, { phase: modelId, pct: basePct, model: modelId });
    await yieldToUi(signal);

    const names = pruned.featureNames;
    let trainPred;
    let testPred;
    let importance = [];
    let note = null;

    try {
      if (modelId === 'ols' || modelId === 'ridge') {
        const lambda = modelId === 'ridge' ? 1.0 : 0;
        const beta = fitRidge(withIntercept(split.Xtrain), split.ytrain, lambda);
        if (!beta) {
          results.push({
            model: modelId,
            label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
            train: { r2: NaN, rmse: NaN, mae: NaN },
            test: { r2: NaN, rmse: NaN, mae: NaN },
            importance: [],
            note: 'Solve failed (singular design).',
            failed: true,
          });
          continue;
        }
        trainPred = matVec(withIntercept(split.Xtrain), beta);
        testPred = matVec(withIntercept(split.Xtest), beta);
        importance = importanceFromAbsBeta(names, beta);
        if (modelId === 'ols' && split.Xtrain[0].length + 1 >= split.ytrain.length) {
          note = 'Used numerical ridge stabilizer (features ≥ train rows).';
        }
      } else if (modelId === 'lasso') {
        const beta = fitLasso(withIntercept(split.Xtrain), split.ytrain, { alpha: 0.02, l1Ratio: 1 });
        trainPred = matVec(withIntercept(split.Xtrain), beta);
        testPred = matVec(withIntercept(split.Xtest), beta);
        importance = importanceFromAbsBeta(names, beta);
      } else if (modelId === 'elasticnet') {
        const beta = fitLasso(withIntercept(split.Xtrain), split.ytrain, { alpha: 0.02, l1Ratio: 0.5 });
        trainPred = matVec(withIntercept(split.Xtrain), beta);
        testPred = matVec(withIntercept(split.Xtest), beta);
        importance = importanceFromAbsBeta(names, beta);
      } else if (modelId === 'rf') {
        const model = await fitRandomForest(split.Xtrain, split.ytrain, rng, signal, (p) => {
          report(`Random Forest ${p.done}/${p.total}`, {
            phase: 'rf',
            pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
            model: 'rf',
          });
        });
        trainPred = model.predict(split.Xtrain);
        testPred = model.predict(split.Xtest);
        importance = model.importance
          .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
          .sort((a, b) => b.importance - a.importance);
      } else if (modelId === 'gbm') {
        note = 'Additive trees with shrinkage (XGBoost-style GBM in-browser; not native XGBoost).';
        const model = await fitGbm(split.Xtrain, split.ytrain, rng, signal, (p) => {
          report(`Gradient Boosting ${p.done}/${p.total}`, {
            phase: 'gbm',
            pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
            model: 'gbm',
          });
        });
        trainPred = model.predict(split.Xtrain);
        testPred = model.predict(split.Xtest);
        importance = model.importance
          .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
          .sort((a, b) => b.importance - a.importance);
      } else if (modelId === 'mlp') {
        const model = await fitMlp(split.Xtrain, split.ytrain, rng, signal, (p) => {
          report(`MLP epoch ${p.done}/${p.total}`, {
            phase: 'mlp',
            pct: basePct + (p.done / p.total) * (80 / totalSteps) * 0.9,
            model: 'mlp',
          });
        });
        trainPred = model.predict(split.Xtrain);
        testPred = model.predict(split.Xtest);
        importance = model.importance
          .map((d) => ({ feature: names[d.featureIndex], importance: d.importance, weight: d.importance }))
          .sort((a, b) => b.importance - a.importance);
      } else {
        continue;
      }
    } catch (modelErr) {
      if (isAbortError(modelErr)) throw modelErr;
      results.push({
        model: modelId,
        label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
        train: { r2: NaN, rmse: NaN, mae: NaN },
        test: { r2: NaN, rmse: NaN, mae: NaN },
        importance: [],
        note: modelErr?.message || String(modelErr),
        failed: true,
      });
      continue;
    }

    results.push({
      model: modelId,
      label: ABLATION_MODELS.find((m) => m.id === modelId)?.label || modelId,
      train: metrics(split.ytrain, trainPred),
      test: metrics(split.ytest, testPred),
      importance: importance.slice(0, 15),
      note,
    });
  }

  report('Done', { phase: 'done', pct: 100 });
  return {
    n: built.n,
    nTrain: split.ytrain.length,
    nTest: split.ytest.length,
    nFeaturesIn: built.featureNames.length,
    nFeaturesOut: pruned.featureNames.length,
    vifMax,
    vifDropped: [
      ...(screened.dropped || []),
      ...pruned.dropped.map((f) => ({ feature: f, vif: null })),
    ],
    vifKept: (screened.vifs || [])
      .filter((v) => pruned.featureNames.includes(v.feature))
      .sort((a, b) => (b.vif || 0) - (a.vif || 0)),
    featureMeans: Object.fromEntries(pruned.featureNames.map((n, i) => [n, means[i]])),
    featureSds: Object.fromEntries(pruned.featureNames.map((n, i) => [n, sds[i]])),
    results: [...results].sort((a, b) => {
      const br = Number.isFinite(b.test?.r2) ? b.test.r2 : -Infinity;
      const ar = Number.isFinite(a.test?.r2) ? a.test.r2 : -Infinity;
      return br - ar;
    }),
  };
}
