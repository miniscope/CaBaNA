// A window of a loaded file's values, for the Data table view on the Data setup page: the rows of a
// table as read, or a block of cells x frames of an array. The values are shown as loaded, before
// any preprocessing.

import type { Matrix, Table } from './parse.ts';

export interface DataWindow {
  /** Column headings, the first one naming the row label. */
  columns: string[];
  rows: { index: number; label: string; values: string[] }[];
  /** Rows in the whole file (cells for an array). */
  total: number;
}

const clampStart = (start: number, total: number, n: number) =>
  Math.max(0, Math.min(Math.floor(start), Math.max(0, total - n)));

/** Rows `start` to `start + n - 1` of a table, every column as text. */
export function tableWindow(t: Table, start: number, n: number): DataWindow {
  const a = clampStart(start, t.rows.length, n);
  return {
    columns: ['row', ...t.columns],
    rows: t.rows.slice(a, a + n).map((r, k) => ({ index: a + k, label: String(a + k), values: r })),
    total: t.rows.length,
  };
}

/** Cells `cell` to `cell + nCells - 1` and frames `frame` to `frame + nFrames - 1` of an array. */
export function matrixWindow(
  m: Matrix,
  cell: number,
  nCells: number,
  frame: number,
  nFrames: number,
): DataWindow {
  const c0 = clampStart(cell, m.cells, nCells);
  const f0 = clampStart(frame, m.frames, nFrames);
  const nf = Math.min(nFrames, m.frames - f0);
  const fmt = (v: number) => (Number.isFinite(v) ? v.toPrecision(4) : String(v));
  return {
    columns: ['cell', ...Array.from({ length: nf }, (_, k) => `frame ${f0 + k}`)],
    rows: Array.from({ length: Math.min(nCells, m.cells - c0) }, (_, k) => {
      const c = c0 + k;
      const row = m.data.subarray(c * m.frames + f0, c * m.frames + f0 + nf);
      return { index: c, label: String(c), values: Array.from(row, fmt) };
    }),
    total: m.cells,
  };
}
