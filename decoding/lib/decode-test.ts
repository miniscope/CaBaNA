// The label-shuffle test of a decoder, following the framework (miniscope/CaBaNA, branch framework-demo,
// commit 57c0c4b): the decoder is run again on labels shuffled in blocks (`LabelShuffle`), and each
// state's value is compared with its own shuffled values (`_p_values`). Max-stat correction is the
// Westfall-Young single-step min-p across states (`_max_stat_p`).
//
// GUI extension (not in the framework): an overall test. The overall statistic (median error for
// position, balanced accuracy for behaviors) is computed on every shuffle, and its p-value is read
// from that null. The framework reports these overall numbers but only tests each state.
//
// Correction statistic: the framework's min-p. Each shuffled value is turned into its own p-value
// within its state's null, so states whose nulls differ in width and location (a rare behavior against
// a common one, a corner bin against a central one) are compared on one scale; the family statistic of
// a shuffle is the smallest of these. The correction applies to the tested states of one target and
// one run, and not to the overall test.

import { labelShuffle, roundHalfEven } from './decode-shared.ts';
import { decodeLinear, type LinearInput, type LinearParams } from './decode-linear.ts';
import { makeBayesDecoder, type BayesInput, type BayesOut, type BayesParams } from './decode-bayes.ts';
import { makeRng } from './placecells.ts';

/** Lower: smaller is better (error). Upper: larger is better (accuracy, recall). */
export type Tail = 'lower' | 'upper';

