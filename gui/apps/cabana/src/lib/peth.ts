// Peri-event time histogram (PETH) analysis, following the CaBaNA framework (miniscope/CaBaNA,
// branch framework-demo, commit 57c0c4b): `_metrics/_events.py` (`PETH`, `bouts`, `event_onsets`),
// the circular-shift test of `_shuffle.py` and scipy's `wilcoxon` (1.18.1). In the GUI a
// behavior start is called an onset; "event" means only a deconvolved event.
//
// Everything takes plain typed arrays and returns typed arrays, so it runs in a worker.

import { pTwoSided, maxStatAdjust, type AurocInput, type Response } from './auroc.ts';

/** Same shape as the auROC input (so the shift-length choice of `selectAurocMinShift` takes it). */
export type PethInput = AurocInput;

export interface PethParams {
  preS: number;
  postS: number;
  /** Baseline and response intervals in seconds from the onset, half-open. */
  baselineS: [number, number];
  responseS: [number, number];
  /** Bin width of the curves; null keeps one bin per frame. Does not change the tested statistic. */
  binS: number | null;
  minDurationS: number;
  minGapS: number;
  minEvents: number;
  /** Subtract each onset's baseline mean in the curves (the tested statistic always does). */
  baselineSubtract: boolean;
}

/** The values the framework demo uses. */
export const DEFAULT_PETH_PARAMS: PethParams = {
  preS: 4,
  postS: 4,
  baselineS: [-4, -1],
  responseS: [0, 1.5],
  binS: 0.1,
  minDurationS: 1.5,
  minGapS: 1.0,
  minEvents: 3,
  baselineSubtract: true,
};

/** Fewer non-zero response-minus-baseline differences than this give no pre/post p-value. */
export const MIN_NONZERO_PREPOST = 6;

export interface PethGeometry {
  pre: number;
  post: number;
  /** Half-open frame offsets from the onset. */
  base: [number, number];
  resp: [number, number];
}

/** Python's `round`: halves go to the even integer (`Math.round` sends them up). */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

/** `_frames`: half-open frame offsets of a window in seconds. */
function windowFrames(w: [number, number], fs: number): [number, number] {
  const lo = pyRound(w[0] * fs);
  const hi = pyRound(w[1] * fs);
  if (hi <= lo) throw new Error(`window (${w[0]}, ${w[1]}) spans no frames at fs=${fs}`);
  return [lo, hi];
}

/** `PETH._geometry`: frame offsets of the window and the two intervals, with the framework's errors. */
export function pethGeometry(p: PethParams, fs: number): PethGeometry {
  const pre = pyRound(p.preS * fs);
  const post = pyRound(p.postS * fs);
  const base = windowFrames(p.baselineS, fs);
  const resp = windowFrames(p.responseS, fs);
  for (const [lo, hi] of [base, resp])
    if (lo < -pre || hi > post)
      throw new Error('baseline_s and response_s must lie within [-pre_s, post_s]');
  return { pre, post, base, resp };
}

/**
 * Problems with the window settings in plain words, for the setup page; empty when valid.
 * GUI only: the framework checks the same things (pydantic bounds and `_geometry`) and raises.
 */
export function windowProblems(p: PethParams, fs: number): string[] {
  const out: string[] = [];
  if (!(p.preS >= 0)) out.push('Time before the onset cannot be negative.');
  if (!(p.postS > 0)) out.push('Time after the onset must be greater than 0.');
  if (p.binS !== null && !(p.binS > 0)) out.push('Bin size must be greater than 0.');
  if (!(p.minDurationS >= 0)) out.push('Minimum behavior duration cannot be negative.');
  if (!(p.minGapS >= 0)) out.push('Minimum gap cannot be negative.');
  if (!(p.minEvents >= 1)) out.push('Minimum number of onsets must be at least 1.');
  const pre = pyRound(p.preS * fs);
  const post = pyRound(p.postS * fs);
  for (const [name, w] of [
    ['Baseline', p.baselineS],
    ['Response', p.responseS],
  ] as const) {
    const lo = pyRound(w[0] * fs);
    const hi = pyRound(w[1] * fs);
    if (!(hi > lo)) out.push(`${name} interval must span at least one frame at ${fs} Hz.`);
    else if (lo < -pre || hi > post)
      out.push(`${name} interval must lie within the window, from -${p.preS} s to ${p.postS} s.`);
  }
  return out;
}

