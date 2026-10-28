// Cross-validated logistic-regression decoding of behaviors, one behavior against the others. Port of the
// framework's `DecodeStates` with `classifier="logistic"`, `mode="one_vs_rest"` (miniscope/CaBaNA, branch
// framework-demo, commit 57c0c4b, `_metrics/_decode.py`), whose classifier is scikit-learn's
// `LogisticRegression` (L2 penalty, C = 1, `class_weight="balanced"`).
//
// The classifier is a TypeScript port of the same objective, not scikit-learn's solver (lbfgs). The
// objective is strictly convex, so it has one optimum, and this solver runs to a tight tolerance. scikit-learn
// stops at its default tolerance (1e-4), so the weights differ from its output by about that much (this solver: largest gradient component 1e-5 in the decoder, 1e-7 in the weight test) and a
// frame on the decision boundary can be classified differently; the test file states the agreement reached.
//
// Neural data is cells x frames of events summed per time bin (see `rebin` in decode-shared.ts); every cell
// is z-scored with the training fold's mean and s.d.

import { contiguousFolds } from './placecells.ts';

export interface LinearInput {
  /** One row per cell: cell * frames + frame. */
  neural: ArrayLike<number>;
  cells: number;
  frames: number;
  /** Sampling rate of the binned data, Hz. */
  fs: number;
  /** State of each frame (-1: none), exclusive. */
  labels: Int32Array;
  mask: Uint8Array;
  nStates: number;
}

export interface LinearParams {
  nFolds: number;
  /** Inverse regularisation strength. */
  C: number;
  /** A behavior needs this many frames, and so does everything else, to be decoded. */
  minFramesPerClass: number;
}

/** Gradient tolerance of the decoder's fits: weights are within about 1e-5 of the optimum, far tighter than scikit-learn's default 1e-4 stop. */
export const FIT_TOL = 1e-5;

export const DEFAULT_LINEAR: LinearParams = { nFolds: 5, C: 1, minFramesPerClass: 20 };

export interface LinearOut {
  /** Balanced accuracy per behavior (chance 0.5); NaN when it or its complement has too few frames or a training fold lacks a class. */
  values: Float64Array;
  /** Per behavior, [true, predicted] counts 2 x 2 with index 1 = in the behavior; NaN when not decoded. */
  confusion: Float64Array;
  /** Mean balanced accuracy over the decodable behaviors. */
  overall: number;
  nFrames: Int32Array;
}

export interface LogisticFit {
  w: Float64Array;
  b: number;
  iterations: number;
  /** Largest absolute gradient component at the end. */
  gradient: number;
}

/**
 * L2 logistic regression, `LogisticRegression(C, class_weight="balanced")`: minimizes
 * 0.5 |w|^2 + C * sum_i sw_i log(1 + exp(-y_i (x_i . w + b))), y in {-1, +1}, intercept not penalized,
 * `sw` = n / (2 n_class). `x` is n x d row-major. L-BFGS with a backtracking line search, run until the
 * largest gradient component is below `tol`.
 */
