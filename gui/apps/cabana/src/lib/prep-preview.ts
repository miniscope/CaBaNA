// Helpers for the Position and Behavior Preprocess previews. Pure.

/** The frame range [start, end) of `seconds` with the most lost frames; the first one when none are lost. */
export function worstWindow(
  lost: ArrayLike<boolean | number>,
  fs: number,
  seconds: number,
): { start: number; end: number; lost: number } {
  const n = lost.length;
  const w = Math.min(n, Math.max(1, Math.round(seconds * fs)));
  let count = 0;
  for (let i = 0; i < w; i++) count += lost[i] ? 1 : 0;
  let best = { start: 0, end: w, lost: count };
  for (let i = w; i < n; i++) {
    count += (lost[i] ? 1 : 0) - (lost[i - w] ? 1 : 0);
    if (count > best.lost) best = { start: i - w + 1, end: i + 1, lost: count };
  }
  return best;
}

/** Percent more frames counted as the behavior once bouts are padded. 0 when none are scored. */
export function paddedGainPct(scored: number, padded: number): number {
  return scored > 0 ? (100 * (padded - scored)) / scored : 0;
}

/** Runs of true frames inside [lo, hi), as [start, end) frame pairs. */
export function maskRuns(mask: ArrayLike<boolean>, lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = lo; i <= hi; i++) {
    const on = i < hi && !!mask[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}
