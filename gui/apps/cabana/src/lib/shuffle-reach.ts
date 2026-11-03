// Whether a shuffle test can mark anything significant. With n shuffles the smallest p-value is
// 1/(n+1), and every analysis marks p < alpha. Max-stat adjusted p-values are never below the
// raw ones and reach the same minimum, so the bound is the same with or without correction.

import { shufflesFor } from './preview.ts';

/** Smallest shuffle count whose smallest p-value, 1/(n+1), is below `alpha`. */
export const shufflesNeeded = (alpha: number) => Math.floor(1 / alpha - 1 + 1e-9) + 1;

/** Why `n` shuffles cannot reach `alpha`, or undefined when they can. */
export function shuffleReachIssue(n: number, alpha: number, run = 'The run'): string | undefined {
  if (!(n >= 1) || !(alpha > 0 && alpha < 1) || 1 / (n + 1) < alpha) return undefined;
  return (
    `${run} uses ${n} shuffles, so its smallest p-value is 1/${n + 1} = ${(1 / (n + 1)).toFixed(3)}, ` +
    `not below α = ${alpha}: nothing can be marked significant. ` +
    `Use at least ${shufflesNeeded(alpha)} shuffles or a larger α.`
  );
}

/** The issues for the full run and the Quick preview of a test set to `full` shuffles. */
export function shuffleReachIssues(full: number, alpha: number, preview = true): string[] {
  const out = [shuffleReachIssue(full, alpha)];
  const p = shufflesFor('preview', full);
  if (preview && p !== full) out.push(shuffleReachIssue(p, alpha, 'Quick preview'));
  return out.filter((s): s is string => !!s);
}
