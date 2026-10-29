// Speed-matched circular-shift null, following `covariate_matched_shift` in the CaBaNA framework
// (commit 57c0c4b). Candidate shifts are drawn like a plain circular shift; a candidate k is kept
// only if, for every behavior with enough included frames, the speed the shifted neural data
// comes from, speed[(t - k) mod n], is distributed like the original speed during the behavior.
// It does not change the auROC calculation, only which shifts form the null.

export interface MatchOptions {
  /** `ks`: two-sample Kolmogorov-Smirnov distance. `mean`: |difference of means| / pooled SD. */
  statistic: 'ks' | 'mean';
  /** Largest allowed statistic in every matched behavior. */
  tolerance: number;
  /** Candidates tried per requested shift before giving up. */
  maxTries: number;
  /** Behaviors with fewer included frames are not matched. */
  minFrames: number;
}

/** Framework starting values. They are the framework's defaults, not validated standards. */
export const DEFAULT_MATCH: MatchOptions = {
  statistic: 'ks',
  tolerance: 0.1,
  maxTries: 20,
  minFrames: 50,
};

/** Missing speed values become the median of the finite ones. */
export function fillMissing(speed: ArrayLike<number>): Float64Array {
  const finite = Array.from(speed).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) throw new Error('The speed signal has no finite values.');
  const mid = finite.length >> 1;
  const median = finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
  return Float64Array.from(speed, (v) => (Number.isFinite(v) ? v : median));
}

/** Included frames of each behavior with at least `minFrames` of them; the others are not matched. */
export function matchGroups(
  behaviors: Uint8Array,
  nBehaviors: number,
  mask: Uint8Array,
  minFrames: number,
): { groups: Int32Array[]; matched: boolean[] } {
  const frames = mask.length;
  const groups: Int32Array[] = [];
  const matched: boolean[] = [];
  for (let b = 0; b < nBehaviors; b++) {
    const idx: number[] = [];
    for (let t = 0; t < frames; t++) if (behaviors[b * frames + t] && mask[t]) idx.push(t);
    matched.push(idx.length >= minFrames);
    if (idx.length >= minFrames) groups.push(Int32Array.from(idx));
  }
  return { groups, matched };
}

/** `_ks_stat`: maximum distance between the empirical CDFs of two sorted samples. */
export function ksStat(a: Float64Array, b: Float64Array): number {
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < a.length || j < b.length) {
    const v = Math.min(i < a.length ? a[i] : Infinity, j < b.length ? b[j] : Infinity);
    while (i < a.length && a[i] === v) i++; // CDF at v counts every value <= v
    while (j < b.length && b[j] === v) j++;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  return d;
}

const meanVar = (x: Float64Array): [number, number] => {
  const m = x.reduce((s, v) => s + v, 0) / x.length;
  return [m, x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length];
};

/** `_stat_matrix` for one shift: the balance statistic of each matched behavior. */
export function balanceOf(
  speed: Float64Array,
  groups: Int32Array[],
  shift: number,
  statistic: MatchOptions['statistic'],
): Float64Array {
  const n = speed.length;
  return Float64Array.from(groups, (idx) => {
    const obs = Float64Array.from(idx, (t) => speed[t]);
    const shifted = Float64Array.from(idx, (t) => speed[(((t - shift) % n) + n) % n]);
    if (statistic === 'ks') return ksStat(obs.sort(), shifted.sort());
    const [mo, vo] = meanVar(obs);
    const [ms, vs] = meanVar(shifted);
    const sd = Math.sqrt((vo + vs) / 2);
    const diff = Math.abs(ms - mo);
    return sd > 0 ? diff / sd : diff === 0 ? 0 : Infinity;
  });
}

export interface MatchedDraw {
  shifts: Int32Array;
  /** Number of different shifts that passed. */
  unique: number;
  candidates: number;
  acceptanceRate: number;
  /** Largest statistic over the accepted shifts and behaviors. */
  balanceMax: number;
  /** Mean over accepted shifts of the worst behavior's statistic. */
  balanceMean: number;
  /** True when fewer shifts passed than requested and accepted ones were reused. */
  reused: boolean;
}

/**
 * `CovariateMatchedShift.draw`, given the candidates in the order they are tried (a random
 * permutation of the allowed shifts). Stops when `n` are accepted or `n * maxTries` candidates
 * (or all of them) have been tried. If some but not enough pass and every candidate was tried,
 * accepted shifts are reused to fill `n`; otherwise it throws. It never falls back to an
 * unmatched null.
 */
export function acceptShifts(
  speed: Float64Array,
  groups: Int32Array[],
  order: ArrayLike<number>,
  n: number,
  opts: MatchOptions,
  rng: () => number,
): MatchedDraw {
  const budget = Math.min(order.length, n * opts.maxTries);
  const kept: number[] = [];
  const worst: number[] = [];
  let examined = 0;
  while (kept.length < n && examined < budget) {
    const k = order[examined++];
    const w = Math.max(...balanceOf(speed, groups, k, opts.statistic));
    if (w <= opts.tolerance) {
      kept.push(k);
      worst.push(w);
    }
  }
  const rate = kept.length / Math.max(examined, 1);
  const unique = kept.length;
  if (unique < n) {
    const exhausted = order.length <= n * opts.maxTries && unique > 0;
    if (!exhausted)
      throw new Error(
        `Speed matching accepted ${unique} of ${examined} candidate shifts (acceptance rate ` +
          `${rate.toPrecision(3)}); ${n} are needed within ${opts.maxTries} candidates per shift. ` +
          'Loosen the tolerance, use the difference in means, lower the minimum frames, or raise the candidate count.',
      );
    for (let i = unique; i < n; i++) {
      const j = Math.floor(rng() * unique);
      kept.push(kept[j]);
      worst.push(worst[j]);
    }
  }
  return {
    shifts: Int32Array.from(kept),
    unique,
    candidates: examined,
    acceptanceRate: rate,
    balanceMax: Math.max(...worst),
    balanceMean: worst.reduce((s, v) => s + v, 0) / worst.length,
    reused: unique < n,
  };
}

/** A random order of the allowed shifts, minShift .. nTime - minShift (clamped as in `draw_shifts`). */
export function candidateOrder(nTime: number, minShift: number, rng: () => number): Int32Array {
  if (nTime < 4) throw new Error('need at least 4 frames to shuffle');
  const lo = Math.max(1, Math.min(minShift, Math.floor((nTime - 1) / 2)));
  const order = Int32Array.from({ length: nTime - 2 * lo + 1 }, (_, i) => lo + i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
