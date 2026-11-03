// Cross-validation folds for the fold strip on the session timeline. Display only: the engine
// makes the folds. These are the same equal contiguous blocks of the frames the engine uses
// (`contiguous_folds`: fold i holds used frames floor(i*n/k) up to floor((i+1)*n/k)), checked
// against Python in tests.

/** First frame of every fold, plus the end: `k + 1` boundaries. */
export function foldBoundaries(n: number, k: number): number[] {
  // smallest frame f with floor(f * k / n) >= i is ceil(i * n / k)
  return Array.from({ length: k + 1 }, (_, i) => Math.min(n, Math.ceil((i * n) / k)));
}

export interface FoldSpan {
  fold: number;
  startS: number;
  stopS: number;
  /** Training frames within the gap on each side of the fold are left out (framework F1). */
  gapBeforeS: [number, number];
  gapAfterS: [number, number];
}

/**
 * Each fold's span on the session timeline. `times` are the session times of the frames the
 * engine folds, in order; a fold runs from its first frame to the end of its last. Frames the
 * engine leaves out fall between folds or inside a fold's span.
 */
export function foldSpans(
  times: ArrayLike<number>,
  stepS: number,
  totalS: number,
  k: number,
  gapS: number,
): FoldSpan[] {
  const b = foldBoundaries(times.length, k);
  return Array.from({ length: k }, (_, fold) => {
    const startS = times[b[fold]];
    const stopS = times[b[fold + 1] - 1] + stepS;
    return {
      fold,
      startS,
      stopS,
      gapBeforeS: [Math.max(0, startS - gapS), startS],
      gapAfterS: [stopS, Math.min(totalS, stopS + gapS)],
    };
  });
}

/** (n, k) pairs the Python parity test checks. */
export const FOLD_CASES: [number, number][] = [
  [18000, 5],
  [17872, 5],
  [1000, 3],
  [7, 2],
  [100, 10],
];