const behaviorRow = (m: PethInput, b: number) =>
  m.behaviors.subarray(b * m.frames, (b + 1) * m.frames);

/** `runs` (and `bouts` for one behavior): first frame and length of each run of 1s. */
export function bouts(row: ArrayLike<number>): { onsets: Int32Array; lengths: Int32Array } {
  const onsets: number[] = [];
  const lengths: number[] = [];
  for (let t = 0; t < row.length; t++) {
    if (!row[t]) continue;
    if (t === 0 || !row[t - 1]) {
      onsets.push(t);
      lengths.push(0);
    }
    lengths[lengths.length - 1]++;
  }
  return { onsets: Int32Array.from(onsets), lengths: Int32Array.from(lengths) };
}

export interface OnsetReport {
  /** All bouts of the behavior. */
  bouts: number;
  /** Valid onsets: `PETH.valid_onsets`. */
  onsets: Int32Array;
  /** Excluded bouts, each counted once under the first reason that applies. */
  short: number;
  gap: number;
  outside: number;
  edge: number;
}

/**
 * `PETH.valid_onsets` per behavior (`event_onsets`, then the windows that fit in the session),
 * plus how many bouts each rule removed. The counts are GUI only: the framework just filters.
 * A bout is counted once under the first of: shorter than the minimum duration; too close to the
 * end of the previous bout of the same behavior (that bout counts even if it was excluded; the
 * first bout has no predecessor; skipped when the minimum gap is 0); onset frame outside the
 * mask; window not inside the session. Same 1e-9 s tolerance as the framework.
 */
export function onsetReport(m: PethInput, p: PethParams): OnsetReport[] {
  const { pre, post } = pethGeometry(p, m.fs);
  return Array.from({ length: m.nBehaviors }, (_, b) => {
    const { onsets, lengths } = bouts(behaviorRow(m, b));
    const kept: number[] = [];
    const r = { short: 0, gap: 0, outside: 0, edge: 0 };
    onsets.forEach((o, i) => {
      if (lengths[i] / m.fs < p.minDurationS - 1e-9) r.short++;
      else if (
        p.minGapS > 0 &&
        i > 0 &&
        (o - (onsets[i - 1] + lengths[i - 1])) / m.fs < p.minGapS - 1e-9
      )
        r.gap++;
      else if (!m.mask[o]) r.outside++;
      else if (o - pre < 0 || o + post > m.frames) r.edge++;
      else kept.push(o);
    });
    return { bouts: onsets.length, onsets: Int32Array.from(kept), ...r };
  });
}

/** The frames that carry weight for one behavior, and the weights (response +, baseline -). */
interface Weights {
  idx: Int32Array;
  w: Float64Array;
}

/**
 * `PETH._weights` for one behavior: mean response minus mean baseline over its onsets, as weights
 * on frames (windows that overlap add up). null when there are fewer than `minEvents` onsets.
 * Sparse here, where the framework keeps one dense column per behavior.
 */
function onsetWeights(onsets: Int32Array, p: PethParams, g: PethGeometry, n: number): Weights | null {
  if (onsets.length < p.minEvents) return null;
  const dense = new Float64Array(n);
  const hit: number[] = [];
  for (const [[lo, hi], sign] of [
    [g.resp, 1],
    [g.base, -1],
  ] as const) {
    const each = sign / (onsets.length * (hi - lo));
    for (const o of onsets)
      for (let t = o + lo; t < o + hi; t++) {
        if (dense[t] === 0) hit.push(t);
        dense[t] += each;
      }
  }
  const idx = Int32Array.from(new Set(hit));
  return { idx, w: Float64Array.from(idx, (t) => dense[t]) };
}

/** True when the cell has a non-finite value anywhere. The framework's product with the weight
 *  matrix turns it into NaN for every behavior (NaN * 0 = NaN), even outside all windows. */
const hasBad = (x: ArrayLike<number>) => {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return true;
  return false;
};

const row = (m: PethInput, c: number) => m.neural.subarray(c * m.frames, (c + 1) * m.frames);

/**
 * `PETH.compute`: per cell and behavior, the mean over onsets of (mean neural in the response
 * interval - mean in the baseline interval), cells x behaviors (cell * nBehaviors + behavior).
 * NaN for a behavior with fewer than `minEvents` onsets and, as in the framework, for every
 * behavior of a cell with a non-finite neural value anywhere in the session.
 */