/** The overall statistic: median error in cm for position, balanced accuracy (mean recall over states) for behaviors. */
export function overallStatistic(out: BayesOut, spatial: boolean): number {
  if (spatial) return out.errorOverall;
  const v = out.values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

/** The labels of shuffle `i`: its own seeded generator, so the draws do not depend on how shuffles are split across workers. */
export function shuffledLabels(
  labels: Int32Array,
  mask: Uint8Array,
  blockFrames: number,
  seed: number,
  i: number,
): Int32Array {
  return labelShuffle(labels, mask, blockFrames, makeRng(seed * 1_000_003 + i * 7919 + 1));
}

/** Frames in a shuffle block of `blockS` seconds (`round(block_s * fs)`, at least 1). */
export const blockFrames = (blockS: number, fs: number) => Math.max(1, roundHalfEven(blockS * fs));

/** Counts of finite draws at least / at most `v`, and the number of finite draws. */
function counts(draws: ArrayLike<number>, v: number) {
  let ge = 0;
  let le = 0;
  let n = 0;
  for (let i = 0; i < draws.length; i++) {
    const d = draws[i];
    if (!Number.isFinite(d)) continue;
    n++;
    if (d >= v) ge++;
    if (d <= v) le++;
  }
  return { ge, le, n };
}

/** `_p_values`, one-sided: (draws at least as extreme + 1) / (finite draws + 1); NaN when undefined. */
export function pTail(observed: number, draws: ArrayLike<number>, tail: Tail): number {
  if (!Number.isFinite(observed)) return NaN;
  const { ge, le, n } = counts(draws, observed);
  if (!n) return NaN;
  return Math.min(((tail === 'upper' ? ge : le) + 1) / (n + 1), 1);
}

/** Lowest index in the sorted array whose value is not below `v` (and above `v` when `strict`). */
function lowerBound(sorted: Float64Array, v: number, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * `_max_stat_p` for one family (the tested states of one target): `null` is shuffles x states, row-major.
 * Each shuffled value becomes a p-value within its own state's null (ties counted, NaN draws ignored), the
 * family statistic of a shuffle is the smallest of them, and the adjusted p of a state is
 * (shuffles whose family minimum is at most its observed p + 1) / (shuffles with a defined minimum + 1),
 * never below its raw p.
 */
export function maxStatP(
  observed: ArrayLike<number>,
  nullDraws: ArrayLike<number>,
  tail: Tail,
  pRaw: ArrayLike<number>,
): Float64Array {
  const ns = observed.length;
  const nShuf = ns ? nullDraws.length / ns : 0;
  const cols = Array.from({ length: ns }, (_, s) => {
    const v: number[] = [];
    for (let i = 0; i < nShuf; i++) if (Number.isFinite(nullDraws[i * ns + s])) v.push(nullDraws[i * ns + s]);
    return Float64Array.from(v).sort();
  });
  const tailP = (ge: number, le: number, n: number) => Math.min((tail === 'upper' ? ge : le) / n, 1);
  const minP = new Float64Array(nShuf).fill(Infinity);
  for (let s = 0; s < ns; s++) {
    const n = cols[s].length;
    for (let i = 0; i < nShuf; i++) {
      const v = nullDraws[i * ns + s];
      if (!Number.isFinite(v)) continue;
      const ge = n - lowerBound(cols[s], v, false);
      const le = lowerBound(cols[s], v, true);
      minP[i] = Math.min(minP[i], tailP(ge, le, n));
    }
  }
  let nFamily = 0;
  for (let i = 0; i < nShuf; i++) if (minP[i] < Infinity) nFamily++;
  const out = new Float64Array(ns).fill(NaN);
  for (let s = 0; s < ns; s++) {
    if (!Number.isFinite(observed[s]) || !Number.isFinite(pRaw[s])) continue;
    const n = cols[s].length;
    const ge = n - lowerBound(cols[s], observed[s], false);
    const le = lowerBound(cols[s], observed[s], true);
    const pObs = tailP(ge + 1, le + 1, n + 1);
    let cnt = 0;
    for (let i = 0; i < nShuf; i++) if (minP[i] <= pObs) cnt++;
    out[s] = Math.max(Math.min((cnt + 1) / (nFamily + 1), 1), pRaw[s]);
  }
  return out;
}

export interface DecodeTestResult {
  /** Observed per-state values and their raw and corrected p-values; NaN where a state is not evaluated. */
  pRaw: Float64Array;
  pAdj: Float64Array;
  /** Overall statistic of the observed labels and its p-value (an extension to the framework). */
  overall: number;
  pOverall: number;
}

/** The p-values from the observed result and the shuffled ones (`nullValues`: shuffles x states, `nullOverall`: shuffles). */
export function decodeTest(
  observed: ArrayLike<number>,
  overall: number,
  nullValues: Float64Array,
  nullOverall: ArrayLike<number>,
  tail: Tail,
  correction: 'none' | 'max_stat',
): DecodeTestResult {
  const ns = observed.length;
  const nShuf = ns ? nullValues.length / ns : 0;
  const pRaw = new Float64Array(ns);
  for (let s = 0; s < ns; s++) {
    const col = new Float64Array(nShuf);
    for (let i = 0; i < nShuf; i++) col[i] = nullValues[i * ns + s];
    pRaw[s] = pTail(observed[s], col, tail);
  }
  const pAdj = correction === 'max_stat' && ns > 1 ? maxStatP(observed, nullValues, tail, pRaw) : pRaw.slice();
  return { pRaw, pAdj, overall, pOverall: pTail(overall, nullOverall, tail) };
}

/**
 * The decoder on shuffles `from` to `to - 1`: per-state values (shuffles x states) and the overall
 * statistic of each. Every shuffle is the full cross-validated run on its shuffled labels.
 */
export function runShuffles(
  input: BayesInput,
  params: BayesParams,
  blockS: number,
  seed: number,
  from: number,
  to: number,
  onProgress?: (done: number) => void,
): { values: Float64Array; overall: Float64Array } {
  const decoder = makeBayesDecoder(input, params);
  const block = blockFrames(blockS, input.fs);
  const spatial = !!input.centers;
  const values = new Float64Array((to - from) * input.nStates);
  const overall = new Float64Array(to - from);
  for (let i = from; i < to; i++) {
    const out = decoder(shuffledLabels(input.labels, input.mask, block, seed, i));
    values.set(out.values, (i - from) * input.nStates);
    overall[i - from] = overallStatistic(out, spatial);
    onProgress?.(i - from + 1);
  }
  return { values, overall };
}

/** The logistic-regression decoder on shuffles `from` to `to - 1`: balanced accuracy per behavior (shuffles x states) and the mean over behaviors. */
export function runLinearShuffles(
  input: LinearInput,
  params: LinearParams,
  blockS: number,
  seed: number,
  from: number,
  to: number,
  onProgress?: (done: number) => void,
): { values: Float64Array; overall: Float64Array } {
  const block = blockFrames(blockS, input.fs);
  const values = new Float64Array((to - from) * input.nStates);
  const overall = new Float64Array(to - from);
  for (let i = from; i < to; i++) {
    const out = decodeLinear(input, params, shuffledLabels(input.labels, input.mask, block, seed, i));
    values.set(out.values, (i - from) * input.nStates);
    overall[i - from] = out.overall;
    onProgress?.(i - from + 1);
  }
  return { values, overall };
}
