// Pieces the decoders share, following the CaBaNA framework (miniscope/CaBaNA, branch
// framework-demo, commit 57c0c4b): time rebinning, one label per frame from overlapping
// behaviors, and the label-shuffle surrogate.
//
// A "label" is the state of one frame (a grid bin, or a behavior index), -1 when the frame
// has none. Neural data is cells x frames, one row per cell.

/** Python's round(): halves go to the even number (the framework's window width uses it). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// ---- rebinning ---------------------------------------------------------------------------

export interface Rebinned {
  neural: Float64Array;
  labels: Int32Array;
  mask: Uint8Array;
  frames: number;
  fs: number;
  /** Frames per bin. */
  k: number;
}

/**
 * `Session.rebin` for deconvolved events: neural data summed per bin; a state is active in a bin when it
 * covers at least `minFraction` of it (the most frequent state, ties to the lowest index); the mask
 * likewise. Frames that do not fill a last bin are dropped. `binS` is rounded to a whole number of frames.
 * Meant for decoders that work on coarse bins, and for Population analysis later.
 */
export function rebin(
  neural: ArrayLike<number>,
  cells: number,
  frames: number,
  labels: Int32Array,
  mask: Uint8Array,
  nStates: number,
  fs: number,
  binS: number,
  minFraction = 0.5,
): Rebinned {
  const k = roundHalfEven(binS * fs);
  if (k < 1) throw new Error('The time bin is shorter than one frame.');
  const nNew = Math.floor(frames / k);
  if (k > 1 && nNew < 2)
    throw new Error('The time bin is too large: fewer than two bins would remain.');
  const out = new Float64Array(cells * nNew);
  for (let c = 0; c < cells; c++)
    for (let b = 0; b < nNew; b++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += neural[c * frames + b * k + j];
      out[c * nNew + b] = s;
    }
  const lab = new Int32Array(nNew).fill(-1);
  const msk = new Uint8Array(nNew);
  const count = new Int32Array(nStates);
  for (let b = 0; b < nNew; b++) {
    count.fill(0);
    let m = 0;
    for (let j = 0; j < k; j++) {
      const t = b * k + j;
      if (labels[t] >= 0) count[labels[t]]++;
      m += mask[t];
    }
    let best = 0;
    for (let s = 1; s < nStates; s++) if (count[s] > count[best]) best = s;
    if (count[best] > 0 && count[best] / k >= minFraction) lab[b] = best;
    msk[b] = m / k >= minFraction ? 1 : 0;
  }
  return { neural: out, labels: lab, mask: msk, frames: nNew, fs: fs / k, k };
}

// ---- one label per frame from overlapping behaviors ------------------------------------------

/**
 * `BoutsToStates` with `exclusive` and `add_rest`: `behaviors` is one 0/1 row per behavior, `order` the
 * behavior rows in priority order (the earlier one wins an overlap). The label of a frame is the
 * position in `order` of the winning behavior. With `other`, scored frames with none of the selected
 * behaviors get the label `order.length`; without it they are -1 (left out). `scored` marks the frames
 * that were annotated (all frames when absent).
 */
export function exclusiveLabels(
  behaviors: Uint8Array,
  frames: number,
  order: number[],
  other: boolean,
  scored?: Uint8Array,
): Int32Array {
  const labels = new Int32Array(frames).fill(-1);
  for (let t = 0; t < frames; t++) {
    for (let j = 0; j < order.length; j++)
      if (behaviors[order[j] * frames + t]) {
        labels[t] = j;
        break;
      }
    if (labels[t] < 0 && other && (!scored || scored[t])) labels[t] = order.length;
  }
  return labels;
}

export interface OverlapReport {
  /** Frames with at least one selected behavior, and frames with two or more. */
  labeled: number;
  overlapping: number;
  /** Frames each behavior (by position in `order`) wins, and frames it loses to an earlier one. */
  won: number[];
  lost: number[];
  /** Frames of each final state, `other` last when it is on. */
  final: number[];
  /** Overlap frames per pair of positions [winner, loser]: the pairs that occur, most frames first. */
  pairs: { winner: number; loser: number; frames: number }[];
}

/** What `exclusiveLabels` does with these behaviors: how many frames overlap and who wins, and the final frame counts. */
export function overlapReport(
  behaviors: Uint8Array,
  frames: number,
  order: number[],
  other: boolean,
  scored?: Uint8Array,
): OverlapReport {
  const n = order.length;
  const won = new Array<number>(n).fill(0);
  const lost = new Array<number>(n).fill(0);
  const pair = new Map<string, number>();
  let labeled = 0;
  let overlapping = 0;
  for (let t = 0; t < frames; t++) {
    let winner = -1;
    for (let j = 0; j < n; j++) {
      if (!behaviors[order[j] * frames + t]) continue;
      if (winner < 0) {
        winner = j;
        won[j]++;
        labeled++;
      } else {
        lost[j]++;
        const key = `${winner},${j}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
    }
    if (winner >= 0 && n > 1) {
      let more = 0;
      for (let j = winner + 1; j < n; j++) more += behaviors[order[j] * frames + t];
      if (more) overlapping++;
    }
  }
  const labels = exclusiveLabels(behaviors, frames, order, other, scored);
  const final = new Array<number>(n + (other ? 1 : 0)).fill(0);
  for (const l of labels) if (l >= 0) final[l]++;
  const pairs = [...pair]
    .map(([k, f]) => ({ winner: +k.split(',')[0], loser: +k.split(',')[1], frames: f }))
    .sort((a, b) => b.frames - a.frames);
  return { labeled, overlapping, won, lost, final, pairs };
}

// ---- label shuffle -----------------------------------------------------------------------------

/** `_block_permutation`: the index order that permutes contiguous blocks of `block` frames, given the block order. */
export function blockPermutation(n: number, block: number, order: ArrayLike<number>): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < order.length; i++)
    for (let j = 0; j < block; j++) {
      const v = order[i] * block + j;
      if (v < n) out.push(v);
    }
  return Int32Array.from(out);
}

/** A random order of 0..n-1 (Fisher-Yates), from a uniform generator. */
export function randomOrder(n: number, rng: () => number): Int32Array {
  const a = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * `LabelShuffle`: the labels of the masked frames are cut into blocks of `block` frames (counted among the
 * masked frames) and the blocks are permuted; frames outside the mask keep their label. Neural data is
 * not touched. `order` is the block order (random when absent).
 */
export function labelShuffle(
  labels: Int32Array,
  mask: Uint8Array,
  block: number,
  rng: () => number,
  order?: ArrayLike<number>,
): Int32Array {
  const idx: number[] = [];
  for (let t = 0; t < labels.length; t++) if (mask[t]) idx.push(t);
  const out = labels.slice();
  if (!idx.length) return out;
  const b = Math.max(1, block);
  const perm = blockPermutation(
    idx.length,
    b,
    order ?? randomOrder(Math.ceil(idx.length / b), rng),
  );
  for (let i = 0; i < idx.length; i++) out[idx[i]] = labels[idx[perm[i]]];
  return out;
}
