import { describe, expect, it } from 'vitest';
import { readMatrix, type Matrix } from '../lib/parse.ts';
import { eventTriggered, fitLine, pveByCell, reconvolve } from '../lib/decon.ts';

/** A float32 .npy file, written the way NumPy does for a transposed array when `fortran` is true. */
function npy(values: number[], shape: number[], fortran: boolean): File {
  const header = `{'descr': '<f4', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': (${shape.join(', ')}), }`;
  const padded = header.padEnd(Math.ceil((header.length + 11) / 64) * 64 - 11, ' ') + '\n';
  const head = new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, padded.length, 0]);
  return new File([head, padded, new Float32Array(values)], 'x.npy');
}

describe('readMatrix', () => {
  it('reads a 2 x 3 array in row order', async () => {
    const { matrix } = await readMatrix(npy([1, 2, 3, 4, 5, 6], [2, 3], false));
    expect(Array.from(matrix.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('puts a Fortran-order file back in row order', async () => {
    // [[1,2,3],[4,5,6]] stored column by column
    const { matrix } = await readMatrix(npy([1, 4, 2, 5, 3, 6], [2, 3], true));
    expect(Array.from(matrix.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('deconvolution checks', () => {
  const frames = 600;
  const fs = 30;
  const events: Matrix = { data: new Float32Array(frames), cells: 1, frames };
  [30, 120, 125, 300, 420, 421, 500].forEach((t) => (events.data[t] = 1));
  // Calcium made from the same events, tau 0.5 s, no rise.
  const calcium = reconvolve(events.data, 0, frames, fs, 0, 0.5);
  const trace: Matrix = { data: Float32Array.from(calcium, (v) => 3 * v + 1), cells: 1, frames };

  it('explains a trace made with the same kernel', () => {
    expect(pveByCell(events, trace, fs, 0, 0.5)[0]).toBeGreaterThan(0.99);
  });
  it('explains less with a very different kernel', () => {
    expect(pveByCell(events, trace, fs, 0, 3)[0]).toBeLessThan(0.9);
  });
  it('fits a line exactly', () => {
    const x = Float64Array.from([0, 1, 2, 3]);
    expect(fitLine([1, 3, 5, 7], 0, x)).toMatchObject({ a: 2, b: 1, pve: 1 });
  });
  it('finds the decay time from event-triggered averages', () => {
    const many: Matrix = { data: new Float32Array(frames * 20), cells: 1, frames: frames * 20 };
    for (let t = 90; t < many.frames - 200; t += 150) many.data[t] = 1;
    const sig = reconvolve(many.data, 0, many.frames, fs, 0, 0.5);
    const r = eventTriggered(many, { ...many, data: Float32Array.from(sig) }, [0.1], fs);
    expect(r.tauDecay).toBeGreaterThan(0.4);
    expect(r.tauDecay).toBeLessThan(0.6);
    expect(r.rise[0]).toBeGreaterThan(5);
  });
});