export function observedPeth(m: PethInput, onsets: Int32Array[], p: PethParams): Float64Array {
  const nb = m.nBehaviors;
  const g = pethGeometry(p, m.fs);
  const weights = onsets.map((o) => onsetWeights(o, p, g, m.frames));
  const out = new Float64Array(m.cells * nb).fill(NaN);
  for (let c = 0; c < m.cells; c++) {
    const x = row(m, c);
    if (hasBad(x)) continue;
    weights.forEach((wt, b) => {
      if (!wt) return;
      let s = 0;
      for (let j = 0; j < wt.idx.length; j++) s += x[wt.idx[j]] * wt.w[j];
      out[c * nb + b] = s;
    });
  }
  return out;
}

/**
 * `PETH.compute_shifted` for one cell: the statistic for each circular shift, shifts x behaviors
 * (shift * nBehaviors + behavior), with `roll(x, k)[t] = x[(t - k) mod n]`, onsets fixed. The
 * statistic is a weighted sum over a few frames, so each shift only reads those frames (the
 * framework rolls the whole weight matrix). Shifts may be negative or longer than the session.
 */
export function shiftedPethCell(
  m: PethInput,
  c: number,
  onsets: Int32Array[],
  p: PethParams,
  shifts: ArrayLike<number>,
): Float64Array {
  const { frames: n, nBehaviors: nb } = m;
  const g = pethGeometry(p, m.fs);
  const x = row(m, c);
  const out = new Float64Array(shifts.length * nb).fill(NaN);
  if (hasBad(x)) return out;
  onsets.forEach((o, b) => {
    const wt = onsetWeights(o, p, g, n);
    if (!wt) return;
    for (let i = 0; i < shifts.length; i++) {
      const k = shifts[i];
      let s = 0;
      for (let j = 0; j < wt.idx.length; j++) s += x[(((wt.idx[j] - k) % n) + n) % n] * wt.w[j];
      out[i * nb + b] = s;
    }
  });
  return out;
}

// ---- Wilcoxon signed-rank test (scipy 1.18.1, zero_method='wilcox', method='auto') -------------

/** erfc for x >= 0, to about 1e-15: series of erf for small x, continued fraction for large x. */
function erfc(x: number): number {
  if (x < 2) {
    let term = x;
    let sum = x;
    for (let k = 1; k < 200 && term > 1e-18 * sum; k++) {
      term *= (2 * x * x) / (2 * k + 1);
      sum += term;
    }
    return 1 - ((2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum);
  }
  let t = x;
  for (let k = 300; k >= 1; k--) t = x + k / 2 / t;
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * t);
}

/** Ways to reach each sum with a subset of `values` (integers >= 1): subset-sum counts. */
function subsetSumCounts(values: number[]): Float64Array {
  const counts = new Float64Array(values.reduce((a, b) => a + b, 0) + 1);
  counts[0] = 1;
  let top = 0;
  for (const v of values) {
    for (let s = top; s >= 0; s--) counts[s + v] += counts[s];
    top += v;
  }
  return counts;
}

/**
 * scipy's `wilcoxon(d, zero_method='wilcox')` two-sided p-value (correction=False, the default of
 * the public function). Zeros are dropped; ranks are of |d| with ties averaged; the statistic is
 * the rank sum of the positive differences. `method='auto'` then picks, with n the length of `d`
 * including zeros:
 *  - n <= 50 and no zeros and no tied |d|: exact distribution, p = 2 min(sf(floor W), cdf(ceil W)), at most 1;
 *  - otherwise n <= 13: all 2^n sign patterns (scipy's deterministic permutation test),
 *    p = 2 min(share of patterns with W' <= W, share with W' >= W), at most 1;
 *  - otherwise (n > 50, or n > 13 with zeros or ties): normal approximation without continuity
 *    correction, z = (W - m(m+1)/4) / se with m the non-zero count and the tie-corrected
 *    se = sqrt((m(m+1)(2m+1) - sum(t^3 - t)/2) / 24), p = 2 P(Z > |z|).
 * NaN if any value is NaN or all are zero. The framework's rule of at least 6 non-zero
 * differences is not applied here (see `MIN_NONZERO_PREPOST`).
 */
