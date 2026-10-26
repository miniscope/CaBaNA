// Running the place-cell analysis: settings, the two selectors, then the cells in batches
// on the worker pool, and the results the Analyze panel reads.

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import { arena, sizeCm } from './arena.ts';
import { createPlaceWorkerPool, type PlacePoolJob } from './place-pool.ts';
import { placeData, type PlaceData } from './prepared.ts';
import {
  DEFAULT_PLACE,
  drawShifts,
  makeRng,
  type PlaceInput,
  type PlaceResult,
  type SigmaChoice,
  type TimescaleChoice,
} from './placecells.ts';
import { onClear } from './store.ts';

export const DEFAULT_PLACE_SETTINGS = {
  /** auto_smooth_sigma, or a width in grid bins. */
  sigmaAuto: true,
  sigma: 1,
  /** auto_null_timescale, or the smallest circular shift in seconds. */
  shiftAuto: true,
  minShiftS: 20,
  nShuffles: 1000,
  seed: 0,
  alpha: 0.05,
  /** Minimum seconds in a bin, for information and stability. Shared with the arena settings (`arena.minOccupancy`). */
  minOccS: DEFAULT_PLACE.minOccInfoS,
  /** Minimum seconds in a bin for it to count in a place field. */
  minOccFieldsS: DEFAULT_PLACE.minOccFieldsS,
  fieldThreshold: DEFAULT_PLACE.field.threshold,
  minFieldBins: DEFAULT_PLACE.field.minFieldBins,
};
export const [placeSettings, setPlaceSettings] = createStore({ ...DEFAULT_PLACE_SETTINGS });

/** What a finished run used and found. */
export interface PlaceOutcome {
  data: PlaceData;
  result: PlaceResult;
  sigma: number;
  sigmaChoice?: SigmaChoice;
  minShiftS: number;
  timescale?: TimescaleChoice;
  nShuffles: number;
  distinctShifts: number;
  seconds: number;
  /** Arena size in cm when the run started, for drawing the maps. */
  arenaCm: [number, number];
  /** The settings this run used, to tell when the panel's settings have moved on. */
  settings: typeof DEFAULT_PLACE_SETTINGS;
}

export const [placeStatus, setPlaceStatus] = createSignal<
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
export const [placeOutcome, setPlaceOutcome] = createSignal<PlaceOutcome | undefined>();
/** Whether the Place cells page shows the results (true after a run) or the settings. */
export const [placeShowResults, setPlaceShowResults] = createSignal(false);

let pool: WorkerPool<PlacePoolJob> | undefined;
let nextJob = 1;

/** Stops a run now: the workers are terminated, since a job in progress cannot be interrupted. */
export function cancelPlaceRun(): void {
  pool?.dispose();
  pool = undefined;
  setPlaceStatus({ kind: 'idle' });
}
onClear(() => {
  cancelPlaceRun();
  setPlaceOutcome(undefined);
  setPlaceShowResults(false);
});

/** Queue a job and wait for it. Settles with the result, or rejects if the run is cancelled or fails. */
function submit<T>(
  make: (
    done: (r: T) => void,
    jobId: number,
  ) => Omit<PlacePoolJob, 'jobId' | 'onCancelled' | 'onError'>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const jobId = nextJob++;
    const job = {
      jobId,
      onCancelled: () => reject(new Error('cancelled')),
      onError: (m: string) => reject(new Error(m)),
      ...make(resolve, jobId),
    } as PlacePoolJob;
    pool!.dispatch(job);
  });
}

const subset = (input: PlaceInput, from: number, to: number): PlaceInput => ({
  ...input,
  cells: to - from,
  neural: input.neural.subarray(from * input.frames, to * input.frames),
});

