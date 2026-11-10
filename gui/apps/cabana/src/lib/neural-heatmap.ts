// The overview heatmap of one neural file: every cell's values in time bins, each cell scaled to
// its own range so that cells of different brightness can be compared by their timing. Display
// only; nothing here feeds an analysis.

import type { Matrix } from './parse.ts';

/**
 * Each cell's values in `bins` equal time bins, scaled 0..1 between that cell's lowest and highest
 * bin. A bin is the mean of its frames, or with `peak` its largest value, so that single events
 * stay visible. Row-major: cell * bins + bin. A flat cell is all 0.
 */
export function heatmapBins(m: Matrix, bins: number, peak: boolean): Float32Array {
  const n = Math.max(1, Math.min(bins, m.frames));
  const out = new Float32Array(m.cells * n);
  for (let c = 0; c < m.cells; c++) {
    const row = out.subarray(c * n, (c + 1) * n);
    for (let b = 0; b < n; b++) {
      const t0 = Math.floor((b * m.frames) / n);
      const t1 = Math.max(t0 + 1, Math.floor(((b + 1) * m.frames) / n));
      let acc = peak ? -Infinity : 0;
      let k = 0;
      for (let t = t0; t < t1; t++) {
        const v = m.data[c * m.frames + t];
        if (!Number.isFinite(v)) continue;
        acc = peak ? Math.max(acc, v) : acc + v;
        k++;
      }
      row[b] = k ? (peak ? acc : acc / k) : NaN;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of row) if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    for (let b = 0; b < n; b++)
      row[b] = hi > lo && Number.isFinite(row[b]) ? (row[b] - lo) / (hi - lo) : 0;
  }
  return out;
}

export type CellSort = 'cell' | 'snr';

/** Cell order for the rows: by number, or by signal to noise, highest first. */
export function cellOrder(cells: number, by: CellSort, snr?: number[]): number[] {
  const order = Array.from({ length: cells }, (_, c) => c);
  if (by === 'snr' && snr?.length === cells)
    order.sort((a, b) => (snr[b] ?? -Infinity) - (snr[a] ?? -Infinity) || a - b);
  return order;
}
