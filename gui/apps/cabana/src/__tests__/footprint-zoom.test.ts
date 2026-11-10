import { describe, expect, it } from 'vitest';
import { cellPeaks, cropAround, inMask } from '../lib/footprint-zoom.ts';

// Two cells on a 10 x 10 image: cell 0 at (2..3, 2..3), cell 1 one pixel at (8, 8).
const f = { data: new Float32Array(200), cells: 2, height: 10, width: 10 };
for (const [x, y] of [
  [2, 2],
  [3, 2],
  [2, 3],
  [3, 3],
])
  f.data[y * 10 + x] = 4;
f.data[100 + 8 * 10 + 8] = 1;

describe('footprint zoom', () => {
  it('finds each cell peak and its mask', () => {
    const p = cellPeaks(f);
    expect(Array.from(p)).toEqual([4, 1]);
    expect(inMask(f, 0, p[0], 3, 3)).toBe(true);
    expect(inMask(f, 0, p[0], 4, 3)).toBe(false);
  });
  it('crops a square around the cell, kept inside the image', () => {
    expect(cropAround(f, 0, 4, 1)).toEqual({ x0: 1, y0: 1, w: 4, h: 4 });
    expect(cropAround(f, 1, 1, 3)).toEqual({ x0: 3, y0: 3, w: 7, h: 7 });
  });
});
