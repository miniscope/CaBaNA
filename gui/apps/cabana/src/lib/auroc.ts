// auROC analysis, following the CaBaNA framework (miniscope/CaBaNA, branch framework-demo,
// commit 57c0c4b): the `auroc` metric (Mann-Whitney statistic of each cell, in versus out of
// each behavior), a circular-shift null, two-sided p-values and the max-stat correction.
//
// Everything takes plain typed arrays and returns typed arrays, so it runs in a worker and can
// be swapped for a Rust/WASM version without changing callers.

import { boutFrames } from './framework.ts';
import { autocorrTime, minShiftFromTaus } from './placecells.ts';
import { matchGroups } from './speed-match.ts';

export interface AurocInput {
  /** Neural data, one row per cell: cell * frames + frame. */
  neural: Float32Array | Float64Array;
  cells: number;
  frames: number;
  fs: number;
  /** Behavior frame labels, one row per behavior (1 = in the behavior): behavior * frames + frame. Rows may overlap. */
  behaviors: Uint8Array;
  nBehaviors: number;
  /** 1 for frames included in the analysis (the Preprocess selection). */
  mask: Uint8Array;
}

export const MIN_FRAMES = 20;

const row = (m: AurocInput, c: number) => m.neural.subarray(c * m.frames, (c + 1) * m.frames);
const behaviorRow = (m: AurocInput, b: number) =>
  m.behaviors.subarray(b * m.frames, (b + 1) * m.frames);

/** `bouts_to_states` for each label: frame labels (1 = in the behavior) from annotation epochs. */
export function behaviorFrames(
  epochs: { label: string; start: number; stop: number }[],
  labels: string[],
  t: ArrayLike<number>,
): Uint8Array {
  const out = new Uint8Array(labels.length * t.length);
  labels.forEach((label, b) => {
    const on = boutFrames(
      epochs.filter((e) => e.label === label),
      t,
    );
    for (let i = 0; i < on.length; i++) out[b * t.length + i] = on[i] ? 1 : 0;
  });
  return out;
}

/** Frames in each behavior (`n1`) and outside it (`n0`) among the included frames. */
export function frameCounts(m: AurocInput): { n1: Float64Array; n0: Float64Array } {
  let kept = 0;
  for (let t = 0; t < m.frames; t++) kept += m.mask[t];
  const n1 = new Float64Array(m.nBehaviors);
  for (let b = 0; b < m.nBehaviors; b++) {
    const r = behaviorRow(m, b);
    for (let t = 0; t < m.frames; t++) n1[b] += r[t] & m.mask[t];
  }
  return { n1, n0: n1.map((n) => kept - n) };
}

/** `average_ranks` of one series: 1-based, ties share the mean of their ranks. All NaN if any value is not finite. */
export function averageRanks(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++)
    if (!Number.isFinite(x[i])) {
      out.fill(NaN);
      return out;
    }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && x[order[j + 1]] === x[order[i]]) j++;
    const rank = (i + j + 2) / 2; // mean of 1-based ranks i+1 .. j+1
    for (let k = i; k <= j; k++) out[order[k]] = rank;
    i = j + 1;
  }
  return out;
}

/** `auroc_from_rank_sums`: (R1 - n1 (n1 + 1) / 2) / (n1 n0), NaN unless n1 and n0 are both at least `minFrames`. */
export function aurocFromRankSum(r1: number, n1: number, n0: number, minFrames: number): number {
  if (!(n1 >= minFrames && n0 >= minFrames)) return NaN;
  return (r1 - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

/**
 * `AUROC.compute`: observed auROC, cells x behaviors (cell * nBehaviors + behavior). NaN for a cell
 * with a non-finite neural value among the included frames, and for a behavior with fewer than
 * `minFrames` included frames inside or outside it. Excluded frames are left out entirely.
 */
export function observedAuroc(m: AurocInput, minFrames = MIN_FRAMES): Float64Array {
  const { n1, n0 } = frameCounts(m);
  const kept: number[] = [];
  for (let t = 0; t < m.frames; t++) if (m.mask[t]) kept.push(t);
  const out = new Float64Array(m.cells * m.nBehaviors);
  for (let c = 0; c < m.cells; c++) {
    const r = averageRanks(Array.from(kept, (t) => row(m, c)[t]));
    for (let b = 0; b < m.nBehaviors; b++) {
      const lab = behaviorRow(m, b);
      let r1 = 0;
      kept.forEach((t, i) => {
        if (lab[t]) r1 += r[i];
      });
      out[c * m.nBehaviors + b] = aurocFromRankSum(r1, n1[b], n0[b], minFrames);
    }
  }
  return out;
}

/** Dense 0-based ranks of one series (equal values share a rank) and the number of distinct values. */
function denseRanks(x: ArrayLike<number>): { dense: Int32Array; width: number } {
  const sorted = Float64Array.from(x).sort();
  const u: number[] = [];
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) u.push(sorted[i]);
  const dense = new Int32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let lo = 0;
    let hi = u.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u[mid] < x[i]) lo = mid + 1;
      else hi = mid;
    }
    dense[i] = lo;
  }
  return { dense, width: u.length };
}

