// Optional time bins before auROC. Deconvolved events are mostly exact zeros, and tied zeros cannot be
// ranked, so frame-wise auROC is pulled toward 0.5 however strongly a cell responds (a cell at 5x its
// rate can score 0.58 on frames and 0.88 on 1 s bins). Binning sums the events per bin first, as the
// framework's `rebin_time` step does (`Session.rebin`, activity summed for event-like data).

import { roundHalfEven } from './decode-shared.ts';

/** Bin lengths the suggestion chooses from, shortest first (seconds). */
export const BIN_CANDIDATES_S = [0.1, 0.25, 0.5, 1, 2, 5];
/** Suggest the shortest bin in which a typical cell is exactly zero in at most this share of bins. */
export const TARGET_ZERO_FRACTION = 0.25;
/**
 * A bin is at most this share of the shortest typical bout of the compared behaviors, so most of a
 * bout's bins lie wholly inside it (on simulated 1.5 s bouts, bins of 2/3 of a bout let activity
 * just before and after the bout count for it; a third did not).
 */
export const MAX_BOUT_SHARE = 1 / 3;
/** A bin counts as in a behavior (or as included) when at least this share of its frames is. */
export const BIN_MIN_FRACTION = 0.5;

export interface BinInput {
  /** cell * frames + frame */
  neural: ArrayLike<number>;
  cells: number;
  frames: number;
  fs: number;
  /** behavior * frames + frame, 1 = in the behavior; rows may overlap. */
  behaviors: Uint8Array;
  nBehaviors: number;
  mask: Uint8Array;
  speed?: Float64Array;
}

export const framesPerBin = (binS: number, fs: number) => Math.max(1, roundHalfEven(binS * fs));

/**
 * `Session.rebin(bin_s, "sum", 0.5, drop_mixed=[...])`: events summed per bin; each behavior row, and
 * the mask, on when at least half of the bin's frames are; speed averaged over its finite values.
 * Bins that are partly in one of `mixedRows` (the compared behaviors) are left out (mask 0), so
 * activity just before or after a bout is not counted for it or for its reference. Frames that do
 * not fill a last bin are dropped.
 */
export function rebinAuroc<T extends BinInput>(
  m: T,
  binS: number,
  mixedRows: number[] = [],
): T & { k: number; mixed: number } {
  const k = framesPerBin(binS, m.fs);
  const n = Math.floor(m.frames / k);
  if (n < 2) throw new Error('The time bin is too long: fewer than two bins would remain.');
  const neural = new Float32Array(m.cells * n);
  for (let c = 0; c < m.cells; c++)
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += m.neural[c * m.frames + b * k + j];
      neural[c * n + b] = s;
    }
  const share = (row: Uint8Array, offset: number, b: number) => {
    let on = 0;
    for (let j = 0; j < k; j++) on += row[offset + b * k + j] ? 1 : 0;
    return on / k >= BIN_MIN_FRACTION ? 1 : 0;
  };
  const behaviors = new Uint8Array(m.nBehaviors * n);
  for (let r = 0; r < m.nBehaviors; r++)
    for (let b = 0; b < n; b++) behaviors[r * n + b] = share(m.behaviors, r * m.frames, b);
  const isMixed = (b: number) =>
    mixedRows.some((r) => {
      let on = 0;
      for (let j = 0; j < k; j++) on += m.behaviors[r * m.frames + b * k + j] ? 1 : 0;
      return on > 0 && on < k;
    });
  let mixed = 0;
  const mask = Uint8Array.from({ length: n }, (_, b) => {
    if (!isMixed(b)) return share(m.mask, 0, b);
    mixed++;
    return 0;
  });
  let speed: Float64Array | undefined;
  if (m.speed) {
    speed = new Float64Array(n);
    for (let b = 0; b < n; b++) {
      let s = 0;
      let c = 0;
      for (let j = 0; j < k; j++) {
        const v = m.speed[b * k + j];
        if (Number.isFinite(v)) {
          s += v;
          c++;
        }
      }
      speed[b] = c ? s / c : NaN;
    }
  }
  return { ...m, neural, behaviors, mask, speed, frames: n, fs: m.fs / k, k, mixed };
}

