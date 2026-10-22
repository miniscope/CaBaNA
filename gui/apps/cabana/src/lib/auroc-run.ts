// Running the auROC analysis: the data it takes (neural data, behavior frame labels, the frames
// kept by Preprocess), settings, the run on the worker pool, and the results the panel reads.

import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import {
  behaviorFrames,
  frameCounts,
  MIN_FRAMES,
  shiftedAurocCell,
  type AurocInput,
  type AurocMinShift,
  type AurocResult,
} from './auroc.ts';
import { createAurocWorkerPool, type AurocPoolJob } from './auroc-pool.ts';
import { dilateMask } from './framework.ts';
import { placeNeural, positionOnNeural } from './prepared.ts';
import { prep } from './preprocess.ts';
import { DEFAULT_MATCH, fillMissing, type MatchedDraw, type MatchOptions } from './speed-match.ts';
import { annotationResults, frameTimes, onClear } from './store.ts';

export interface BehaviorInfo {
  label: string;
  /** Seconds annotated, and the number of bouts. */
  duration: number;
  bouts: number;
  /** Included frames during and outside the behavior. */
  during: number;
  outside: number;
}

/** What the analysis takes, from the loaded files and the Preprocess settings. */
export interface AurocData {
  neural: Float32Array;
  cellIds: number[];
  cells: number;
  frames: number;
  fs: number;
  /** Every annotated behavior, one 0/1 row each, as Preprocess leaves them (bouts widened by the label padding). */
  labels: string[];
  behaviors: Uint8Array;
  /** The Preprocess frame selection: 1 for frames kept. */
  mask: Uint8Array;
  excluded: { noPosition: number; slow: number };
  info: BehaviorInfo[];
  /** Cells with a missing neural value among the included frames: Not evaluated. */
  cellsMissing: number[];
  /** Speed on the neural frames, when position is loaded (for speed matching). */
  speed?: Float64Array;
}

/** The analysis input, or an explanation of what is missing. */
export const aurocData = createMemo<AurocData | { error: string }>(() => {
  const n = placeNeural();
  const t = frameTimes();
  const ann = annotationResults().find((r) => r.id === 'behavior_annotations');
  if (!n) return { error: 'Load deconvolved neural data first.' };
  if (!t || t.length !== n.frames) return { error: 'Load neural timestamps that match the neural data.' };
  if (!ann || ann.error) return { error: ann?.error ?? 'Load behavior annotations first.' };
  const labels = [...new Set(ann.epochs.map((e) => e.label))];
  const pos = positionOnNeural();
  const mask = new Uint8Array(n.frames).fill(1);
  const excluded = { noPosition: 0, slow: 0 };
  if (pos && pos.sx.length === n.frames)
    for (let i = 0; i < n.frames; i++) {
      if (!(Number.isFinite(pos.sx[i]) && Number.isFinite(pos.sy[i]))) {
        mask[i] = 0;
        excluded.noPosition++;
      } else if (prep.minSpeed > 0 && !(pos.speedAfter[i] >= prep.minSpeed)) {
        mask[i] = 0;
        excluded.slow++;
      }
    }
  const behaviors = behaviorFrames(ann.epochs, labels, t);
  if (prep.labelPadS > 0)
    labels.forEach((_, b) => {
      const row = Array.from(behaviors.subarray(b * n.frames, (b + 1) * n.frames), (v) => v === 1);
      dilateMask(row, n.fs, prep.labelPadS).forEach((v, i) => (behaviors[b * n.frames + i] = v ? 1 : 0));
    });
  const base: AurocInput = {
    neural: n.neural,
    cells: n.cells,
    frames: n.frames,
    fs: n.fs,
    behaviors,
    nBehaviors: labels.length,
    mask,
  };
  const { n1, n0 } = frameCounts(base);
  const info = labels.map((label, b) => {
    const eps = ann.epochs.filter((e) => e.label === label);
    return {
      label,
      duration: eps.reduce((s, e) => s + e.stop - e.start, 0),
      bouts: eps.length,
      during: n1[b],
      outside: n0[b],
    };
  });
  const cellsMissing: number[] = [];
  for (let c = 0; c < n.cells; c++) {
    for (let i = 0; i < n.frames; i++)
      if (mask[i] && !Number.isFinite(n.neural[c * n.frames + i])) {
        cellsMissing.push(c);
        break;
      }
  }
  return {
    neural: n.neural,
    cellIds: n.cellIds,
    cells: n.cells,
    frames: n.frames,
    fs: n.fs,
    labels,
    behaviors,
    mask,
    excluded,
    info,
    cellsMissing,
    speed: pos && pos.sx.length === n.frames ? fillMissing(pos.speedAfter) : undefined,
  };
});

