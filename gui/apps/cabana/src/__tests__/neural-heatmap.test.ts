import { describe, expect, it } from 'vitest';
import { cellOrder, heatmapBins } from '../lib/neural-heatmap.ts';

const m = {
  // Two cells, six frames: a ramp, and one event at frame 4.
  data: new Float32Array([0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 7, 0]),
  cells: 2,
  frames: 6,
};

describe('heatmapBins', () => {
  it('averages each bin and scales each cell to its own range', () => {
    expect(Array.from(heatmapBins(m, 3, false))).toEqual([0, 0.5, 1, 0, 0, 1]);
  });
  it('keeps the largest value of a bin with peak', () => {
    const b = heatmapBins(
      { ...m, data: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0]) },
      2,
      true,
    );
    expect(Array.from(b.subarray(2))).toEqual([0, 1]);
  });
  it('never makes more bins than frames, and leaves a flat cell at 0', () => {
    const flat = { data: new Float32Array([3, 3]), cells: 1, frames: 2 };
    expect(Array.from(heatmapBins(flat, 10, false))).toEqual([0, 0]);
  });
});

describe('cellOrder', () => {
  it('orders by signal to noise, highest first, ties by number', () => {
    expect(cellOrder(4, 'snr', [2, 5, 5, 1])).toEqual([1, 2, 0, 3]);
    expect(cellOrder(3, 'cell')).toEqual([0, 1, 2]);
  });
});
