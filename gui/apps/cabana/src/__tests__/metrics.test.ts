import { describe, expect, it } from 'vitest';
import { denomText, percentText, qcCounts } from '../lib/metrics.ts';

describe('summary counts', () => {
  it('states the denominator', () => {
    expect(denomText(12, 148, 'cells evaluated', 'for investigate_partner')).toBe(
      '12 of 148 cells evaluated for investigate_partner',
    );
    expect(denomText(1200, 17872, 'frames')).toBe('1,200 of 17,872 frames');
    expect(percentText(1, 3)).toBe('33%');
    expect(percentText(0, 0)).toBe('–');
  });

  it('counts failed tests and checks the same way for both QC pages', () => {
    const p = { status: 'pass' as const };
    const f = { status: 'fail' as const };
    const w = { status: 'warn' as const };
    const c = qcCounts([
      [p, p],
      [p, f, f, p],
      [p, p],
      [p, w, p],
    ]);
    expect(c.text).toBe('1 of 4 tests failed · 2 of 11 checks · 1 with notes');
    expect([c.tests, c.testsFailed, c.checks, c.checksFailed]).toEqual([4, 1, 11, 2]);
    expect(
      qcCounts([
        [p, p],
        [p, p, p, p],
        [p, p, p],
      ]).text,
    ).toBe('All 3 tests passed · 9 checks');
  });
});