export const DEFAULT_AUROC_SETTINGS = {
  /** Behaviors left out of the run, by label. Behaviors with too few frames start out left out. */
  unselected: [] as string[],
  method: 'circular' as 'circular' | 'speed',
  /** auto_null_timescale, or the smallest circular shift in seconds. */
  shiftAuto: true,
  minShiftS: 20,
  nShuffles: 1000,
  seed: 0,
  alpha: 0.05,
  /** Correction across the selected behaviors within each cell. */
  correction: 'max_stat' as 'none' | 'max_stat',
  match: { ...DEFAULT_MATCH } as MatchOptions,
};
export const [aurocSettings, setAurocSettings] = createStore({
  ...DEFAULT_AUROC_SETTINGS,
  match: { ...DEFAULT_MATCH },
});
export type AurocSettings = typeof DEFAULT_AUROC_SETTINGS;

/** What a finished run used and found. */
export interface AurocOutcome {
  labels: string[];
  info: BehaviorInfo[];
  cellIds: number[];
  /** The input the run used (selected behaviors only), kept to recompute one cell's shifted values. */
  input: AurocInput;
  result: AurocResult;
  /** Cells with a missing neural value (Not evaluated), as indexes into `cellIds`. */
  cellsMissing: number[];
  /** The shifts drawn for the run, with the seed and mask they came from: enough to reproduce every draw. */
  shifts: Int32Array;
  uniqueShifts: number;
  minShiftS: number;
  timescale?: AurocMinShift;
  matched?: MatchedDraw;
  excluded: AurocData['excluded'];
  seconds: number;
  settings: AurocSettings;
}

export const [aurocStatus, setAurocStatus] = createSignal<
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
export const [aurocOutcome, setAurocOutcome] = createSignal<AurocOutcome | undefined>();
export const [aurocShowResults, setAurocShowResults] = createSignal(false);

let pool: WorkerPool<AurocPoolJob> | undefined;
let nextJob = 1;

export function cancelAurocRun(): void {
  pool?.dispose();
  pool = undefined;
  setAurocStatus({ kind: 'idle' });
}
onClear(() => {
  cancelAurocRun();
  setAurocOutcome(undefined);
  setAurocShowResults(false);
});

type Make = (done: (r: never) => void, jobId: number) => Record<string, unknown>;
function submit<T>(make: (done: (r: T) => void, jobId: number) => Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const jobId = nextJob++;
    pool!.dispatch({
      jobId,
      onCancelled: () => reject(new Error('cancelled')),
      onError: (m: string) => reject(new Error(m)),
      ...(make as Make)(resolve as never, jobId),
    } as AurocPoolJob);
  });
}

/** Behaviors the run will use: the selected ones. */
export function selectedBehaviors(data: AurocData, unselected: readonly string[]) {
  const keep = data.labels.map((l) => !unselected.includes(l));
  const idx = keep.flatMap((k, i) => (k ? [i] : []));
  const rows = new Uint8Array(idx.length * data.frames);
  idx.forEach((b, j) => rows.set(data.behaviors.subarray(b * data.frames, (b + 1) * data.frames), j * data.frames));
  return { idx, rows, labels: idx.map((b) => data.labels[b]) };
}

