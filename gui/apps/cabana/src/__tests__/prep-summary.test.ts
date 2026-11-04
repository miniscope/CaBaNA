import { describe, expect, it } from 'vitest';
import { prepSummary } from '../lib/prep-summary.ts';

const N = NaN;

describe('prepSummary', () => {
  it('counts filled frames and valid position before and after', () => {
    const rx = [0, N, N, 3, N, 5];
    // frames 1 and 2 are filled; frame 4 stays missing; smoothing leaves missing frames missing
    const x = [0, 1, 2, 3, N, 5];
    const s = prepSummary({
      rx,
      ry: rx,
      x,
      y: x,
      sx: x,
      sy: x,
      speedBefore: [N, 4, 9, 2, N, 1],
      speedAfter: [N, 3, 5, 2, N, 1],
    });
    expect(s).toEqual({
      frames: 6,
      framesFilled: 2,
      validBefore: 3,
      validAfter: 5,
      peakSpeedBefore: 9,
      peakSpeedAfter: 5,
    });
  });

  it('counts a frame missing in only x or y as missing', () => {
    const s = prepSummary({
      rx: [1, 2],
      ry: [1, N],
      x: [1, 2],
      y: [1, N],
      sx: [1, 2],
      sy: [1, N],
      speedBefore: [],
      speedAfter: [],
    });
    expect(s.validBefore).toBe(1);
    expect(s.framesFilled).toBe(0);
  });

  it('has no peak speed when every speed is missing', () => {
    const e = [N, N];
    const s = prepSummary({
      rx: e,
      ry: e,
      x: e,
      y: e,
      sx: e,
      sy: e,
      speedBefore: e,
      speedAfter: e,
    });
    expect(s.peakSpeedBefore).toBeUndefined();
    expect(s.peakSpeedAfter).toBeUndefined();
    expect(s.validAfter).toBe(0);
  });
});
