// The data after preprocessing, as the analyses take it: position on the miniscope's
// frames, and (for place cells) neural data with a grid bin for every used frame.

import { createMemo } from 'solid-js';
import { binGrid, effectiveBin, positionsCm, type BinGrid } from './arena.ts';
import {
  interpolateGaps,
  resampleLinear,
  smoothNeural,
  smoothSignal,
  speedOver,
} from './framework.ts';
import type { PlaceInput } from './placecells.ts';
import { prep } from './preprocess.ts';
import {
  cameraTimes,
  deconvolved,
  frameTimes,
  loaded,
  positionResult,
  rejected,
  samplingRate,
  source,
} from './store.ts';

/** Why position is not available, or undefined when it is. `onNeural` also needs the neural frame times. */
export function positionIssue(onNeural = false): string | undefined {
  if (!loaded.position?.summary) return 'Position needs a position file.';
  if (!loaded.behavior_timestamps?.summary) return 'Position needs camera timestamps.';
  const p = positionResult();
  if (!p || 'error' in p || !cameraTimes()) return 'Position failed QC: see Behavior QC.';
  if (onNeural && !frameTimes()) return 'Position needs neural timestamps.';
  return undefined;
}

/** The tracked position, when a position file and its timestamps are loaded and valid. */
export const trackedPosition = () => {
  const p = positionResult();
  return p && 'x' in p && cameraTimes() ? p : undefined;
};

/** Position in cm: in the arena's frame when the arena is set up, otherwise from the position file. */
export const positionCm = createMemo(() => {
  const p = trackedPosition();
  if (!p) return undefined;
  if (positionsCm().x.length) return positionsCm();
  const k = source.positionUnit === 'px' ? source.pxPerCm : 1;
  return { x: p.x.map((v) => v / k), y: p.y.map((v) => v / k) };
});

/**
 * Position as the framework sees it: on the miniscope's frames (resample_signal, gaps over `maxGapS` stay lost),
 * then interpolate_gaps, smooth_signal, then speed.
 */
export const positionOnNeural = createMemo(() => {
  const c = positionCm();
  const ct = cameraTimes();
  const nt = frameTimes();
  if (!c || !ct || !nt) return undefined;
  const ok = ct.map((v, i) => Number.isFinite(v) && (i === 0 || v > ct[i - 1]));
  const tb = ct.filter((_, i) => ok[i]);
  const onFrames = (v: number[]) =>
    resampleLinear(
      tb,
      v.filter((_, i) => ok[i]),
      nt,
      prep.maxGapS,
    );
  const f = samplingRate() ?? 30;
  const fill = (v: Float64Array) =>
    prep.fillGapS > 0 ? interpolateGaps(v, f, prep.fillGapS) : { out: v, filled: 0 };
  // Kept before filling so Preprocess can show what gap filling adds.
  const rx = onFrames(c.x);
  const ry = onFrames(c.y);
  const fx = fill(rx);
  const fy = fill(ry);
  const [x, y] = [fx.out, fy.out];
  const smooth = (v: Float64Array) =>
    prep.posWindowS > 0 ? smoothSignal(v, f, prep.posMethod, prep.posWindowS) : v;
  const sx = smooth(x);
  const sy = smooth(y);
  return {
    rx,
    ry,
    x,
    y,
    filled: fx.filled,
    sx,
    sy,
    speedBefore: speedOver(x, y, nt, f, prep.speedWindowS),
    speedAfter: speedOver(sx, sy, nt, f, prep.speedWindowS),
  };
});

/** Events (smoothed as chosen in Preprocess) of the cells that were not rejected. */
export const placeNeural = createMemo(() => {
  const m = deconvolved();
  const fs = samplingRate();
  if (!m || !fs) return undefined;
  const cellIds: number[] = [];
  for (let c = 0; c < m.cells; c++) if (!rejected().has(c)) cellIds.push(c);
  const neural = new Float32Array(cellIds.length * m.frames);
  cellIds.forEach((c, i) =>
    neural.set(
      smoothNeural(m.data.subarray(c * m.frames, (c + 1) * m.frames), fs, prep.eventSigmaS),
      i * m.frames,
    ),
  );
  return { neural, cellIds, cells: cellIds.length, frames: m.frames, fs };
});

export interface PlaceFrames {
  grid: BinGrid;
  /** The grid bin of each neural frame, -1 for a frame that is not used. */
  labels: Int32Array;
  /** Frames used, and the speed gate applied (cm/s). */
  used: number;
  minSpeed: number;
}

/**
 * For each neural frame, the grid bin the animal was in, or -1 when the frame is not used: no position,
 * below the Preprocess speed gate, or in a bin outside the arena.
 */
export function placeFrames(bin = effectiveBin()): PlaceFrames | { error: string } | undefined {
  const p = positionOnNeural();
  const n = placeNeural();
  if (!p || !n) return undefined;
  const grid = binGrid(bin);
  if (!grid) return { error: 'Set the arena size in Experimental Setup first.' };
  if (p.sx.length !== n.frames)
    return { error: 'Position and neural data have different numbers of frames.' };
  const { minSpeed } = prep;
  const labels = new Int32Array(n.frames).fill(-1);
  let used = 0;
  for (let t = 0; t < n.frames; t++) {
    const i = Math.floor(p.sx[t] / grid.bin);
    const j = Math.floor(p.sy[t] / grid.bin);
    if (!(i >= 0 && i < grid.nx && j >= 0 && j < grid.ny) || !grid.open[j * grid.nx + i]) continue;
    if (!(p.speedAfter[t] >= minSpeed)) continue;
    labels[t] = j * grid.nx + i;
    used++;
  }
  return { grid, labels, used, minSpeed };
}

export interface PlaceData extends PlaceFrames {
  input: PlaceInput;
  /** Row of each cell in the loaded neural matrix (rejected cells are left out). */
  cellIds: number[];
}

/** What the place-cell analysis takes: the neural data and the frames in use. */
export function placeData(): PlaceData | { error: string } | undefined {
  const f = placeFrames();
  const n = placeNeural();
  if (!f || !n) return undefined;
  if ('error' in f) return f;
  const { grid } = f;
  return {
    ...f,
    cellIds: n.cellIds,
    input: {
      neural: n.neural,
      cells: n.cells,
      frames: n.frames,
      labels: f.labels,
      shape: [grid.ny, grid.nx],
      fs: n.fs,
    },
  };
}

/**
 * Runs of missing position on the neural frames (before gap filling), sorted into those that
 * `interpolateGaps` fills at `maxGapS` and those it leaves: too long, or touching the session
 * start or end. Same frame rounding as interpolateGaps. Missing x or y counts as missing.
 */
export function gapRuns(x: ArrayLike<number>, y: ArrayLike<number>, fs: number, maxGapS: number) {
  const maxFrames = maxGapS > 0 ? Math.floor(maxGapS * fs + 1e-9) : -1;
  const n = x.length;
  const runs: { start: number; len: number; fate: 'filled' | 'long' | 'edge' }[] = [];
  for (let a = 0; a < n; ) {
    if (Number.isFinite(x[a] + y[a])) {
      a++;
      continue;
    }
    let b = a;
    while (b < n && !Number.isFinite(x[b] + y[b])) b++;
    const len = b - a;
    runs.push({ start: a, len, fate: a === 0 || b === n ? 'edge' : len <= maxFrames ? 'filled' : 'long' });
    a = b;
  }
  return runs;
}