export async function runAuroc(): Promise<void> {
  const data = aurocData();
  if ('error' in data) {
    setAurocStatus({ kind: 'error', message: data.error });
    return;
  }
  const cfg = { ...aurocSettings, unselected: [...aurocSettings.unselected], match: { ...aurocSettings.match } };
  const sel = selectedBehaviors(data, cfg.unselected);
  const input = aurocInput(data, cfg.unselected);
  if (!sel.labels.length) {
    setAurocStatus({ kind: 'error', message: 'Select at least one behavior.' });
    return;
  }
  if (cfg.method === 'speed' && !data.speed) {
    setAurocStatus({ kind: 'error', message: 'Speed matching needs a loaded position file.' });
    return;
  }
  const t0 = performance.now();
  cancelAurocRun();
  pool = createAurocWorkerPool();
  const mine = pool;
  const progress = (step: string, done = 0, total = 1) =>
    setAurocStatus({ kind: 'running', step, done, total });
  try {
    progress('Choosing the minimum shift from the data');
    const timescale = cfg.shiftAuto
      ? await submit<AurocMinShift>((onComplete) => ({ kind: 'timescale', input, onComplete }))
      : undefined;
    const minShiftS = timescale?.minShiftS ?? cfg.minShiftS;
    progress(cfg.method === 'speed' ? 'Finding shifts that match speed' : 'Drawing shifts');
    const draw = await submit<import('../workers/auroc-types.ts').ShiftDraw>((onComplete) => ({
      kind: 'shifts',
      input,
      minShift: Math.round(minShiftS * input.fs),
      nShuffles: cfg.nShuffles,
      seed: cfg.seed,
      match:
        cfg.method === 'speed' ? { speed: data.speed!, options: { ...cfg.match } } : undefined,
      onComplete,
    }));

    const batch = Math.max(1, Math.min(8, Math.ceil(input.cells / (mine.size * 4))));
    const doneBy = new Map<number, number>();
    progress('Testing cells against time-shifted data', 0, input.cells);
    const starts = Array.from({ length: Math.ceil(input.cells / batch) }, (_, i) => i * batch);
    const parts = await Promise.all(
      starts.map((from) => {
        const to = Math.min(from + batch, input.cells);
        return submit<AurocResult>((onComplete, jobId) => ({
          kind: 'cells',
          input: {
            ...input,
            cells: to - from,
            neural: input.neural.subarray(from * input.frames, to * input.frames),
          },
          shifts: draw.shifts,
          correction: cfg.correction,
          onProgress: (d: number) => {
            doneBy.set(jobId, d);
            progress(
              'Testing cells against time-shifted data',
              [...doneBy.values()].reduce((a, b) => a + b, 0),
              input.cells,
            );
          },
          onComplete,
        }));
      }),
    );
    const cat = (pick: (p: AurocResult) => Float64Array) => {
      const out = new Float64Array(parts.reduce((n, p) => n + pick(p).length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(pick(p), at);
        at += pick(p).length;
      }
      return out;
    };
    setAurocOutcome({
      labels: sel.labels,
      info: sel.idx.map((b) => data.info[b]),
      cellIds: data.cellIds,
      input,
      result: { observed: cat((p) => p.observed), pRaw: cat((p) => p.pRaw), pAdj: cat((p) => p.pAdj) },
      cellsMissing: data.cellsMissing,
      shifts: draw.shifts,
      uniqueShifts: draw.unique,
      minShiftS,
      timescale,
      matched: draw.matched,
      excluded: data.excluded,
      seconds: (performance.now() - t0) / 1000,
      settings: cfg,
    });
    cache.clear();
    setAurocShowResults(true);
    setAurocStatus({ kind: 'idle' });
  } catch (e) {
    if (pool !== mine) return; // cancelled
    setAurocStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (pool === mine) {
      mine.dispose();
      pool = undefined;
    }
  }
}

const cache = new Map<string, Float64Array>();

/**
 * The shifted auROC values of one cell, shuffles x behaviors, recomputed from the run's stored shifts,
 * mask and neural data, so they are exactly the draws the p-values came from. Cached per cell.
 */
export function shiftedValues(out: AurocOutcome, cellIndex: number): Float64Array {
  const key = `${cellIndex}`;
  let v = cache.get(key);
  if (!v) {
    v = shiftedAurocCell(out.input, cellIndex, out.shifts, MIN_FRAMES);
    cache.set(key, v);
  }
  return v;
}

/** The input for the selected behaviors. */
export function aurocInput(data: AurocData, unselected: readonly string[]): AurocInput {
  const sel = selectedBehaviors(data, unselected);
  return {
    neural: data.neural,
    cells: data.cells,
    frames: data.frames,
    fs: data.fs,
    behaviors: sel.rows,
    nBehaviors: sel.labels.length,
    mask: data.mask,
  };
}

/** The automatic minimum shift for the current data and selection, worked out on a worker before the run. */
export const [autoShift, setAutoShift] = createSignal<AurocMinShift | undefined>();
let estimateId = 0;
export function estimateMinShift(input: AurocInput): void {
  const mine = ++estimateId;
  setAutoShift(undefined);
  if (!input.nBehaviors) return;
  const p = createAurocWorkerPool();
  p.dispatch({
    jobId: nextJob++,
    kind: 'timescale',
    input,
    onComplete: (r: AurocMinShift) => {
      if (mine === estimateId) setAutoShift(r);
      p.dispose();
    },
    onCancelled: () => p.dispose(),
    onError: () => p.dispose(),
  } as AurocPoolJob);
}
