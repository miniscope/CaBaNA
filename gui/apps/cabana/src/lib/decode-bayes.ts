// Cross-validated naive-Bayes decoding of one state per frame (a spatial bin, or a behavior) from the
// neural data of all cells together. Port of the framework's `BayesianDecoder` (miniscope/CaBaNA, branch
// framework-demo, commit 57c0c4b, `_metrics/_bayes.py`): the Gaussian decoder of Shuman, Aharoni, Cai et
// al. 2020 (Nat Neurosci 23:229-238) and the independent-Poisson decoder of Zhang et al. 1998. The
// empirical likelihood is not ported.
//
// Departure from the framework (GUI): the test window of a frame is clipped at its fold boundary, so
// no frame of another fold enters a test frame's input (`clipWindowToFold`; false gives the framework's
// window). Everything fitted (map means and s.d., smoothing, occupancy prior, sigma floors) already comes
// from the training folds only, as in the framework.
//
// Neural data is cells x frames. It is binarized as the framework does (NaN and zero become 0, anything
// above zero 1), so it should be the unsmoothed deconvolved events.

import { roundHalfEven } from './decode-shared.ts';
import { contiguousFolds, makeMapper } from './placecells.ts';

export interface BayesInput {
  /** One row per cell: cell * frames + frame. */
  neural: ArrayLike<number>;
  cells: number;
  frames: number;
  fs: number;
  /** State of each frame (-1: none). */
  labels: Int32Array;
  /** Frames that may be used (1) at all. */
  mask: Uint8Array;
  nStates: number;
  /** Grid shape [ny, nx] when the states are spatial bins (needed for map smoothing). */
  shape?: [number, number];
  /** Bin centres, `nStates` x 2 (x, y) in cm, for the error. Without them the states are categories and the value is recall. */
  centers?: Float64Array;
}

export interface BayesParams {
  likelihood: 'gaussian' | 'poisson';
  /** Gaussian only: one s.d. per cell and state, or one per cell. */
  sigma: 'per_state' | 'pooled';
  /** Width of the centred test window in seconds; 0 turns it off. */
  windowS: number;
  /** Gaussian smoothing of the training maps, in grid bins (grid states only). */
  smoothSigmaBins: number;
  nFolds: number;
  /** Gaussian only: training blocks standing in for trials. */
  nTrialBlocks: number;
  prior: 'occupancy' | 'uniform';
  /** States with fewer frames are dropped (not decoded, not evaluated). */
  minFramesPerClass: number;
  /** GUI departure: clip each test window at its fold boundary. */
  clipWindowToFold: boolean;
}

export const DEFAULT_BAYES: BayesParams = {
  likelihood: 'gaussian',
  sigma: 'per_state',
  windowS: 0.25,
  smoothSigmaBins: 0,
  nFolds: 5,
  nTrialBlocks: 10,
  prior: 'occupancy',
  minFramesPerClass: 20,
  clipWindowToFold: true,
};

export interface BayesOut {
  /** Per state: median error (cm, grid states) or recall (categories). NaN for dropped states. */
  values: Float64Array;
  /** nStates x nStates counts [true, decoded]; NaN rows and columns for dropped states. */
  confusion: Float64Array;
  /** Per frame: decoded state (-1 not decoded), error (NaN), error of always guessing the most occupied state, max posterior. */
  decoded: Int32Array;
  error: Float64Array;
  errGuess: Float64Array;
  confPost: Float64Array;
  /** Per state: used frames before dropping rare states, and whether it was kept. */
  nFrames: Int32Array;
  valid: Uint8Array;
  /** Over all decoded frames. */
  errorOverall: number;
  chanceError: number;
  accuracyOverall: number;
  meanConfidence: number;
  /** Fold of each used frame, in frame order, with the frames: lets the panels draw the folds. */
  usedFrames: Int32Array<ArrayBufferLike>;
  folds: Int32Array<ArrayBufferLike>;
}

