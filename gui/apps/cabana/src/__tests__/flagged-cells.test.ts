import { describe, expect, it } from 'vitest';
import { eventCount, stepFlagged } from '../lib/cells.ts';

describe('stepFlagged', () => {
  const flagged = [30, 4, 17];
  it('goes to the next and previous flagged cell', () => {
    expect(stepFlagged(flagged, 4, 1)).toBe(17);
    expect(stepFlagged(flagged, 17, -1)).toBe(4);
  });
  it('works from a cell that is not flagged', () => {
    expect(stepFlagged(flagged, 10, 1)).toBe(17);
    expect(stepFlagged(flagged, 10, -1)).toBe(4);
  });
  it('is undefined past either end', () => {
    expect(stepFlagged(flagged, 30, 1)).toBeUndefined();
    expect(stepFlagged(flagged, 4, -1)).toBeUndefined();
    expect(stepFlagged([], 0, 1)).toBeUndefined();
  });
});

describe('eventCount', () => {
  it('turns the fraction of frames back into a count', () => {
    expect(eventCount(0.05, 2000)).toBe(100);
    expect(eventCount(0, 2000)).toBe(0);
    expect(eventCount(NaN, 2000)).toBeUndefined();
  });
});
