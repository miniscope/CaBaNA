// What the decoders take from the loaded data. Kept apart from prepared.ts, which holds the inputs of the
// other analyses.

import { createMemo } from 'solid-js';
import { effectiveBin } from './arena.ts';
import type { BayesInput } from './decode-bayes.ts';
import { placeFrames, type PlaceFrames } from './prepared.ts';
import { behaviorFrames } from './auroc.ts';
import { exclusiveLabels, overlapReport, type OverlapReport } from './decode-shared.ts';
import { annotationResults, deconvolved, frameTimes, rejected, samplingRate } from './store.ts';

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

/** Every annotated behavior as a 0/1 row per label (unpadded frame labels), and the annotated span. */
export const annotatedBehaviors = createMemo<
  { labels: string[]; rows: Uint8Array; frames: number; scored: Uint8Array; bouts: Map<string, number> } | { error: string }
>(() => {
  const t = frameTimes();
  const ev = decodeEvents();
  const ann = annotationResults().find((r) => r.id === 'behavior_annotations');
  if (!t) return { error: 'Load neural timestamps that match the neural data.' };
  if (!ann || ann.error) return { error: ann?.error ?? 'Load behavior annotations first.' };
  if (!('error' in ev) && t.length !== ev.frames) return { error: 'Load neural timestamps that match the neural data.' };
  const labels = [...new Set(ann.epochs.map((e) => e.label))];
  const first = Math.min(...ann.epochs.map((e) => e.start));
  const last = Math.max(...ann.epochs.map((e) => e.stop));
  const bouts = new Map(labels.map((l) => [l, ann.epochs.filter((e) => e.label === l).length]));
  return {
    labels,
    rows: behaviorFrames(ann.epochs, labels, t),
    frames: t.length,
    // The framework scores the span given with the annotations; this file has none, so the span from the
    // first annotated bout to the end of the last one is taken as scored.
    scored: Uint8Array.from(t, (v) => (v >= first && v < last ? 1 : 0)),
    bouts,
  };
});

export interface BehaviorChoice {
  order: string[];
  unselected: string[];
  other: boolean;
}

/** The priority order to use: the saved one, completed with any loaded behavior it lacks, in the loaded order. */
export const orderOf = (loaded: string[], saved: string[]): string[] => [
  ...saved.filter((l) => loaded.includes(l)),
  ...loaded.filter((l) => !saved.includes(l)),
];

export const OTHER_NAME = 'Other / none of the selected behaviors';

export interface BehaviorDecodeData {
  input: BayesInput;
  cellIds: number[];
  /** State names in priority order, Other last when on. */
  names: string[];
  /** Loaded behavior index of each selected state (by position in `names`, without Other). */
  rowOf: number[];
  overlap: OverlapReport;
  /** Frames in the annotated span. */
  scoredFrames: number;
  fs: number;
}

/**
 * The input of behavior decoding: unsmoothed events and one label per frame. Overlapping behaviors are
 * resolved by the priority order (the earlier one wins); frames with none of the selected behaviors are
 * left out, or are the Other state.
 */
export function behaviorDecodeData(choice: BehaviorChoice): BehaviorDecodeData | { error: string } | undefined {
  const ev = decodeEvents();
  if ('error' in ev) return ev;
  const b = annotatedBehaviors();
  if ('error' in b) return b;
  const order = orderOf(b.labels, choice.order).filter((l) => !choice.unselected.includes(l));
  const rowOf = order.map((l) => b.labels.indexOf(l));
  const labels = exclusiveLabels(b.rows, b.frames, rowOf, choice.other, b.scored);
  const names = choice.other ? [...order, OTHER_NAME] : order;
  return {
    cellIds: ev.cellIds,
    names,
    rowOf,
    overlap: overlapReport(b.rows, b.frames, rowOf, choice.other, b.scored),
    scoredFrames: b.scored.reduce((n, v) => n + v, 0),
    fs: ev.fs,
    input: {
      neural: ev.neural,
      cells: ev.cells,
      frames: ev.frames,
      fs: ev.fs,
      labels,
      mask: new Uint8Array(ev.frames).fill(1),
      nStates: names.length,
    },
  };
}
