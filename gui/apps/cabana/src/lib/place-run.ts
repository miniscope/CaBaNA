// Running the place-cell analysis: settings, the two selectors, then the cells in batches
// on the worker pool, and the results the Analyze panel reads.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import { arena, setArena, setBinCm, sizeCm } from './arena.ts';
import type { RunRecord } from './bridge-client.ts';
import { START_COMMAND } from './bridge-status.ts';
import { engineFor, frameworkReady, secondsBetween, type EngineId } from './engine.ts';
import { DEFAULT_PREP, prep } from './preprocess.ts';
import { createPlaceWorkerPool, type PlacePoolJob } from './place-pool.ts';
import { placeFromFramework } from './place-results.ts';
import { placeData, type PlaceData } from './prepared.ts';
import { openedRun } from './results-nav.ts';
import { runSource } from './results-store.ts';
import { active, cancelRun, history, lastError, latest, runAnalysis } from './runs.ts';
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
  /** The Preprocess settings this run used. */
  prep: typeof DEFAULT_PREP;
  /** Which engine made the numbers. */
  engine: EngineId;
  /** The saved run behind a framework outcome. */
  record?: RunRecord;
  /** False when the shifted values were not kept, so the null histograms are empty. */
  nullKept: boolean;
}

export type PlaceStatus =
  | { kind: 'idle' }
  | {
      kind: 'running';
      step: string;
      done: number;
      total: number;
      unit?: 'cells' | 'shuffles' | 'percent';
    }
  | { kind: 'error'; message: string };
export const [placeStatus, setPlaceStatus] = createSignal<PlaceStatus>({ kind: 'idle' });

/** "3 of 12 cells" style progress text; empty when the run cannot say how far along it is. */
export const progressText = (s: Extract<PlaceStatus, { kind: 'running' }>): string =>
  s.total <= 1
    ? ''
    : s.unit === 'percent'
      ? `${s.done}%`
      : `${s.done} of ${s.total} ${s.unit ?? 'cells'}`;
export const [placeOutcome, setPlaceOutcome] = createSignal<PlaceOutcome | undefined>();
/** Whether the Place cells page shows the results (true after a run) or the settings. */
export const [placeShowResults, setPlaceShowResults] = createSignal(false);

let pool: WorkerPool<PlacePoolJob> | undefined;
/** A framework run is in flight (its progress comes from `active()`). */
let frameworkRunning = false;
let nextJob = 1;

