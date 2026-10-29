// Cross-validation folds for the fold strip on the session timeline. Display only: the framework
// makes the folds. These are the same equal contiguous blocks (`contiguous_folds`: fold i holds
// frames floor(i*n/k) up to floor((i+1)*n/k)), checked against Python in tests.

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

export function foldSpans(n: number, k: number, fs: number, gapS: number): FoldSpan[] {
  const b = foldBoundaries(n, k);
  return Array.from({ length: k }, (_, fold) => {
    const startS = b[fold] / fs;
    const stopS = b[fold + 1] / fs;
    return {
      fold,
      startS,
      stopS,
      gapBeforeS: [Math.max(0, startS - gapS), startS],
      gapAfterS: [stopS, Math.min(n / fs, stopS + gapS)],
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