export function fitLogistic(x: Float64Array, y: Uint8Array, n: number, d: number, C: number, tol = 1e-7, maxIter = 2000): LogisticFit {
  const n1 = y.reduce((s, v) => s + v, 0);
  const sw = [n / (2 * (n - n1)), n / (2 * n1)];
  const dim = d + 1;
  const theta = new Float64Array(dim);
  const grad = new Float64Array(dim);

  /** Loss and gradient at `t`. */
  const evaluate = (t: Float64Array, g: Float64Array): number => {
    let loss = 0;
    for (let j = 0; j < d; j++) loss += 0.5 * t[j] * t[j];
    g.fill(0);
    for (let j = 0; j < d; j++) g[j] = t[j];
    for (let i = 0; i < n; i++) {
      let m = t[d];
      const row = i * d;
      for (let j = 0; j < d; j++) m += x[row + j] * t[j];
      const s = y[i] ? 1 : -1;
      const margin = s * m;
      const w = C * sw[y[i]];
      // log(1 + exp(-margin)) without overflow, and its derivative -s * sigmoid(-margin)
      loss += w * (margin > 0 ? Math.log1p(Math.exp(-margin)) : -margin + Math.log1p(Math.exp(margin)));
      const p = margin > 0 ? Math.exp(-margin) / (1 + Math.exp(-margin)) : 1 / (1 + Math.exp(margin));
      const r = -s * p * w;
      for (let j = 0; j < d; j++) g[j] += r * x[row + j];
      g[d] += r;
    }
    return loss;
  };

  const M = 12;
  const S: Float64Array[] = [];
  const Y: Float64Array[] = [];
  const rho: number[] = [];
  let f = evaluate(theta, grad);
  let iter = 0;
  const maxAbs = (g: Float64Array) => g.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const dot = (a: Float64Array, b: Float64Array) => a.reduce((s, v, i) => s + v * b[i], 0);
  const tNew = new Float64Array(dim);
  const gNew = new Float64Array(dim);
  for (; iter < maxIter && maxAbs(grad) > tol; iter++) {
    // two-loop recursion: direction = -H grad
    const q = Float64Array.from(grad);
    const alpha: number[] = [];
    for (let k = S.length - 1; k >= 0; k--) {
      alpha[k] = rho[k] * dot(S[k], q);
      for (let j = 0; j < dim; j++) q[j] -= alpha[k] * Y[k][j];
    }
    const gamma = S.length ? dot(S[S.length - 1], Y[S.length - 1]) / dot(Y[S.length - 1], Y[S.length - 1]) : 1 / Math.max(1, maxAbs(grad));
    for (let j = 0; j < dim; j++) q[j] *= gamma;
    for (let k = 0; k < S.length; k++) {
      const beta = rho[k] * dot(Y[k], q);
      for (let j = 0; j < dim; j++) q[j] += S[k][j] * (alpha[k] - beta);
    }
    const dir = q.map((v) => -v);
    let slope = dot(grad, dir);
    if (!(slope < 0)) {
      // not a descent direction (numerical): restart from steepest descent
      S.length = Y.length = rho.length = 0;
      for (let j = 0; j < dim; j++) dir[j] = -grad[j] / Math.max(1, maxAbs(grad));
      slope = dot(grad, dir);
    }
    let step = 1;
    let fNew = Infinity;
    for (let tries = 0; tries < 60; tries++) {
      for (let j = 0; j < dim; j++) tNew[j] = theta[j] + step * dir[j];
      fNew = evaluate(tNew, gNew);
      if (fNew <= f + 1e-4 * step * slope) break;
      step *= 0.5;
    }
    if (!(fNew <= f + 1e-4 * step * slope)) break; // no progress: at the optimum within rounding
    const s = Float64Array.from(tNew, (v, j) => v - theta[j]);
    const yv = Float64Array.from(gNew, (v, j) => v - grad[j]);
    const sy = dot(s, yv);
    if (sy > 1e-12 * dot(yv, yv)) {
      S.push(s);
      Y.push(yv);
      rho.push(1 / sy);
      if (S.length > M) {
        S.shift();
        Y.shift();
        rho.shift();
      }
    }
    theta.set(tNew);
    grad.set(gNew);
    f = fNew;
  }
  return { w: theta.slice(0, d), b: theta[d], iterations: iter, gradient: maxAbs(grad) };
}

/**
 * `DecodeStates._fit_predict` with `zscore=True` and balanced class weights: each cell standardized with the
 * training fold's mean and s.d. (a cell with s.d. at most 1e-12 is left unscaled), one logistic fit, and the
 * class predicted for every test frame. Rows are frames.
 */