export function wilcoxonSignedRank(d: ArrayLike<number>): number {
  const n = d.length;
  const nz: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(d[i])) return NaN;
    if (d[i] !== 0) nz.push(d[i]);
  }
  const m = nz.length;
  if (m === 0) return NaN;
  // average ranks of |d| among the non-zero values, in half-steps (2 * rank is an integer)
  const order = nz.map((_, i) => i).sort((a, b) => Math.abs(nz[a]) - Math.abs(nz[b]));
  const rank2 = new Array<number>(m);
  let tieTerm = 0;
  for (let i = 0; i < m; ) {
    let j = i;
    while (j + 1 < m && Math.abs(nz[order[j + 1]]) === Math.abs(nz[order[i]])) j++;
    for (let k = i; k <= j; k++) rank2[order[k]] = i + j + 2; // 2 * mean of ranks i+1 .. j+1
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  let w2 = 0;
  nz.forEach((v, i) => {
    if (v > 0) w2 += rank2[i];
  });
  const ties = tieTerm > 0;

  if (n <= 50 && !ties && m === n) {
    // exact: counts of rank sums 0 .. m(m+1)/2, each of 2^m patterns equally likely
    const counts = subsetSumCounts(Array.from({ length: m }, (_, i) => i + 1));
    const pmf = counts.map((c) => c / 2 ** m);
    const mean = (m * (m + 1)) / 4;
    const sumFrom = (a: number) => pmf.subarray(Math.max(a, 0)).reduce((s, v) => s + v, 0);
    const sumTo = (a: number) => pmf.subarray(0, Math.max(a + 1, 0)).reduce((s, v) => s + v, 0);
    const cdf = (k: number): number => (k <= mean ? sumTo(k) : 1 - sumFrom(k + 1));
    const sf = (k: number): number => (k <= mean ? sumFrom(k) : 1 - sumTo(k - 1));
    const w = w2 / 2;
    return Math.min(1, 2 * Math.min(sf(Math.floor(w)), cdf(Math.ceil(w))));
  }
  if (n <= 13) {
    // all sign patterns; the 2^(n-m) patterns of the zeros only repeat each count
    const counts = subsetSumCounts(rank2);
    let le = 0;
    let ge = 0;
    counts.forEach((c, s) => {
      if (s <= w2) le += c;
      if (s >= w2) ge += c;
    });
    return Math.min(1, (2 * Math.min(le, ge)) / 2 ** m);
  }
  const se = Math.sqrt((m * (m + 1) * (2 * m + 1) - tieTerm / 2) / 24);
  const z = (w2 / 2 - (m * (m + 1)) / 4) / se;
  return erfc(Math.abs(z) / Math.SQRT2);
}

// ---- Curves ---------------------------------------------------------------------------------

export interface PethCurves {
  /** cells x behaviors x bins: (cell * nBehaviors + behavior) * bins + bin */
  peth: Float64Array;
  sem: Float64Array;
  bins: number;
  /** Bin centres in seconds from the onset. */
  timeS: Float64Array;
  /** Valid onsets per behavior, whether or not there are enough of them. */
  nEvents: Int32Array;
  /** Wilcoxon p of response against baseline across onsets, cells x behaviors. */
  pPrePost: Float64Array;
}

/** Frames per bin and number of bins of the curves (`PETH.extras`). */
function binning(p: PethParams, g: PethGeometry, fs: number) {
  const size = p.binS === null ? 1 : Math.max(1, pyRound(p.binS * fs));
  return { size, bins: Math.floor((g.pre + g.post) / size) };
}

/**
 * `PETH.extras` without the null band: the mean curve (`peth`) and its standard error (`sem`,
 * ddof 1, NaN for a single onset) over the onsets of each behavior, binned along time, and the
 * pre/post p-value. Windows are not masked. NaN for a behavior below `minEvents`. A non-finite
 * value only spoils the onsets, bins and p-values whose windows contain it (unlike `observedPeth`).
 * The p-value is NaN with fewer than `MIN_NONZERO_PREPOST` non-zero differences (NaN counts as non-zero).
 */