/** numpy.median of a list (mean of the middle two when even). */
export function median(v: ArrayLike<number>): number {
  const a = Float64Array.from(v).sort();
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Odd window width in frames (`2 * round(window_s * fs / 2) + 1`), 1 when the window is off. */
export const windowFrames = (windowS: number, fs: number) =>
  windowS <= 0 ? 1 : 2 * roundHalfEven((windowS * fs) / 2) + 1;

/** What depends on the set of used frames but not on their labels: binarized events and test windows. */
export interface Features {
  /** Which frames were used, to tell whether the labels changed it. */
  usedKey: Uint8Array;
  idx: Int32Array;
  folds: Int32Array;
  /** Binarized events, frame-major: j * cells + c. */
  x: Uint8Array;
  /** Window sums over used frames and their number, per used frame. */
  sums: Float32Array;
  count: Float32Array;
}

export function buildFeatures(m: BayesInput, p: BayesParams, used: Uint8Array): Features {
  const idx: number[] = [];
  for (let t = 0; t < m.frames; t++) if (used[t]) idx.push(t);
  const n = idx.length;
  const folds = contiguousFolds(n, p.nFolds);
  const x = new Uint8Array(n * m.cells);
  for (let j = 0; j < n; j++)
    for (let c = 0; c < m.cells; c++) x[j * m.cells + c] = m.neural[c * m.frames + idx[j]] > 0 ? 1 : 0;
  const w = windowFrames(p.windowS, m.fs);
  const half = (w - 1) / 2;
  // Window over used frames within `half` frames of the centre, within the fold when clipped.
  const lo = new Int32Array(n);
  const hi = new Int32Array(n);
  let a = 0;
  let b = 0;
  for (let j = 0; j < n; j++) {
    while (idx[a] < idx[j] - half) a++;
    if (b < j) b = j;
    while (b < n && idx[b] <= idx[j] + half) b++;
    lo[j] = a;
    hi[j] = b;
  }
  if (p.clipWindowToFold) {
    const start = new Int32Array(p.nFolds).fill(n);
    const end = new Int32Array(p.nFolds);
    for (let j = 0; j < n; j++) {
      start[folds[j]] = Math.min(start[folds[j]], j);
      end[folds[j]] = j + 1;
    }
    for (let j = 0; j < n; j++) {
      lo[j] = Math.max(lo[j], start[folds[j]]);
      hi[j] = Math.min(hi[j], end[folds[j]]);
    }
  }
  const sums = new Float32Array(n * m.cells);
  const count = new Float32Array(n);
  const run = new Float64Array(m.cells); // running sum over the window [a, b), moved frame by frame
  let ra = 0;
  let rb = 0;
  for (let j = 0; j < n; j++) {
    while (rb < hi[j]) {
      for (let c = 0; c < m.cells; c++) run[c] += x[rb * m.cells + c];
      rb++;
    }
    while (ra < lo[j]) {
      for (let c = 0; c < m.cells; c++) run[c] -= x[ra * m.cells + c];
      ra++;
    }
    for (let c = 0; c < m.cells; c++) sums[j * m.cells + c] = run[c];
    count[j] = hi[j] - lo[j];
  }
  return { usedKey: used, idx: Int32Array.from(idx), folds, x, sums, count };
}

/** Per-block rate maps of the training frames: blocks x cells x states, NaN where a block never visited the state. */
function blockMaps(
  m: BayesInput,
  p: BayesParams,
  f: Features,
  lab: Int32Array,
  train: number[],
  nBlocks: number,
): { rates: Float64Array[]; occ: Float64Array } {
  const shape = m.shape ?? [1, m.nStates];
  const nTr = train.length;
  const rates: Float64Array[] = [];
  const total = new Float64Array(m.nStates);
  for (let bl = 0; bl < nBlocks; bl++) {
    const sums = new Float64Array(m.cells * m.nStates);
    const occ = new Float64Array(m.nStates);
    for (let i = 0; i < nTr; i++) {
      if (Math.floor((i * nBlocks) / nTr) !== bl) continue;
      const j = train[i];
      const s = lab[f.idx[j]];
      occ[s]++;
      for (let c = 0; c < m.cells; c++) if (f.x[j * m.cells + c]) sums[c * m.nStates + s]++;
    }
    // `rate_maps_from_sums` with fs = 1 and no minimum occupancy: valid where the state was visited.
    const mapper = makeMapper(occ, 1, 0, shape, p.smoothSigmaBins);
    const r = new Float64Array(m.cells * m.nStates);
    for (let c = 0; c < m.cells; c++) r.set(mapper.rate(sums.subarray(c * m.nStates, (c + 1) * m.nStates)), c * m.nStates);
    rates.push(r);
    for (let s = 0; s < m.nStates; s++) total[s] += occ[s];
  }
  return { rates, occ: total };
}

/** Maps over all training frames as one block (`_maps`): cells x states. */
function trainingMap(m: BayesInput, p: BayesParams, f: Features, lab: Int32Array, train: number[]): Float64Array {
  return blockMaps(m, p, f, lab, train, 1).rates[0];
}

/** `_loglik_gaussian`: log-likelihood (n_test x states) from the window means `S = sums / count` of the test frames. */
function logLikGaussian(
  m: BayesInput,
  p: BayesParams,
  f: Features,
  lab: Int32Array,
  train: number[],
  test: number[],
): Float64Array {
  const { cells, nStates } = m;
  const nTr = train.length;
  const nBlocks = Math.min(p.nTrialBlocks, nTr);
  const { rates } = blockMaps(m, p, f, lab, train, nBlocks);
  const mu = new Float64Array(cells * nStates);
  const sd = new Float64Array(cells * nStates);
  const cnt = new Float64Array(cells * nStates);
  for (let i = 0; i < cells * nStates; i++) {
    let n = 0;
    let s = 0;
    for (const r of rates) if (Number.isFinite(r[i])) {
        n++;
        s += r[i];
      }
    cnt[i] = n;
    if (!n) continue;
    const mean = s / n;
    let ss = 0;
    for (const r of rates) if (Number.isFinite(r[i])) ss += (r[i] - mean) ** 2;
    mu[i] = mean;
    sd[i] = Math.sqrt(ss / n);
  }
  const lin = new Float64Array(nStates * cells); // state-major so the frame loop runs over cells
  const quad = new Float64Array(nStates * cells);
  const konst = new Float64Array(nStates);
  for (let c = 0; c < cells; c++) {
    let maxMu = 0;
    let n2 = 0;
    let sumSd = 0;
    let wts = 0;
    let wVar = 0;
    for (let s = 0; s < nStates; s++) {
      const i = c * nStates + s;
      maxMu = Math.max(maxMu, Math.abs(mu[i]));
      if (cnt[i] >= 2) {
        n2++;
        sumSd += sd[i];
        wts += cnt[i];
        wVar += cnt[i] * sd[i] ** 2;
      }
    }
    const tiny = Math.max(1e-3 * maxMu, 1e-9);
    const floor = Math.max(n2 > 0 ? sumSd / n2 : 0, tiny);
    const pooled = Math.max(Math.sqrt(wVar / Math.max(wts, 1)), tiny);
    for (let s = 0; s < nStates; s++) {
      const i = c * nStates + s;
      const sigma =
        p.sigma === 'pooled' ? pooled : cnt[i] >= 2 ? Math.max(sd[i], floor) : floor;
      const a = 1 / (2 * sigma * sigma);
      lin[s * cells + c] = 2 * a * mu[i];
      quad[s * cells + c] = a;
      konst[s] -= mu[i] * mu[i] * a + Math.log(sigma);
    }
  }
  const out = new Float64Array(test.length * nStates);
  const feat = new Float64Array(cells);
  test.forEach((j, r) => {
    const inv = f.count[j] > 0 ? 1 / f.count[j] : 0;
    for (let c = 0; c < cells; c++) feat[c] = f.sums[j * cells + c] * inv;
    for (let s = 0; s < nStates; s++) {
      let v = konst[s];
      const o = s * cells;
      for (let c = 0; c < cells; c++) v += feat[c] * lin[o + c] - feat[c] * feat[c] * quad[o + c];
      out[r * nStates + s] = v;
    }
  });
  return out;
}

/** `_loglik_poisson`, up to a constant per frame: window sums times log(rate) minus window frames times summed rate. */
function logLikPoisson(
  m: BayesInput,
  p: BayesParams,
  f: Features,
  lab: Int32Array,
  train: number[],
  test: number[],
): Float64Array {
  const { cells, nStates } = m;
  const mu = trainingMap(m, p, f, lab, train).map((v) => (Number.isFinite(v) ? v : 0));
  const mean = mu.reduce((s, v) => s + v, 0) / mu.length;
  const add = 1e-4 * Math.max(mean, 1e-6);
  const logMu = new Float64Array(nStates * cells);
  const total = new Float64Array(nStates);
  for (let c = 0; c < cells; c++)
    for (let s = 0; s < nStates; s++) {
      const v = mu[c * nStates + s] + add;
      logMu[s * cells + c] = Math.log(v);
      total[s] += v;
    }
  const out = new Float64Array(test.length * nStates);
  test.forEach((j, r) => {
    for (let s = 0; s < nStates; s++) {
      let v = -f.count[j] * total[s];
      for (let c = 0; c < cells; c++) v += f.sums[j * cells + c] * logMu[s * cells + c];
      out[r * nStates + s] = v;
    }
  });
  return out;
}

/**
 * A decoder for one input: builds the features once and runs for any labels, as the shuffle test needs.
 * `run` is `BayesianDecoder._run` (values, confusion, decoded state, error and the extras).
 */
export function makeBayesDecoder(m: BayesInput, p: BayesParams) {
  let cached: Features | undefined;
  const sameUsed = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);

  return function run(labels: Int32Array = m.labels): BayesOut {
    const { nStates, frames } = m;
    const nFrames = new Int32Array(nStates);
    for (let t = 0; t < frames; t++) if (m.mask[t] && labels[t] >= 0) nFrames[labels[t]]++;
    const valid = new Uint8Array(nStates);
    for (let s = 0; s < nStates; s++) valid[s] = nFrames[s] >= p.minFramesPerClass ? 1 : 0;
    const used = new Uint8Array(frames);
    for (let t = 0; t < frames; t++) used[t] = m.mask[t] && labels[t] >= 0 && valid[labels[t]] ? 1 : 0;
    const nUsed = used.reduce((s, v) => s + v, 0);
    const nValid = valid.reduce((s, v) => s + v, 0);

    const decoded = new Int32Array(frames).fill(-1);
    const guess = new Int32Array(frames).fill(-1);
    const confPost = new Float64Array(frames).fill(NaN);
    let usedFrames: Int32Array<ArrayBufferLike> = new Int32Array(0);
    let foldOf: Int32Array<ArrayBufferLike> = new Int32Array(0);
    if (nValid >= 2 && nUsed >= p.nFolds) {
      if (!cached || !sameUsed(cached.usedKey, used)) cached = buildFeatures(m, p, used);
      const f = cached;
      usedFrames = f.idx;
      foldOf = f.folds;
      for (let fold = 0; fold < p.nFolds; fold++) {
        const train: number[] = [];
        const test: number[] = [];
        for (let j = 0; j < nUsed; j++) (f.folds[j] === fold ? test : train).push(j);
        const occ = new Float64Array(nStates);
        for (const j of train) occ[labels[f.idx[j]]]++;
        const cand = occ.map((v) => (v > 0 ? 1 : 0));
        if (!cand.some((v) => v)) continue;
        const ll =
          p.likelihood === 'gaussian'
            ? logLikGaussian(m, p, f, labels, train, test)
            : logLikPoisson(m, p, f, labels, train, test);
        const logPrior = new Float64Array(nStates);
        const occSum = occ.reduce((s, v) => s + v, 0);
        // A uniform prior is flat (zero) over the states seen in training.
        if (p.prior === 'occupancy')
          for (let s = 0; s < nStates; s++) if (cand[s]) logPrior[s] = Math.log(occ[s] / occSum);
        let guessState = 0;
        for (let s = 1; s < nStates; s++) if (occ[s] > occ[guessState]) guessState = s;
        test.forEach((j, r) => {
          let best = -1;
          let bestV = -Infinity;
          for (let s = 0; s < nStates; s++) {
            if (!cand[s]) continue;
            const v = ll[r * nStates + s] + logPrior[s];
            if (v > bestV) {
              bestV = v;
              best = s;
            }
          }
          let z = 0;
          for (let s = 0; s < nStates; s++) if (cand[s]) z += Math.exp(ll[r * nStates + s] + logPrior[s] - bestV);
          const t = f.idx[j];
          decoded[t] = best;
          confPost[t] = 1 / z;
          guess[t] = guessState;
        });
      }
    }
    return summarize(m, labels, valid, nFrames, decoded, guess, confPost, usedFrames, foldOf);
  };
}

