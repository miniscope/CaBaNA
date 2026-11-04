import { describe, expect, it } from 'vitest';
import { pairUnavailable } from '../lib/auroc-view.ts';

describe('auROC comparison choices', () => {
  it('says why another behavior is unavailable', () => {
    expect(pairUnavailable(['investigate_empty'])).toBe(
      'Needs two behaviors; this file has one: investigate_empty.',
    );
    expect(pairUnavailable([])).toMatch(/has none/);
    expect(pairUnavailable(['a', 'b'])).toBeUndefined();
  });
});
