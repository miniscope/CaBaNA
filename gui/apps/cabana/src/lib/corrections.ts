// Corrections CaBaNA can make itself, using the framework's functions
// (framework.ts). Each returns a new table and a count, and leaves the original
// alone so it can be restored. Lost frames are NaN while a function runs.

import { interpolateGaps, smoothSignal } from './framework.ts';
import type { Table } from './parse.ts';

const col = (t: Table, name: string) => t.columns.findIndex((c) => c.toLowerCase() === name);

function readXY(t: Table) {
  const [ix, iy] = [col(t, 'x'), col(t, 'y')];
  if (ix < 0 || iy < 0) throw new Error('The position file needs x and y columns.');
  const x = t.rows.map((r) => Number(r[ix]));
  const y = t.rows.map((r) => Number(r[iy]));
  const lost = x.map((v, i) => !Number.isFinite(v + y[i]) || (v === -1 && y[i] === -1));
  return { ix, iy, x, y, lost };
}

function withXY(
  t: Table,
  ix: number,
  iy: number,
  x: number[],
  y: number[],
  lost: boolean[],
): Table {
  return {
    columns: t.columns,
    rows: t.rows.map((r, i) => {
      const out = r.slice();
      out[ix] = lost[i] ? '-1' : x[i].toFixed(4);
      out[iy] = lost[i] ? '-1' : y[i].toFixed(4);
      return out;
    }),
  };
}

const nanOut = (v: number[], lost: boolean[]) => v.map((a, i) => (lost[i] ? NaN : a));

/** `smooth_signal` (median) on x and y: a position far from the median of its neighbors is pulled back, which removes jumps. `windowS` is the full window, `fps` the camera rate. */
export function medianSmoothPosition(
  t: Table,
  windowS: number,
  fps: number,
): { table: Table; changed: number } {
  const { ix, iy, x, y, lost } = readXY(t);
  const sx = smoothSignal(nanOut(x, lost), fps, 'median', windowS);
  const sy = smoothSignal(nanOut(y, lost), fps, 'median', windowS);
  const changed = x.filter((v, i) => !lost[i] && (sx[i] !== v || sy[i] !== y[i])).length;
  return { table: withXY(t, ix, iy, Array.from(sx), Array.from(sy), lost), changed };
}

/** `interpolate_gaps` (linear) on x and y: lost stretches of at most `maxGapS` seconds with tracked frames on both sides are filled. */
export function fillPositionGaps(
  t: Table,
  maxGapS: number,
  fps: number,
): { table: Table; changed: number } {
  const { ix, iy, x, y, lost } = readXY(t);
  const fx = interpolateGaps(nanOut(x, lost), fps, maxGapS);
  const fy = interpolateGaps(nanOut(y, lost), fps, maxGapS);
  const nl = lost.map((_, i) => Number.isNaN(fx.out[i]) || Number.isNaN(fy.out[i]));
  return {
    table: withXY(t, ix, iy, Array.from(fx.out), Array.from(fy.out), nl),
    changed: fx.filled,
  };
}
