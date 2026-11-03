import { describe, expect, it } from 'vitest';
import { shuffleReachIssue, shuffleReachIssues, shufflesNeeded } from '../lib/shuffle-reach.ts';

describe('shuffle count against alpha', () => {
  it('needs 1/(n+1) below alpha, as every analysis marks p < alpha', () => {
    expect(shufflesNeeded(0.05)).toBe(20);
    expect(shufflesNeeded(0.01)).toBe(100);
    expect(shufflesNeeded(0.001)).toBe(1000);
    for (const a of [0.05, 0.01, 0.003, 0.2]) {
      const n = shufflesNeeded(a);
      expect(1 / (n + 1)).toBeLessThan(a);
      expect(1 / n).toBeGreaterThanOrEqual(a);
    }
  });
  it('flags 19 shuffles at 0.05 and the old Preliminary minimum of 10', () => {
    expect(shuffleReachIssue(19, 0.05)).toMatch(/1\/20 = 0.050/);
    expect(shuffleReachIssue(10, 0.05)).toMatch(/at least 20 shuffles/);
    expect(shuffleReachIssue(20, 0.05)).toBeUndefined();
  });
  it('checks the Quick preview at its executed count', () => {
    // full run of 1000 reaches 0.01; the 50-shuffle preview cannot
    const issues = shuffleReachIssues(1000, 0.01);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Quick preview uses 50 shuffles/);
    expect(shuffleReachIssues(1000, 0.05)).toEqual([]);
  });
});