export function pethCurves(m: PethInput, onsets: Int32Array[], p: PethParams): PethCurves {
  const { cells, nBehaviors: nb } = m;
  const g = pethGeometry(p, m.fs);
  const { size, bins } = binning(p, g, m.fs);
  const len = g.pre + g.post;
  const peth = new Float64Array(cells * nb * bins).fill(NaN);
  const sem = new Float64Array(cells * nb * bins).fill(NaN);
  const pPrePost = new Float64Array(cells * nb).fill(NaN);
  const timeS = Float64Array.from({ length: bins }, (_, i) => {
    let s = 0;
    for (let j = 0; j < size; j++) s += -g.pre + i * size + j;
    return s / size / m.fs;
  });
  const nEvents = Int32Array.from(onsets, (o) => o.length);
  const meanOf = (w: Float64Array, a: number, b: number) => {
    let s = 0;
    for (let j = a; j < b; j++) s += w[j];
    return s / (b - a);
  };
  onsets.forEach((os, b) => {
    const ne = os.length;
    if (ne < p.minEvents) return;
    for (let c = 0; c < cells; c++) {
      const x = row(m, c);
      const binned = new Float64Array(ne * bins);
      const diff = new Float64Array(ne);
      const win = new Float64Array(len);
      os.forEach((o, e) => {
        for (let j = 0; j < len; j++) win[j] = x[o - g.pre + j];
        const base = meanOf(win, g.base[0] + g.pre, g.base[1] + g.pre);
        diff[e] = meanOf(win, g.resp[0] + g.pre, g.resp[1] + g.pre) - base;
        const shift = p.baselineSubtract ? base : 0;
        for (let i = 0; i < bins; i++) {
          let s = 0;
          for (let j = i * size; j < (i + 1) * size; j++) s += win[j] - shift;
          binned[e * bins + i] = s / size;
        }
      });
      const at = (c * nb + b) * bins;
      for (let i = 0; i < bins; i++) {
        let mean = 0;
        for (let e = 0; e < ne; e++) mean += binned[e * bins + i];
        mean /= ne;
        peth[at + i] = mean;
        if (ne > 1) {
          let ss = 0;
          for (let e = 0; e < ne; e++) ss += (binned[e * bins + i] - mean) ** 2;
          sem[at + i] = Math.sqrt(ss / (ne - 1)) / Math.sqrt(ne);
        }
      }
      let nonzero = 0;
      for (const v of diff) if (v !== 0) nonzero++;
      if (nonzero >= MIN_NONZERO_PREPOST) pPrePost[c * nb + b] = wilcoxonSignedRank(diff);
    }
  });
  return { peth, sem, bins, timeS, nEvents, pPrePost };
}

export interface PethBand {
  /** cells x behaviors x bins: 2.5th and 97.5th percentile and mean of the shifted curves. */
  lo: Float64Array;
  hi: Float64Array;
  mean: Float64Array;
  /** First bin time >= 0 where the curve is outside the band for `minLatencyBins` bins in a row; NaN if never. */
  latencyS: Float64Array;
}

/** numpy `percentile` with linear interpolation of an ascending array (NaN if any value is NaN). */
function percentile(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * (q / 100);
  const lo = Math.floor(pos);
  const t = pos - lo;
  const a = sorted[lo];
  const b = sorted[Math.min(lo + 1, sorted.length - 1)];
  return t >= 0.5 ? b - (b - a) * (1 - t) : a + (b - a) * t;
}

/**
 * `PETH._band` for the given shifts (the framework draws them with `draw_shifts` from
 * `default_rng(null_seed)`; the same shifts serve every cell and behavior): per bin, the
 * 2.5 / 97.5 percentiles and mean of the curve after rolling the neural data, onsets fixed, and
 * the response latency. The curve is the mean over onsets first (the same as per onset, since
 * it is linear). Pass the observed `curves` if they are already computed.
 */