/**
 * `AUROC.compute_shifted` for one cell: auROC for each circular shift, shifts x behaviors
 * (shift * nBehaviors + behavior). The cell is rolled over the whole session first and the mask
 * is applied afterwards, so excluded frames keep their time positions. `roll(x, k)[t] = x[t - k]`.
 *
 * With every frame included, rolling only permutes frames, so the ranks of the rolled series are
 * the rolled ranks and each shift is a sum over the behavior's frames. Otherwise the rolled,
 * masked series has its own ranks; with F(g) = (number of frames below dense rank g) + half the
 * frames at g, R1 = sum of F over the behavior's frames + n1 / 2, exact with ties and without
 * sorting inside the loop (the framework's `_masked_shifted_rank_sums`).
 *
 * A shift gives NaN where a non-finite value is rolled into an included frame.
 */
export function shiftedAurocCell(
  m: AurocInput,
  c: number,
  shifts: ArrayLike<number>,
  minFrames = MIN_FRAMES,
): Float64Array {
  const { frames: n, nBehaviors: nb } = m;
  const { n1, n0 } = frameCounts(m);
  const x = row(m, c);
  const kept = Uint32Array.from({ length: n }, (_, t) => t).filter((t) => m.mask[t]);
  const all = kept.length === n;
  const bad = Array.from(x, (v, t) => (Number.isFinite(v) ? -1 : t)).filter((t) => t >= 0);
  const clean = bad.length ? x.map((v) => (Number.isFinite(v) ? v : 0)) : x;
  // frames of each behavior, as positions in `kept` (or in the whole series when all are kept)
  const where = new Int32Array(n).fill(-1);
  kept.forEach((t, i) => (where[t] = i));
  const inB = Array.from({ length: nb }, (_, b) => {
    const lab = behaviorRow(m, b);
    return Uint32Array.from(kept.filter((t) => lab[t])).map((t) => (all ? t : where[t]));
  });

  const out = new Float64Array(shifts.length * nb);
  const ranks = all ? averageRanks(clean) : null;
  const { dense, width } = all ? { dense: null, width: 0 } : denseRanks(clean);
  const hist = new Float64Array(width);
  const f = new Float64Array(width);
  const g = new Int32Array(kept.length);
  for (let i = 0; i < shifts.length; i++) {
    const k = shifts[i];
    if (bad.some((t) => m.mask[(t + k) % n])) {
      out.fill(NaN, i * nb, (i + 1) * nb);
      continue;
    }
    if (!all) {
      hist.fill(0);
      for (let j = 0; j < kept.length; j++) hist[(g[j] = dense![(kept[j] - k + n) % n])]++;
      let below = 0;
      for (let v = 0; v < width; v++) {
        f[v] = below + 0.5 * hist[v];
        below += hist[v];
      }
    }
    for (let b = 0; b < nb; b++) {
      let r1 = 0;
      if (all) for (const t of inB[b]) r1 += ranks![(t - k + n) % n];
      else {
        for (const j of inB[b]) r1 += f[g[j]];
        r1 += n1[b] / 2;
      }
      out[i * nb + b] = aurocFromRankSum(r1, n1[b], n0[b], minFrames);
    }
  }
  return out;
}

/** `_p_values`, two-sided: 2 (min(ge, le) + 1) / (n + 1) over the finite null draws, at most 1; NaN if undefined. */
export function pTwoSided(observed: number, nullDraws: ArrayLike<number>): number {
  if (!Number.isFinite(observed)) return NaN;
  let ge = 0;
  let le = 0;
  let n = 0;
  for (let i = 0; i < nullDraws.length; i++) {
    const v = nullDraws[i];
    if (!Number.isFinite(v)) continue;
    n++;
    if (v >= observed) ge++;
    if (v <= observed) le++;
  }
  return n === 0 ? NaN : Math.min(1, (2 * (Math.min(ge, le) + 1)) / (n + 1));
}

