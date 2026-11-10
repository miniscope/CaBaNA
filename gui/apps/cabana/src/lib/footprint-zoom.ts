// The zoomed footprint beside a cell's traces: a window around the selected cell, and which pixels
// of each cell in that window are its footprint. A pixel belongs to a cell's footprint when it is
// at least `MASK` of that cell's brightest pixel. Display only.

import type { Footprints } from './parse.ts';

export const MASK = 0.2;

/** Each cell's brightest footprint pixel. */
export function cellPeaks(f: Footprints): Float32Array {
  const n = f.height * f.width;
  const out = new Float32Array(f.cells);
  for (let c = 0; c < f.cells; c++) {
    let hi = 0;
    for (let i = c * n; i < (c + 1) * n; i++) if (f.data[i] > hi) hi = f.data[i];
    out[c] = hi;
  }
  return out;
}

export interface Crop {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** A square window around a cell's footprint with `margin` pixels on each side, inside the image. */
export function cropAround(f: Footprints, c: number, peak: number, margin: number): Crop {
  const n = f.height * f.width;
  let [x0, y0, x1, y1] = [f.width, f.height, -1, -1];
  for (let i = 0; i < n; i++)
    if (peak > 0 && f.data[c * n + i] >= MASK * peak) {
      const x = i % f.width;
      const y = Math.floor(i / f.width);
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  if (x1 < 0) return { x0: 0, y0: 0, w: f.width, h: f.height };
  const side = Math.min(Math.max(f.width, f.height), Math.max(x1 - x0, y1 - y0) + 1 + 2 * margin);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const clamp = (v: number, size: number) =>
    Math.max(0, Math.min(size - Math.min(side, size), Math.round(v - side / 2)));
  return {
    x0: clamp(cx, f.width),
    y0: clamp(cy, f.height),
    w: Math.min(side, f.width),
    h: Math.min(side, f.height),
  };
}

/** Whether pixel (x, y) is in cell c's footprint. */
export const inMask = (f: Footprints, c: number, peak: number, x: number, y: number): boolean =>
  peak > 0 && f.data[c * f.height * f.width + y * f.width + x] >= MASK * peak;