/** Median length (frames) of the runs of included frames inside behavior row `r`; 0 without any. */
export function medianBoutFrames(m: BinInput, r: number): number {
  const runs: number[] = [];
  let run = 0;
  for (let t = 0; t <= m.frames; t++) {
    const on = t < m.frames && m.behaviors[r * m.frames + t] && m.mask[t];
    if (on) run++;
    else if (run) {
      runs.push(run);
      run = 0;
    }
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  const h = runs.length >> 1;
  return runs.length % 2 ? runs[h] : (runs[h - 1] + runs[h]) / 2;
}

/**
 * Median, over cells with any activity, of the share of included bins (of `k` frames) whose summed
 * events are exactly zero. Ties at zero are what compress frame-wise auROC.
 */
export function zeroFraction(m: BinInput, k: number): number {
  const n = Math.floor(m.frames / k);
  const kept: number[] = [];
  for (let b = 0; b < n; b++) {
    let on = 0;
    for (let j = 0; j < k; j++) on += m.mask[b * k + j];
    if (on / k >= BIN_MIN_FRACTION) kept.push(b);
  }
  const shares: number[] = [];
  for (let c = 0; c < m.cells; c++) {
    let zeros = 0;
    let active = false;
    for (const b of kept) {
      let s = 0;
      for (let j = 0; j < k; j++) s += m.neural[c * m.frames + b * k + j];
      if (s === 0) zeros++;
      else active = true;
    }
    if (active && kept.length) shares.push(zeros / kept.length);
  }
  if (!shares.length) return 0;
  shares.sort((a, b) => a - b);
  const h = shares.length >> 1;
  return shares.length % 2 ? shares[h] : (shares[h - 1] + shares[h]) / 2;
}

export interface BinSuggestion {
  /** Suggested bin in seconds; 0 = keep frames (no binning). */
  binS: number;
  /** Zero share at the frame level and in the suggested bins. */
  frameZeros: number;
  binZeros: number;
  /** Longest bin the compared behaviors allow (seconds); Infinity without a behavior. */
  maxS: number;
  /** dense: frames already have few zeros; target: zeros at or below the target; limit: the bout limit stopped it. */
  reason: 'dense' | 'target' | 'limit';
}

/**
 * The shortest bin from `BIN_CANDIDATES_S` in which a typical cell is exactly zero in at most
 * `TARGET_ZERO_FRACTION` of bins, no longer than `MAX_BOUT_SHARE` of the shortest median bout among
 * behavior rows `rows`. Data that already meet the target per frame (traces) are not binned.
 */
export function suggestAurocBin(m: BinInput, rows: number[]): BinSuggestion {
  const frameZeros = zeroFraction(m, 1);
  const bouts = rows.map((r) => medianBoutFrames(m, r)).filter((b) => b > 0);
  const maxS = bouts.length ? (MAX_BOUT_SHARE * Math.min(...bouts)) / m.fs : Infinity;
  if (frameZeros <= TARGET_ZERO_FRACTION)
    return { binS: 0, frameZeros, binZeros: frameZeros, maxS, reason: 'dense' };
  let best: BinSuggestion = { binS: 0, frameZeros, binZeros: frameZeros, maxS, reason: 'limit' };
  for (const binS of BIN_CANDIDATES_S) {
    const k = framesPerBin(binS, m.fs);
    if (k < 2 || binS > maxS + 1e-9 || Math.floor(m.frames / k) < 2) {
      if (binS > maxS + 1e-9) break;
      continue;
    }
    const z = zeroFraction(m, k);
    best = { binS, frameZeros, binZeros: z, maxS, reason: 'limit' };
    if (z <= TARGET_ZERO_FRACTION) return { ...best, reason: 'target' };
  }
  return best;
}

/** One line on what the suggestion is based on. */
export function suggestionText(s: BinSuggestion): string {
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  if (s.reason === 'dense')
    return `A typical cell is zero in ${pct(s.frameZeros)} of frames, so frames are kept as they are.`;
  if (!s.binS)
    return `A typical cell is zero in ${pct(s.frameZeros)} of frames, but the shortest behavior bouts are too short to bin.`;
  const base = `A typical cell is zero in ${pct(s.frameZeros)} of frames and ${pct(s.binZeros)} of ${s.binS} s bins`;
  return s.reason === 'target'
    ? `${base}.`
    : `${base}; longer bins would exceed a third of the shortest typical bout (${+s.maxS.toFixed(2)} s).`;
}