export async function runPlaceCells(): Promise<void> {
  const data = placeData();
  if (!data || 'error' in data) {
    setPlaceStatus({
      kind: 'error',
      message: data?.error ?? 'Load neural data and position first.',
    });
    return;
  }
  const { input } = data;
  const cfg = { ...placeSettings, minOccS: arena.minOccupancy };
  const t0 = performance.now();
  cancelPlaceRun();
  pool = createPlaceWorkerPool();
  const mine = pool;
  const progress = (step: string, done = 0, total = 1) =>
    setPlaceStatus({ kind: 'running', step, done, total });
  try {
    progress('Choosing smoothing and null timescale from the data');
    const [sigmaChoice, timescale] = await Promise.all([
      cfg.sigmaAuto
        ? submit<SigmaChoice>((onComplete) => ({
            kind: 'sigma',
            input,
            minOccS: cfg.minOccS,
            onComplete,
          }))
        : undefined,
      cfg.shiftAuto
        ? submit<TimescaleChoice>((onComplete) => ({ kind: 'timescale', input, onComplete }))
        : undefined,
    ]);
    const sigma = sigmaChoice?.sigma ?? cfg.sigma;
    const minShiftS = timescale?.minShiftS ?? cfg.minShiftS;
    const { shifts, distinct } = drawShifts(
      input.frames,
      cfg.nShuffles,
      Math.round(minShiftS * input.fs),
      makeRng(cfg.seed),
    );
    const params = {
      ...DEFAULT_PLACE,
      sigma,
      nShuffles: cfg.nShuffles,
      minShiftS,
      seed: cfg.seed,
      alpha: cfg.alpha,
      minOccInfoS: cfg.minOccS,
      minOccStabS: cfg.minOccS,
      minOccFieldsS: cfg.minOccFieldsS,
      field: { threshold: cfg.fieldThreshold, minFieldBins: cfg.minFieldBins },
    };

    // Cells go out in batches of a few, so every worker stays busy and progress moves smoothly.
    const batch = Math.max(1, Math.min(8, Math.ceil(input.cells / (mine.size * 4))));
    const doneBy = new Map<number, number>();
    const total = input.cells;
    progress('Testing cells against shifted neural data', 0, total);
    const starts = Array.from({ length: Math.ceil(total / batch) }, (_, i) => i * batch);
    const parts = await Promise.all(
      starts.map((from) =>
        submit<PlaceResult>((onComplete, jobId) => ({
          kind: 'cells',
          input: subset(input, from, Math.min(from + batch, total)),
          params,
          shifts,
          onProgress: (d: number) => {
            doneBy.set(jobId, d);
            progress(
              'Testing cells against shifted neural data',
              [...doneBy.values()].reduce((a, b) => a + b, 0),
              total,
            );
          },
          onComplete,
        })),
      ),
    );
    setPlaceOutcome({
      data,
      result: join(parts, data.grid.nx * data.grid.ny),
      sigma,
      sigmaChoice,
      minShiftS,
      timescale,
      nShuffles: cfg.nShuffles,
      distinctShifts: distinct,
      seconds: (performance.now() - t0) / 1000,
      arenaCm: sizeCm(),
      settings: cfg,
    });
    setPlaceShowResults(true);
    setPlaceStatus({ kind: 'idle' });
  } catch (e) {
    if (pool !== mine) return; // cancelled
    setPlaceStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (pool === mine) {
      mine.dispose();
      pool = undefined;
    }
  }
}

/** Put the batches' results back together, cell after cell. */
function join(parts: PlaceResult[], nStates: number): PlaceResult {
  const cells = parts.reduce((n, p) => n + p.cells, 0);
  const cat = <A extends Float64Array | Float32Array | Uint8Array>(
    pick: (p: PlaceResult) => A,
  ): A => {
    const first = pick(parts[0]);
    const out = new (first.constructor as new (n: number) => A)(
      parts.reduce((n, p) => n + pick(p).length, 0),
    );
    let at = 0;
    for (const p of parts) {
      out.set(pick(p), at);
      at += pick(p).length;
    }
    return out;
  };
  return {
    cells,
    nStates,
    information: cat((p) => p.information),
    pInformation: cat((p) => p.pInformation),
    stability: cat((p) => p.stability),
    pStability: cat((p) => p.pStability),
    inOut: cat((p) => p.inOut),
    pFields: cat((p) => p.pFields),
    nFields: cat((p) => p.nFields),
    peak: cat((p) => p.peak),
    placeCell: cat((p) => p.placeCell),
    rate: cat((p) => p.rate),
    rateA: cat((p) => p.rateA),
    rateB: cat((p) => p.rateB),
    fieldLabels: cat((p) => p.fieldLabels),
    nShifts: parts[0].nShifts,
    nullInformation: cat((p) => p.nullInformation),
    nullStability: cat((p) => p.nullStability),
    nullInOut: cat((p) => p.nullInOut),
  };
}