export function pethNullBand(
  m: PethInput,
  onsets: Int32Array[],
  p: PethParams,
  shifts: ArrayLike<number>,
  minLatencyBins: number,
  curves: PethCurves = pethCurves(m, onsets, p),
): PethBand {
  const { cells, nBehaviors: nb, frames: n } = m;
  const g = pethGeometry(p, m.fs);
  const { size, bins } = binning(p, g, m.fs);
  const len = g.pre + g.post;
  const total = cells * nb * bins;
  const lo = new Float64Array(total).fill(NaN);
  const hi = new Float64Array(total).fill(NaN);
  const mean = new Float64Array(total).fill(NaN);
  const ns = shifts.length;
  onsets.forEach((os, b) => {
    const ne = os.length;
    if (ne < p.minEvents) return;
    for (let c = 0; c < cells; c++) {
      const x = row(m, c);
      const draws = new Float64Array(bins * ns); // bin * ns + shift
      const win = new Float64Array(len);
      for (let i = 0; i < ns; i++) {
        const k = shifts[i];
        win.fill(0);
        for (const o of os)
          for (let j = 0; j < len; j++) win[j] += x[(((o - g.pre + j - k) % n) + n) % n];
        for (let j = 0; j < len; j++) win[j] /= ne;
        let shift = 0;
        if (p.baselineSubtract) {
          for (let j = g.base[0] + g.pre; j < g.base[1] + g.pre; j++) shift += win[j];
          shift /= g.base[1] - g.base[0];
        }
        for (let q = 0; q < bins; q++) {
          let s = 0;
          for (let j = q * size; j < (q + 1) * size; j++) s += win[j] - shift;
          draws[q * ns + i] = s / size;
        }
      }
      for (let q = 0; q < bins; q++) {
        const col = draws.subarray(q * ns, (q + 1) * ns);
        const at = (c * nb + b) * bins + q;
        let sum = 0;
        for (const v of col) sum += v;
        mean[at] = sum / ns;
        if (hasBad(col)) continue; // np.percentile gives NaN
        const sorted = Float64Array.from(col).sort();
        lo[at] = percentile(sorted, 2.5);
        hi[at] = percentile(sorted, 97.5);
      }
    }
  });
  // latency: first bin at time >= 0 that starts a run of `minLatencyBins` bins outside the band
  const latencyS = new Float64Array(cells * nb).fill(NaN);
  for (let r = 0; r < cells * nb; r++) {
    const outside = (q: number) => {
      const i = r * bins + q;
      const v = curves.peth[i];
      return (
        Number.isFinite(v) && Number.isFinite(lo[i]) && curves.timeS[q] >= 0 && (v < lo[i] || v > hi[i])
      );
    };
    for (let q = 0; q + minLatencyBins <= bins; q++) {
      let all = true;
      for (let j = 0; j < minLatencyBins && all; j++) all = outside(q + j);
      if (all) {
        latencyS[r] = curves.timeS[q];
        break;
      }
    }
  }
  return { lo, hi, mean, latencyS };
}

// ---- Test, p-values and labels --------------------------------------------------------------

export interface PethResult {
  /** cells x behaviors (cell * nBehaviors + behavior) */
  observed: Float64Array;
  /** Two-sided p-value from the shifted data. */
  pRaw: Float64Array;
  /** Max-stat adjusted p-value across the behaviors of each cell (equal to `pRaw` with no correction). */
  pAdj: Float64Array;
}

/** `shuffle_test` for the PETH metric on the given shifts: observed values, p-values and the correction. */
export function analyzePeth(
  m: PethInput,
  onsets: Int32Array[],
  p: PethParams,
  shifts: ArrayLike<number>,
  correction: 'none' | 'max_stat',
  onCell?: (done: number) => void,
): PethResult {
  const nb = m.nBehaviors;
  const observed = observedPeth(m, onsets, p);
  const pRaw = new Float64Array(observed.length);
  const pAdj = new Float64Array(observed.length);
  for (let c = 0; c < m.cells; c++) {
    const draws = shiftedPethCell(m, c, onsets, p, shifts);
    const column = (b: number) => Float64Array.from({ length: shifts.length }, (_, i) => draws[i * nb + b]);
    for (let b = 0; b < nb; b++) pRaw[c * nb + b] = pTwoSided(observed[c * nb + b], column(b));
    const sl = (a: Float64Array) => a.subarray(c * nb, (c + 1) * nb);
    pAdj.set(
      correction === 'max_stat' && nb > 1 ? maxStatAdjust(sl(observed), draws, sl(pRaw)) : sl(pRaw),
      c * nb,
    );
    onCell?.(c + 1);
  }
  return { observed, pRaw, pAdj };
}

/** Label of one cell-behavior pair: significant when the p-value (adjusted, if corrected) is below alpha; the sign of the value gives the direction. */
export function pethResponse(value: number, p: number, alpha: number): Response {
  if (!Number.isFinite(value) || !Number.isFinite(p)) return 'not evaluated';
  if (p < alpha && value > 0) return 'excited';
  if (p < alpha && value < 0) return 'inhibited';
  return 'not significant';
}