/** Stops a run now: a framework run is cancelled through the bridge; browser workers are terminated, since a job in progress cannot be interrupted. */
export function cancelPlaceRun(): void {
  if (frameworkRunning) {
    void cancelRun();
    return;
  }
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

/** The browser engine: the TypeScript port runs the cells on workers. */
async function runPlaceCellsBrowser(): Promise<void> {
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
  const prepUsed = { ...prep };
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
      prep: prepUsed,
      engine: 'browser',
      nullKept: true,
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

// ---- the framework engine ---------------------------------------------------------------------

export interface PlaceRunOptions {
  /** 50 shuffles, saved as Preliminary. Framework engine only. */
  preview?: boolean;
  /** Set only by "Run in browser engine": the framework is never replaced silently. */
  engine?: EngineId;
}

// Progress of a framework run comes from the bridge: shuffles when it reports them, else the
// fraction done, else no number.
function watchProgress(): void {
  createRoot(() => {
    createEffect(() => {
      const a = active();
      if (!frameworkRunning || a?.id !== 'place') return;
      const [done, total] = a.shuffles ?? [];
      const unit = a.shuffles ? 'shuffles' : a.fraction > 0 ? 'percent' : undefined;
      setPlaceStatus({
        kind: 'running',
        step:
          a.phase === 'cancelling'
            ? 'Cancelling'
            : a.message || (a.phase === 'queued' ? 'Queued' : 'Running'),
        done: a.shuffles ? (done ?? 0) : Math.round(a.fraction * 100),
        total: a.shuffles ? (total ?? 1) : unit ? 100 : 1,
        unit,
      });
    });
  });
}

/** Cell ids of the run, as the numbers the stores use; `data` rows are picked to match when they differ. */
function dataFor(data: PlaceData, ids: number[]): PlaceData {
  if (ids.length === data.cellIds.length && ids.every((id, i) => id === data.cellIds[i]))
    return data;
  const { input } = data;
  const rows = ids.map((id) => data.cellIds.indexOf(id));
  const neural = rows.every((r) => r >= 0)
    ? Float32Array.from({ length: ids.length * input.frames }, (_, k) => {
        const row = rows[Math.floor(k / input.frames)];
        return input.neural[row * input.frames + (k % input.frames)];
      })
    : new Float32Array(0); // the loaded recording lacks some of the run's cells
  return { ...data, cellIds: ids, input: { ...input, cells: ids.length, neural } };
}

type SavedSettings = {
  analysis?: Partial<typeof DEFAULT_PLACE_SETTINGS>;
  prep?: Partial<typeof DEFAULT_PREP>;
};

/** The results of a saved framework run in the shape the results views read. No computation. */
export async function placeOutcomeFromRun(record: RunRecord): Promise<PlaceOutcome> {
  const data = placeData();
  if (!data || 'error' in data)
    throw new Error(data?.error ?? 'Load the neural data and position to view this result.');
  const saved = (record.gui.settings ?? {}) as SavedSettings;
  const settings = { ...DEFAULT_PLACE_SETTINGS, ...saved.analysis };
  const src = runSource(record.run_id);
  const fw = await placeFromFramework(src, settings);
  const manifestIds = (await src.manifest()).results[0]?.cell_ids?.map(Number);
  const ids = manifestIds?.every(Number.isFinite) ? manifestIds : data.cellIds;
  return {
    data: dataFor(data, ids),
    result: fw.result,
    sigma: fw.sigma,
    sigmaChoice: fw.sigmaChoice,
    minShiftS: fw.minShiftS,
    timescale: fw.timescale,
    nShuffles: fw.nShuffles,
    distinctShifts: fw.distinctShifts,
    seconds: secondsBetween(record.created_utc, record.finished_utc),
    arenaCm: sizeCm(),
    settings: { ...settings, alpha: fw.alpha },
    prep: { ...DEFAULT_PREP, ...saved.prep },
    engine: 'framework',
    record,
    nullKept: fw.nullKept,
  };
}

const failureText = (rec: RunRecord) =>
  rec.errors[0]?.message?.split('\n').filter(Boolean).at(-1) ?? 'The run failed.';

/** "Load these settings": copy a saved run's settings into the setup. Only settings the run saved are changed. */
export function loadPlaceSettings(record: RunRecord): void {
  const saved =
    ((record.gui.settings ?? {}) as SavedSettings & { analysis?: { binCm?: number } }).analysis ??
    {};
  const { minOccS, binCm, ...own } = saved as Record<string, number | boolean | undefined>;
  setPlaceSettings(
    Object.fromEntries(Object.entries(own).filter(([k]) => k in DEFAULT_PLACE_SETTINGS)),
  );
  if (typeof minOccS === 'number') setArena('minOccupancy', minOccS);
  if (typeof binCm === 'number') setBinCm(binCm);
}

async function runPlaceFramework(scope: 'full' | 'preview'): Promise<void> {
  if (!frameworkReady()) {
    setPlaceStatus({
      kind: 'error',
      message: `Python engine not running. Start it with: ${START_COMMAND}`,
    });
    return;
  }
  if (active()) {
    setPlaceStatus({
      kind: 'error',
      message: 'Another analysis is running. Wait for it to finish.',
    });
    return;
  }
  const data = placeData();
  if (!data || 'error' in data) {
    setPlaceStatus({
      kind: 'error',
      message: data?.error ?? 'Load neural data and position first.',
    });
    return;
  }
  frameworkRunning = true;
  setPlaceStatus({ kind: 'running', step: 'Uploading inputs', done: 0, total: 1 });
  try {
    const record = await runAnalysis('place', scope);
    if (!record) {
      setPlaceStatus({ kind: 'error', message: lastError()?.message ?? 'The run did not start.' });
    } else if (record.status === 'cancelled') {
      setPlaceStatus({ kind: 'idle' });
    } else if (record.status === 'failed' || record.status === 'partial') {
      setPlaceStatus({ kind: 'error', message: failureText(record) });
    } else {
      setPlaceOutcome(await placeOutcomeFromRun(record));
      setPlaceShowResults(true);
      setPlaceStatus({ kind: 'idle' });
    }
  } catch (e) {
    setPlaceStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    frameworkRunning = false;
  }
}

/**
 * Run place cells. The engine follows the settings (lib/engine.ts); asking for the browser engine
 * is always an explicit choice made on the page.
 */
export async function runPlaceCells(options: PlaceRunOptions = {}): Promise<void> {
  const engine = options.engine ?? engineFor('place');
  if (engine === 'browser') return runPlaceCellsBrowser();
  return runPlaceFramework(options.preview ? 'preview' : 'full');
}

// A saved framework run is shown without recomputing: the opened run, else the latest, unless a
// browser result made in this session is on screen and nothing was opened explicitly.
function watchSaved(): void {
  createRoot(() => {
    createEffect(
      on(
        // the data must be loaded to show a result, so a late load shows it too
        () =>
          [
            openedRun('place') ?? latest.place?.run_id,
            (() => {
              const d = placeData();
              return !!d && !('error' in d);
            })(),
          ] as const,
        async ([runId, dataReady]) => {
          if (!runId || !dataReady || frameworkRunning) return;
          const shown = placeOutcome();
          const explicit = !!openedRun('place');
          if (shown?.record?.run_id === runId || (shown && !shown.record && !explicit)) return;
          const record = explicit
            ? (history().find((r) => r.run_id === runId) ?? latest.place)
            : latest.place;
          if (
            !record ||
            record.engine !== 'framework' ||
            record.status !== 'ok' ||
            record.run_id !== runId
          )
            return;
          try {
            setPlaceOutcome(await placeOutcomeFromRun(record));
            if (explicit) setPlaceShowResults(true);
          } catch (e) {
            if (explicit)
              setPlaceStatus({
                kind: 'error',
                message: e instanceof Error ? e.message : String(e),
              });
          }
        },
      ),
    );
  });
}

let watching = false;
/** Start following a run's progress and showing saved framework runs. Idempotent; the pages call it. */
export function watchPlaceRuns(): void {
  if (watching) return;
  watching = true;
  watchProgress();
  watchSaved();
}
