// Marks of the session navigator: flagged times and user corrections as percent of the session.

/** A mark on the session navigator: where (percent of the session) and what it marks. */
export interface Tick {
  left: number;
  kind: 'flag' | 'correction';
}

/**
 * Navigator marks for flagged times (amber) and user corrections (blue), as percent of the
 * session. Times outside the session are dropped, and marks closer than `minPct` merge into one.
 */
export function navTicks(
  flagged: number[],
  corrected: number[],
  [t0, t1]: [number, number],
  minPct = 0.4,
): Tick[] {
  const out: Tick[] = [];
  const add = (times: number[], kind: Tick['kind']) => {
    let last = -Infinity;
    for (const t of [...times].filter(Number.isFinite).sort((a, b) => a - b)) {
      const left = (100 * (t - t0)) / (t1 - t0 || 1);
      if (left < 0 || left > 100 || left - last < minPct) continue;
      out.push({ left, kind });
      last = left;
    }
  };
  add(flagged, 'flag');
  add(corrected, 'correction');
  return out;
}