/** The values, confusion matrix and overall numbers from the decoded state of every frame. */
function summarize(
  m: BayesInput,
  lab: Int32Array,
  valid: Uint8Array,
  nFrames: Int32Array,
  decoded: Int32Array,
  guess: Int32Array,
  confPost: Float64Array,
  usedFrames: Int32Array<ArrayBufferLike>,
  folds: Int32Array<ArrayBufferLike>,
): BayesOut {
  const { nStates, frames } = m;
  const conf = new Float64Array(nStates * nStates).fill(NaN);
  const c = new Float64Array(nStates * nStates);
  const error = new Float64Array(frames).fill(NaN);
  const errGuess = new Float64Array(frames).fill(NaN);
  const byState: number[][] = Array.from({ length: nStates }, () => []);
  let correct = 0;
  let nDec = 0;
  let post = 0;
  const dist = (a: number, b: number) =>
    Math.hypot(m.centers![2 * a] - m.centers![2 * b], m.centers![2 * a + 1] - m.centers![2 * b + 1]);
  for (let t = 0; t < frames; t++) {
    if (decoded[t] < 0) continue;
    nDec++;
    c[lab[t] * nStates + decoded[t]]++;
    if (decoded[t] === lab[t]) correct++;
    post += confPost[t];
    if (m.centers) {
      error[t] = dist(decoded[t], lab[t]);
      errGuess[t] = dist(guess[t], lab[t]);
      byState[lab[t]].push(error[t]);
    }
  }
  const values = new Float64Array(nStates).fill(NaN);
  for (let s = 0; s < nStates; s++) {
    if (!valid[s]) continue;
    for (let d = 0; d < nStates; d++) if (valid[d]) conf[s * nStates + d] = c[s * nStates + d];
    if (m.centers) values[s] = median(byState[s]);
    else {
      let row = 0;
      for (let d = 0; d < nStates; d++) if (valid[d]) row += c[s * nStates + d];
      values[s] = row > 0 ? c[s * nStates + s] / row : NaN;
    }
  }
  const finite = (a: Float64Array) => a.filter((v) => Number.isFinite(v));
  return {
    values,
    confusion: conf,
    decoded,
    error,
    errGuess,
    confPost,
    nFrames,
    valid,
    errorOverall: m.centers && nDec ? median(finite(error)) : NaN,
    chanceError: m.centers && nDec ? median(finite(errGuess)) : NaN,
    accuracyOverall: nDec ? correct / nDec : NaN,
    meanConfidence: nDec ? post / nDec : NaN,
    usedFrames,
    folds,
  };
}