/** Number of values in an ascending array below (strict) and at or below `v`. */
function countBelow(sorted: Float64Array, v: number, orEqual: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orEqual ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * `_max_stat_p` for one cell: Westfall-Young single-step minimum p across the cell's behaviors.
 * `nullDraws` is shuffles x behaviors, `observed` and `pRaw` one value per behavior. Each draw is
 * turned into a within-null p (2 min(ge, le) / n, ties counted, no +1); a shuffle's family
 * statistic is the smallest of these over behaviors. The adjusted p is
 * (number of shuffles whose smallest p <= the observed p + 1) / (shuffles + 1), where the observed
 * p counts itself as one more draw, and is never below the raw p.
 * This corrects only across the behaviors of one cell, never across cells.
 */
export function maxStatAdjust(
  observed: ArrayLike<number>,
  nullDraws: ArrayLike<number>,
  pRaw: ArrayLike<number>,
): Float64Array {
  const nb = observed.length;
  const ns = nullDraws.length / nb;
  const cols = Array.from({ length: nb }, (_, b) => {
    const v: number[] = [];
    for (let i = 0; i < ns; i++) if (Number.isFinite(nullDraws[i * nb + b])) v.push(nullDraws[i * nb + b]);
    return Float64Array.from(v).sort();
  });
  const minP = new Float64Array(ns).fill(Infinity);
  for (let b = 0; b < nb; b++) {
    const nv = cols[b].length;
    for (let i = 0; i < ns; i++) {
      const v = nullDraws[i * nb + b];
      if (!Number.isFinite(v)) continue;
      const ge = nv - countBelow(cols[b], v, false);
      const le = countBelow(cols[b], v, true);
      minP[i] = Math.min(minP[i], Math.min((2 * Math.min(ge, le)) / nv, 1));
    }
  }
  let nFamily = 0;
  for (let i = 0; i < ns; i++) if (minP[i] < Infinity) nFamily++;
  const out = new Float64Array(nb).fill(NaN);
  for (let b = 0; b < nb; b++) {
    if (!Number.isFinite(observed[b]) || !Number.isFinite(pRaw[b])) continue;
    const nv = cols[b].length;
    const ge = nv - countBelow(cols[b], observed[b], false);
    const le = countBelow(cols[b], observed[b], true);
    const pObs = Math.min((2 * Math.min(ge + 1, le + 1)) / (nv + 1), 1);
    let cnt = 0;
    for (let i = 0; i < ns; i++) if (minP[i] <= pObs) cnt++;
    out[b] = Math.max(Math.min((cnt + 1) / (nFamily + 1), 1), pRaw[b]);
  }
  return out;
}

export type Response = 'excited' | 'inhibited' | 'not significant' | 'not evaluated';

/** Label of one cell-behavior pair: significant when the p-value (adjusted, if corrected) is below alpha. */
export function responseOf(auroc: number, p: number, alpha: number): Response {
  if (!Number.isFinite(auroc) || !Number.isFinite(p)) return 'not evaluated';
  if (p < alpha && auroc > 0.5) return 'excited';
  if (p < alpha && auroc < 0.5) return 'inhibited';
  return 'not significant';
}

export interface AurocMinShift {
  minShiftS: number;
  tauNeuralS: number;
  tauBehaviorS: number;
  note: string;
}

/**
 * `auto_null_timescale` for auROC: 3 times the longer of the neural and the behavior
 * autocorrelation time, at least 5 s and at most a quarter of the recording. The neural time is
 * the median over cells; the behavior time is the average over behaviors of the autocorrelation
 * time of "is the animal in this behavior", weighted by the included frames in it.
 */
export function selectAurocMinShift(m: AurocInput, maxLagS = 60): AurocMinShift {
  const taus: number[] = [];
  for (let c = 0; c < m.cells; c++) {
    const t = autocorrTime(row(m, c), m.mask, m.fs, maxLagS);
    if (Number.isFinite(t)) taus.push(t);
  }
  taus.sort((a, b) => a - b);
  const mid = taus.length >> 1;
  const tauNeural = taus.length
    ? taus.length % 2
      ? taus[mid]
      : (taus[mid - 1] + taus[mid]) / 2
    : NaN;

  const { n1 } = frameCounts(m);
  let wsum = 0;
  let tsum = 0;
  for (let b = 0; b < m.nBehaviors; b++) {
    const tau = autocorrTime(behaviorRow(m, b), m.mask, m.fs, maxLagS);
    if (Number.isFinite(tau) && n1[b] > 0) {
      wsum += n1[b];
      tsum += n1[b] * tau;
    }
  }
  const tauBehavior = wsum > 0 ? tsum / wsum : NaN;
  const choice = minShiftFromTaus(tauNeural, tauBehavior, m.frames / m.fs);
  return { ...choice, tauNeuralS: tauNeural, tauBehaviorS: tauBehavior };
}

export interface AurocResult {
  /** cells x behaviors (cell * nBehaviors + behavior) */
  observed: Float64Array;
  /** Two-sided p-value from the shifted data. */
  pRaw: Float64Array;
  /** Max-stat adjusted p-value across the behaviors of each cell (equal to `pRaw` with no correction). */
  pAdj: Float64Array;
}

/** `shuffle_test` for the auROC metric on the given shifts: observed values, p-values and the correction. */
export function analyzeAuroc(
  m: AurocInput,
  shifts: ArrayLike<number>,
  correction: 'none' | 'max_stat',
  minFrames = MIN_FRAMES,
  onCell?: (done: number) => void,
): AurocResult {
  const nb = m.nBehaviors;
  const observed = observedAuroc(m, minFrames);
  const pRaw = new Float64Array(observed.length);
  const pAdj = new Float64Array(observed.length);
  for (let c = 0; c < m.cells; c++) {
    const draws = shiftedAurocCell(m, c, shifts, minFrames);
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

/** The behaviors speed matching can use (at least `minFrames` included frames) for this input. */
export const matchGroupsOf = (m: AurocInput, minFrames: number) =>
  matchGroups(m.behaviors, m.nBehaviors, m.mask, minFrames);
