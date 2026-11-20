import { describe, expect, it } from 'vitest';
import { halfRangeOf, shownHalfRange } from '../lib/auroc-population.ts';
import { selectedCoverage, TILING_COVERAGE } from '../lib/auroc-setup.ts';

describe('halfRangeOf', () => {
  it('fits the scale to frame-wise auROC of sparse data', () => {
    expect(halfRangeOf([0.41, 0.5, 0.583, NaN])).toBe(0.09);
  });
  it('never drops below 0.01 or above 0.5', () => {
    expect(halfRangeOf([0.5, 0.5])).toBe(0.01);
    expect(halfRangeOf([0, 1])).toBe(0.5);
  });
});

describe('shownHalfRange', () => {
  it('fits the scale when on and spans 0 to 1 when off', () => {
    expect(shownHalfRange([0.41, 0.583], true)).toBe(0.09);
    expect(shownHalfRange([0.41, 0.583], false)).toBe(0.5);
  });
});

describe('selectedCoverage', () => {
  // 10 frames, 3 zones that tile the session (center 0-1, open 2-4, closed 5-9)
  const frames = 10;
  const behaviors = new Uint8Array(3 * frames);
  [0, 1].forEach((t) => (behaviors[t] = 1));
  [2, 3, 4].forEach((t) => (behaviors[frames + t] = 1));
  [5, 6, 7, 8, 9].forEach((t) => (behaviors[2 * frames + t] = 1));
  const data = {
    behaviors,
    frames,
    mask: new Uint8Array(frames).fill(1),
    labels: ['center', 'open', 'closed'],
  };

  it('flags behaviors that tile the session', () => {
    expect(selectedCoverage(data, [])).toBe(1);
    expect(selectedCoverage(data, [])).toBeGreaterThanOrEqual(TILING_COVERAGE);
  });
  it('drops unselected behaviors and excluded frames', () => {
    expect(selectedCoverage(data, ['closed'])).toBe(0.5);
    const mask = new Uint8Array(frames).fill(1);
    mask.fill(0, 5);
    expect(selectedCoverage({ ...data, mask }, ['closed'])).toBe(1);
  });
});
