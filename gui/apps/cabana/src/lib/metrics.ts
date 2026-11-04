// Counts for summary cards and QC summaries, worded so the denominator is always stated.

/** "12 of 148 cells" or "12 of 148 cells evaluated for investigate_partner". */
export function denomText(n: number, total: number, unit: string, scope?: string): string {
  return `${n.toLocaleString()} of ${total.toLocaleString()} ${unit}${scope ? ` ${scope}` : ''}`;
}

/** Share as a whole percent, or "–" with nothing to divide by. */
export const percentText = (n: number, total: number) =>
  total > 0 ? `${Math.round((100 * n) / total)}%` : '–';

export interface QcCounts {
  tests: number;
  testsFailed: number;
  checks: number;
  checksFailed: number;
  /** Checks that passed with a note (warn), counted apart from failures. */
  checksNoted: number;
  text: string;
}

/**
 * Tests and checks counted the same way on Behavioral and Neural QC: a test fails when any of its
 * checks fails. "1 of 4 tests failed · 2 of 11 checks", or "All 3 tests passed · 9 checks".
 */
export function qcCounts(tests: { status: 'pass' | 'warn' | 'fail' }[][]): QcCounts {
  const all = tests.flat();
  const testsFailed = tests.filter((t) => t.some((c) => c.status === 'fail')).length;
  const checksFailed = all.filter((c) => c.status === 'fail').length;
  const checksNoted = all.filter((c) => c.status === 'warn').length;
  const noted = checksNoted ? ` · ${checksNoted} with notes` : '';
  const text = testsFailed
    ? `${testsFailed} of ${tests.length} ${tests.length === 1 ? 'test' : 'tests'} failed · ${checksFailed} of ${all.length} checks${noted}`
    : `${tests.length === 1 ? 'The test' : `All ${tests.length} tests`} passed · ${all.length} checks${noted}`;
  return { tests: tests.length, testsFailed, checks: all.length, checksFailed, checksNoted, text };
}
