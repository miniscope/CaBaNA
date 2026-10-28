// What the decoders take from the loaded data. Kept apart from prepared.ts, which holds the inputs of the
// other analyses.

import { createMemo } from 'solid-js';
import { effectiveBin } from './arena.ts';
import type { BayesInput } from './decode-bayes.ts';
import { placeFrames, type PlaceFrames } from './prepared.ts';
import { deconvolved, rejected, samplingRate } from './store.ts';

/**
 * Deconvolved events of the accepted cells, exactly as loaded: the Preprocess event smoothing is not applied.
 * The Bayesian decoder binarizes them (any event above zero is 1), and on smoothed traces every frame within a
 * few sigma of an event is above zero, which would smear each event over many frames. Smoothed traces are
 * never substituted: without events the decoder does not run.
 */
export const decodeEvents = createMemo<
  { neural: Float32Array; cellIds: number[]; cells: number; frames: number; fs: number } | { error: string }
>(() => {
  const m = deconvolved();
  const fs = samplingRate();
  if (!m || !fs)
    return {
      error:
        'The Bayesian decoder needs deconvolved events (neural_deconvolved) and a sampling rate. It does not use denoised or raw traces.',
    };
  const cellIds: number[] = [];
  for (let c = 0; c < m.cells; c++) if (!rejected().has(c)) cellIds.push(c);
  if (!cellIds.length) return { error: 'No accepted cells: every cell is rejected.' };
  const neural = new Float32Array(cellIds.length * m.frames);
  let nonzero = 0;
  let negative = 0;
  cellIds.forEach((c, i) => {
    const row = m.data.subarray(c * m.frames, (c + 1) * m.frames);
    neural.set(row, i * m.frames);
    for (const v of row) {
      if (v > 0) nonzero++;
      else if (v < 0) negative++;
    }
  });
  if (negative)
    return {
      error: `The deconvolved data has ${negative} negative values, which events do not have. The decoder needs non-negative deconvolved events.`,
    };
  const share = nonzero / neural.length;
  if (share === 0) return { error: 'The deconvolved data is all zero: no events to decode from.' };
  if (share > 0.5)
    return {
      error: `${(share * 100).toFixed(0)}% of the deconvolved values are above zero. Events are sparse, so this looks like a smoothed trace. The Bayesian decoder needs unsmoothed deconvolved events.`,
    };
  return { neural, cellIds, cells: cellIds.length, frames: m.frames, fs };
});

export interface PositionDecodeData {
  input: BayesInput;
  cellIds: number[];
  frames: PlaceFrames;
}

/**
 * The input of position decoding: unsmoothed events, the spatial bin of every frame (frames with no
 * position, below the speed filter or outside the arena are not used) and the bin centres in cm.
 */
export function positionDecodeData(bin = effectiveBin()): PositionDecodeData | { error: string } | undefined {
  const ev = decodeEvents();
  if ('error' in ev) return ev;
  const f = placeFrames(bin);
  if (!f) return undefined;
  if ('error' in f) return f;
  if (f.labels.length !== ev.frames) return { error: 'Position and neural data have different numbers of frames.' };
  const { grid, labels } = f;
  const centers = new Float64Array(grid.nx * grid.ny * 2);
  for (let s = 0; s < grid.nx * grid.ny; s++) {
    centers[2 * s] = ((s % grid.nx) + 0.5) * grid.bin;
    centers[2 * s + 1] = (Math.floor(s / grid.nx) + 0.5) * grid.bin;
  }
  // Only frames with a bin may be used or shuffled, as the speed-filtered frames are not part of the test.
  const mask = Uint8Array.from(labels, (l) => (l >= 0 ? 1 : 0));
  return {
    cellIds: ev.cellIds,
    frames: f,
    input: {
      neural: ev.neural,
      cells: ev.cells,
      frames: ev.frames,
      fs: ev.fs,
      labels,
      mask,
      nStates: grid.nx * grid.ny,
      shape: [grid.ny, grid.nx],
      centers,
    },
  };
}
