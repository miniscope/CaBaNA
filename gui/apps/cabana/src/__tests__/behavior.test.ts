import { describe, expect, it } from 'vitest';
import { annotationQc, dropShortBouts, mergeBouts, type Epoch } from '../lib/behavior.ts';

const ep = (label: string, start: number, stop: number): Epoch => ({
  label,
  start,
  stop,
  flags: [],
  notes: [],
});
const TOL = { annotPct: 5, minBoutS: 0.25, mergeGapS: 0.5 };

describe('annotations', () => {
  it('merges bouts of one label that overlap or are close, and leaves other labels alone', () => {
    const { epochs, merged } = mergeBouts(
      [ep('a', 0, 2), ep('a', 1.5, 3), ep('a', 3.3, 4), ep('a', 6, 7), ep('b', 2.1, 2.5)],
      0.5,
    );
    expect(merged).toBe(2);
    expect(epochs.filter((e) => e.label === 'a').map((e) => [e.start, e.stop])).toEqual([
      [0, 4],
      [6, 7],
    ]);
    expect(epochs.filter((e) => e.label === 'b')).toHaveLength(1);
  });

  it('removes bouts shorter than the minimum', () => {
    const { epochs, removed } = dropShortBouts([ep('a', 0, 0.1), ep('a', 1, 2)], 0.25);
    expect(removed).toBe(1);
    expect(epochs).toHaveLength(1);
  });

  it('treats overlap as a note about one bout, not an error', () => {
    const eps = [
      ep('a', 0, 2),
      ep('a', 1, 3),
      ep('a', 10, 12),
      ep('a', 20, 22),
      ep('a', 30, 32),
      ep('a', 40, 42),
    ];
    const checks = Object.fromEntries(annotationQc(eps, 60, TOL).map((c) => [c.id, c.status]));
    expect(checks['ann-total']).toBe('pass');
    expect(checks['ann-merge']).toBe('warn');
  });

  it('uses the thresholds the user sets', () => {
    const eps = [ep('a', 0, 1), ep('a', 1.8, 3)];
    const at = (mergeGapS: number) =>
      annotationQc(
        eps.map((e) => ({ ...e })),
        60,
        { ...TOL, mergeGapS },
      ).find((c) => c.id === 'ann-merge')!.status;
    expect(at(0.5)).toBe('pass');
    expect(at(1)).toBe('warn');
  });
});