export function fitPredict(xTrain: Float64Array, yTrain: Uint8Array, nTrain: number, xTest: Float64Array, nTest: number, d: number, C: number): Uint8Array {
  const mu = new Float64Array(d);
  const sd = new Float64Array(d);
  for (let i = 0; i < nTrain; i++) for (let j = 0; j < d; j++) mu[j] += xTrain[i * d + j];
  for (let j = 0; j < d; j++) mu[j] /= nTrain;
  for (let i = 0; i < nTrain; i++) for (let j = 0; j < d; j++) sd[j] += (xTrain[i * d + j] - mu[j]) ** 2;
  for (let j = 0; j < d; j++) {
    sd[j] = Math.sqrt(sd[j] / nTrain);
    if (!(sd[j] > 1e-12)) sd[j] = 1;
  }
  const xt = new Float64Array(nTrain * d);
  for (let i = 0; i < nTrain; i++) for (let j = 0; j < d; j++) xt[i * d + j] = (xTrain[i * d + j] - mu[j]) / sd[j];
  const fit = fitLogistic(xt, yTrain, nTrain, d, C, FIT_TOL);
  const out = new Uint8Array(nTest);
  for (let i = 0; i < nTest; i++) {
    let m = fit.b;
    for (let j = 0; j < d; j++) m += ((xTest[i * d + j] - mu[j]) / sd[j]) * fit.w[j];
    out[i] = m > 0 ? 1 : 0;
  }
  return out;
}

/** `_cv_predict`: out-of-fold predictions of a binary target, or undefined when a training fold lacks a class. */
export function cvPredict(x: Float64Array, y: Uint8Array, n: number, d: number, p: LinearParams): Uint8Array | undefined {
  const folds = contiguousFolds(n, p.nFolds);
  const pred = new Uint8Array(n);
  for (let f = 0; f < p.nFolds; f++) {
    const tr: number[] = [];
    const te: number[] = [];
    for (let i = 0; i < n; i++) (folds[i] === f ? te : tr).push(i);
    let ones = 0;
    for (const i of tr) ones += y[i];
    if (ones === 0 || ones === tr.length) return undefined;
    const gather = (idx: number[]) => {
      const m = new Float64Array(idx.length * d);
      idx.forEach((i, r) => m.set(x.subarray(i * d, (i + 1) * d), r * d));
      return m;
    };
    const out = fitPredict(gather(tr), Uint8Array.from(tr, (i) => y[i]), tr.length, gather(te), te.length, d, p.C);
    te.forEach((i, r) => {
      pred[i] = out[r];
    });
  }
  return pred;
}

/** `DecodeStates._run`, one-vs-rest: the cross-validated balanced accuracy of each behavior. */
export function decodeLinear(m: LinearInput, p: LinearParams, labels: Int32Array = m.labels): LinearOut {
  const idx: number[] = [];
  for (let t = 0; t < m.frames; t++) if (m.mask[t] && labels[t] >= 0) idx.push(t);
  const n = idx.length;
  const x = new Float64Array(n * m.cells); // frames x cells
  idx.forEach((t, i) => {
    for (let c = 0; c < m.cells; c++) x[i * m.cells + c] = m.neural[c * m.frames + t];
  });
  const nFrames = new Int32Array(m.nStates);
  for (const t of idx) nFrames[labels[t]]++;
  const values = new Float64Array(m.nStates).fill(NaN);
  const confusion = new Float64Array(m.nStates * 4).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let s = 0; s < m.nStates; s++) {
    if (nFrames[s] < p.minFramesPerClass || n - nFrames[s] < p.minFramesPerClass) continue;
    const y = Uint8Array.from(idx, (t) => (labels[t] === s ? 1 : 0));
    const pred = cvPredict(x, y, n, m.cells, p);
    if (!pred) continue;
    const c = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) c[y[i] * 2 + pred[i]]++;
    confusion.set(c, s * 4);
    values[s] = (c[0] / (c[0] + c[1]) + c[3] / (c[2] + c[3])) / 2;
    sum += values[s];
    count++;
  }
  return { values, confusion, overall: count ? sum / count : NaN, nFrames };
}
