// Windows of a loaded file for the Data table view.

import { describe, expect, it } from 'vitest';
import { matrixWindow, tableWindow } from '../lib/data-window.ts';

describe('data window', () => {
  const t = {
    columns: ['frame', 'x', 'y'],
    rows: Array.from({ length: 30 }, (_, i) => [`${i}`, `${i * 2}`, '-1']),
  };

  it('returns table rows as read, kept inside the file', () => {
    const w = tableWindow(t, 5, 4);
    expect(w.columns).toEqual(['row', 'frame', 'x', 'y']);
    expect(w.rows.map((r) => r.index)).toEqual([5, 6, 7, 8]);
    expect(w.rows[0].values).toEqual(['5', '10', '-1']);
    expect(tableWindow(t, 100, 4).rows[0].index).toBe(26);
    expect(tableWindow(t, -3, 4).rows[0].index).toBe(0);
    expect(w.total).toBe(30);
  });

  it('returns a block of cells x frames from a cells-by-frames array', () => {
    const m = { cells: 3, frames: 5, data: Float32Array.from({ length: 15 }, (_, i) => i) };
    const w = matrixWindow(m, 1, 2, 3, 4);
    expect(w.columns).toEqual(['cell', 'frame 1', 'frame 2', 'frame 3', 'frame 4']);
    expect(w.rows.map((r) => r.label)).toEqual(['1', '2']);
    expect(w.rows[0].values).toEqual(['6.000', '7.000', '8.000', '9.000']);
    expect(w.total).toBe(3);
  });
});
