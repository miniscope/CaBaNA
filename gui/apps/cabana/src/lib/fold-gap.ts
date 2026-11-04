// Training/test separation for decoding (framework F1, `fold_gap_s`): how many training frames
// the framework leaves out next to each test block, and a separation suggested from the data.
// Display and advice only; the framework applies the separation.

import { windowFrames } from './decode-bayes.ts';

/** Whole frames covering `gapS` at `fs`, rounded up (framework `gap_frames`). */
export const gapFrames = (gapS: number, fs: number) => (gapS > 0 ? Math.ceil(gapS * fs - 1e-9) : 0);

/**
 * Training frames the framework leaves out on each side of a test block (its
 * `fold_exclusion_frames`). The Bayesian decoder adds half its test window to a nonzero
 * separation so no test window reads a training frame; pass `windowS = 0` for logistic regression.
 */
export const exclusionFrames = (gapS: number, fs: number, windowS: number) =>
  gapFrames(gapS, fs) + (gapS > 0 ? (windowFrames(windowS, fs) - 1) / 2 : 0);

/**
 * Mean over cells of the autocorrelation of binarized events (above 0 is 1), lags 0 to `maxLag`
 * frames. `neural` is cells x frames, one row per cell. Each cell's autocorrelation is the
 * mean-removed lagged product summed over the overlap, divided by the summed squares (1 at lag 0).
 * Computed from event pairs, so the cost grows with the number of events, not frames x lags.
 */
export function meanEventAutocorrelation(
  neural: ArrayLike<number>,
  cells: number,
  frames: number,
  maxLag: number,
): Float64Array {
  const L = Math.max(0, Math.min(maxLag, frames - 1));
  const sum = new Float64Array(L + 1);
  const pairs = new Float64Array(L + 1);
  const before = new Int32Array(frames + 1); // events in frames [0, t)
  const pos: number[] = [];
  let used = 0;
  for (let c = 0; c < cells; c++) {
    pos.length = 0;
    for (let t = 0; t < frames; t++) {
      const on = neural[c * frames + t] > 0; // NaN is no event
      before[t + 1] = before[t] + (on ? 1 : 0);
      if (on) pos.push(t);
    }
    const n = pos.length;
    if (n === 0 || n === frames) continue; // constant: no autocorrelation
    const p = n / frames;
    pairs.fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n && pos[j] - pos[i] <= L; j++) pairs[pos[j] - pos[i]]++;
    pairs[0] = n;
    const squares = n * (1 - p);
    for (let k = 0; k <= L; k++) {
      // sum over t < frames - k of (x[t] - p) * (x[t + k] - p)
      const head = before[frames - k];
      const tail = n - before[k];
      sum[k] += (pairs[k] - p * (head + tail) + (frames - k) * p * p) / squares;
    }
    used++;
  }
  return used ? sum.map((v) => v / used) : sum.fill(NaN);
}

export type SeparationSuggestion =
  | {
      /** Suggested `fold_gap_s`, rounded up to 0.1 s. */
      suggestedS: number;
      /** First lag at which the cells' mean autocorrelation reaches zero. */
      decorrelationS: number;
      cells: number;
    }
  | { error: string };

/**
 * Suggested training/test separation: the first lag at which the cells' mean event
 * autocorrelation reaches zero, searched up to `maxS`. The framework adds half the Bayesian test
 * window itself, so it is not included here. A heuristic, not a guarantee of independence.
 */
export function suggestSeparation(
  neural: ArrayLike<number>,
  cells: number,
  frames: number,
  fs: number,
  maxS = 30,
): SeparationSuggestion {
  const acf = meanEventAutocorrelation(neural, cells, frames, Math.round(maxS * fs));
  if (!Number.isFinite(acf[0]))
    return { error: 'No cell has both frames with and without events.' };
  const k = acf.findIndex((v, i) => i > 0 && v <= 0);
  if (k < 0)
    return {
      error: `The cells' mean autocorrelation stays above zero for ${maxS} s, so no separation is suggested.`,
    };
  const decorrelationS = k / fs;
  return { suggestedS: Math.ceil(decorrelationS * 10 - 1e-9) / 10, decorrelationS, cells };
}
