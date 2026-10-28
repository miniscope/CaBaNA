// Running the PETH analysis: the data it takes (neural data and the onsets of each behavior),
// settings, the run on the worker pool, and the results the panels read.

import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import { behaviorFrames, type AurocMinShift } from './auroc.ts';
import {
  DEFAULT_PETH_PARAMS,
  onsetReport,
  type Align,
  shiftedPethCell,
  windowProblems,
  type OnsetReport,
  type PethBand,
  type PethCurves,
  type PethInput,
  type PethParams,
  type PethResult,
} from './peth.ts';
import { createPethWorkerPool, type PethPoolJob } from './peth-pool.ts';
import { drawShifts, makeRng } from './placecells.ts';
import { placeNeural } from './prepared.ts';
import { DEFAULT_PREP, prep } from './preprocess.ts';
import { annotationResults, frameTimes, onClear } from './store.ts';
import type { PethCells, ShiftDraw } from '../workers/peth-types.ts';

/** What the analysis takes, from the loaded files and the Preprocess settings. */
export interface PethData {
  neural: Float32Array;
  cellIds: number[];
  cells: number;
  frames: number;
  fs: number;
  /** Every annotated behavior, one 0/1 row each: the frame labels as annotated, with no label padding. */
  labels: string[];
  behaviors: Uint8Array;
  /** Annotated seconds and number of bouts per behavior. */
  info: { label: string; duration: number; bouts: number }[];
  /** Cells with a non-finite neural value anywhere in the session: Not evaluated. */
  cellsMissing: number[];
}

export const DEFAULT_PETH_SETTINGS = {
  params: {
    ...DEFAULT_PETH_PARAMS,
    baselineS: [...DEFAULT_PETH_PARAMS.baselineS] as [number, number],
    responseS: [...DEFAULT_PETH_PARAMS.responseS] as [number, number],
  } as PethParams,
  /** Which end of each bout the windows are aligned to. `both` runs onset and offset as two separate sets of tests. */
  align: 'onset' as 'onset' | 'offset' | 'both',
  /** Behaviors the user left out of the run, by label. Behaviors with too few onsets are never tested. */
  unselected: [] as string[],
  /** `circular`: shuffle test by circular shift. `none`: curves only, no p-values and no labels. */
  test: 'circular' as 'circular' | 'none',
  shiftAuto: true,
  minShiftS: 20,
  nShuffles: 1000,
  seed: 0,
  alpha: 0.05,
  /** Correction across the selected behaviors within each cell. */
  correction: 'max_stat' as 'none' | 'max_stat',
  /** Null band and latency (descriptive): its own shifts, seed and minimum shift. */
  band: true,
  bandShifts: 200,
  bandSeed: 0,
  bandMinShiftS: 20,
  latencyBins: 2,
  /** Show the paired Wilcoxon p-value (descriptive). It is computed with the curves either way. */
  wilcoxon: false,
};
export const [pethSettings, setPethSettings] = createStore(structuredClone(DEFAULT_PETH_SETTINGS));
export type PethSettings = typeof DEFAULT_PETH_SETTINGS;

/** The analysis input, or an explanation of what is missing. */
export const pethData = createMemo<PethData | { error: string }>(() => {
  const n = placeNeural();
  const t = frameTimes();
  const ann = annotationResults().find((r) => r.id === 'behavior_annotations');
  if (!n) return { error: 'Load deconvolved neural data first.' };
  if (!n.cells) return { error: 'No accepted cells: every cell is rejected.' };
  if (!t || t.length !== n.frames)
    return { error: 'Load neural timestamps that match the neural data.' };
  if (!ann || ann.error) return { error: ann?.error ?? 'Load behavior annotations first.' };
  const labels = [...new Set(ann.epochs.map((e) => e.label))];
  const info = labels.map((label) => {
    const eps = ann.epochs.filter((e) => e.label === label);
    return { label, duration: eps.reduce((s, e) => s + e.stop - e.start, 0), bouts: eps.length };
  });
  const cellsMissing: number[] = [];
  for (let c = 0; c < n.cells; c++)
    for (let i = 0; i < n.frames; i++)
      if (!Number.isFinite(n.neural[c * n.frames + i])) {
        cellsMissing.push(c);
        break;
      }
  return {
    neural: n.neural,
    cellIds: n.cellIds,
    cells: n.cells,
    frames: n.frames,
    fs: n.fs,
    labels,
    behaviors: behaviorFrames(ann.epochs, labels, t),
    info,
    cellsMissing,
  };
});

const allFrames = (frames: number) => new Uint8Array(frames).fill(1);

/** The data as a PETH input with every behavior and every frame included. */
export const pethInputOf = (d: PethData): PethInput => ({
  neural: d.neural,
  cells: d.cells,
  frames: d.frames,
  fs: d.fs,
  behaviors: d.behaviors,
  nBehaviors: d.labels.length,
  mask: allFrames(d.frames),
});

/** The alignments a setting runs, in display order. */
export const alignsOf = (align: PethSettings['align']): Align[] => (align === 'both' ? ['onset', 'offset'] : [align]);

/** Onsets (or offsets) and exclusions of every behavior for these settings, or undefined while the window settings are invalid. */
export function pethReports(d: PethData, params: PethParams, align: Align = 'onset'): OnsetReport[] | undefined {
  return windowProblems(params, d.fs).length ? undefined : onsetReport(pethInputOf(d), params, align);
}

/** The reports of every alignment a setting runs. */
export type AlignedReports = Partial<Record<Align, OnsetReport[]>>;
export function pethAlignedReports(d: PethData, cfg: Pick<PethSettings, 'params' | 'align'>): AlignedReports | undefined {
  const out: AlignedReports = {};
  for (const a of alignsOf(cfg.align)) {
    const r = pethReports(d, cfg.params, a);
    if (!r) return undefined;
    out[a] = r;
  }
  return out;
}

type PlanSettings = Pick<PethSettings, 'params' | 'unselected' | 'align'>;

/** One tested column: a behavior aligned to its onsets or its offsets. */
export interface PethColumn {
  /** Index into the data's behaviors. */
  b: number;
  align: Align;
}

/** A column's name: the behavior alone when only one alignment is run, else with the alignment. */
export const columnLabel = (label: string, align: Align, both: boolean) => (both ? `${label} (${align})` : label);

/**
 * What one run tests: every behavior that was not left out and every selected alignment, as one input
 * row each, with its onsets. A column with too few onsets stays in the run and comes out as Not
 * evaluated. `families` numbers the alignments: onset and offset tests are corrected separately.
 */
export function pethPlan(d: PethData, cfg: PlanSettings, reports: AlignedReports) {
  const idx = d.labels.flatMap((l, i) => (cfg.unselected.includes(l) ? [] : [i]));
  const aligns = alignsOf(cfg.align);
  const columns: PethColumn[] = aligns.flatMap((align) => idx.map((b) => ({ b, align })));
  const rows = new Uint8Array(columns.length * d.frames);
  columns.forEach(({ b }, j) => rows.set(d.behaviors.subarray(b * d.frames, (b + 1) * d.frames), j * d.frames));
  const input: PethInput = {
    ...pethInputOf(d),
    behaviors: rows,
    nBehaviors: columns.length,
  };
  const both = aligns.length > 1;
  return {
    input,
    columns,
    families: columns.map((c) => aligns.indexOf(c.align)),
    labels: columns.map((c) => columnLabel(d.labels[c.b], c.align, both)),
    info: columns.map((c) => d.info[c.b]),
    reports: columns.map((c) => reports[c.align]![c.b]),
    onsets: columns.map((c) => reports[c.align]![c.b].onsets),
  };
}

/** What a finished run used and found. */
export interface PethOutcome {
  /** One per tested column (see `columns`): the behavior name, with "(onset)" or "(offset)" when both alignments ran. */
  labels: string[];
  /** The behavior and alignment behind each column. */
  columns: PethColumn[];
  info: PethData['info'];
  cellIds: number[];
  /** The input the run used (selected behaviors only), kept to recompute one cell's shifted values and raw windows. */
  input: PethInput;
  reports: OnsetReport[];
  /** Valid onsets per behavior (frame indexes). */
  onsets: Int32Array[];
  params: PethParams;
  result: PethResult;
  curves: PethCurves;
  band?: PethBand;
  /** Cells with a non-finite neural value (Not evaluated), as indexes into `cellIds`. */
  cellsMissing: number[];
  /** The shifts of the shuffle test (empty with no test) and of the null band, and how many were distinct. */
  shifts: Int32Array;
  bandShifts?: Int32Array;
  uniqueShifts: number;
  minShiftS: number;
  timescale?: AurocMinShift;
  seconds: number;
  settings: PethSettings;
  /** The Preprocess settings this run used. */
  prep: typeof DEFAULT_PREP;
}

export const [pethStatus, setPethStatus] = createSignal<
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
export const [pethOutcome, setPethOutcome] = createSignal<PethOutcome | undefined>();
export const [pethShowResults, setPethShowResults] = createSignal(false);

let pool: WorkerPool<PethPoolJob> | undefined;
let nextJob = 1;

export function cancelPethRun(): void {
  pool?.dispose();
  pool = undefined;
  setPethStatus({ kind: 'idle' });
}
onClear(() => {
  cancelPethRun();
  setPethOutcome(undefined);
  setPethShowResults(false);
});

type Make = (done: (r: never) => void, jobId: number) => Record<string, unknown>;
function submit<T>(
  make: (done: (r: T) => void, jobId: number) => Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const jobId = nextJob++;
    pool!.dispatch({
      jobId,
      onCancelled: () => reject(new Error('cancelled')),
      onError: (m: string) => reject(new Error(m)),
      ...(make as Make)(resolve as never, jobId),
    } as PethPoolJob);
  });
}

/** Joins the per-batch arrays of one quantity, in cell order. */
function cat<T extends Float64Array | Int8Array>(parts: T[]): T {
  const out = new (parts[0].constructor as new (n: number) => T)(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Why the current settings cannot run, or undefined. */
export function pethRunIssue(d: PethData, cfg: PethSettings, reports: AlignedReports | undefined): string | undefined {
  const problems = windowProblems(cfg.params, d.fs);
  if (problems.length) return problems[0];
  if (!reports) return 'Fix the analysis window first.';
  const ready = alignsOf(cfg.align).some((a) =>
    d.labels.some((l, b) => !cfg.unselected.includes(l) && reports[a]![b].onsets.length >= cfg.params.minEvents),
  );
  return ready ? undefined : `No selected behavior has enough ${cfg.align === 'offset' ? 'offsets' : cfg.align === 'both' ? 'bouts' : 'onsets'}.`;
}

export async function runPeth(): Promise<void> {
  const data = pethData();
  if ('error' in data) {
    setPethStatus({ kind: 'error', message: data.error });
    return;
  }
  const prepUsed = { ...prep };
  const cfg: PethSettings = JSON.parse(JSON.stringify(pethSettings));
  const reports = pethAlignedReports(data, cfg);
  const issue = pethRunIssue(data, cfg, reports);
  if (issue) {
    setPethStatus({ kind: 'error', message: issue });
    return;
  }
  const { input, labels, info, reports: used, onsets, columns, families } = pethPlan(data, cfg, reports!);
  const test = cfg.test === 'circular';
  const t0 = performance.now();
  cancelPethRun();
  pool = createPethWorkerPool();
  const mine = pool;
  const progress = (step: string, done = 0, total = 1) =>
    setPethStatus({ kind: 'running', step, done, total });
  try {
    progress('Choosing the minimum shift from the data');
    const timescale =
      test && cfg.shiftAuto
        ? await submit<AurocMinShift>((onComplete) => ({ kind: 'timescale', input, onComplete }))
        : undefined;
    const minShiftS = timescale?.minShiftS ?? cfg.minShiftS;
    progress('Drawing shifts');
    const draw = test
      ? await submit<ShiftDraw>((onComplete) => ({
          kind: 'shifts',
          frames: input.frames,
          minShift: Math.round(minShiftS * input.fs),
          nShuffles: cfg.nShuffles,
          seed: cfg.seed,
          onComplete,
        }))
      : { shifts: new Int32Array(0), unique: 0 };
    const bandShifts = cfg.band
      ? drawShifts(
          input.frames,
          cfg.bandShifts,
          Math.round(cfg.bandMinShiftS * input.fs),
          makeRng(cfg.bandSeed),
        ).shifts
      : undefined;

    const batch = Math.max(1, Math.min(4, Math.ceil(input.cells / (mine.size * 4))));
    const doneBy = new Map<number, number>();
    const step = test ? 'Testing cells against time-shifted data' : 'Computing curves';
    progress(step, 0, input.cells);
    const starts = Array.from({ length: Math.ceil(input.cells / batch) }, (_, i) => i * batch);
    const parts = await Promise.all(
      starts.map((from) => {
        const to = Math.min(from + batch, input.cells);
        return submit<PethCells>((onComplete, jobId) => ({
          kind: 'cells',
          input: {
            ...input,
            cells: to - from,
            neural: input.neural.subarray(from * input.frames, to * input.frames),
          },
          onsets,
          params: cfg.params,
          test: test ? { shifts: draw.shifts, correction: cfg.correction, families } : undefined,
          band: bandShifts ? { shifts: bandShifts, latencyBins: cfg.latencyBins } : undefined,
          onProgress: (d: number) => {
            doneBy.set(jobId, d);
            progress(step, [...doneBy.values()].reduce((a, b) => a + b, 0), input.cells);
          },
          onComplete,
        }));
      }),
    );
    const first = parts[0].curves;
    const bands = parts.map((p) => p.band!);
    setPethOutcome({
      labels,
      columns,
      info,
      cellIds: data.cellIds,
      input,
      reports: used,
      onsets,
      params: cfg.params,
      result: {
        observed: cat(parts.map((p) => p.result.observed)),
        pRaw: cat(parts.map((p) => p.result.pRaw)),
        pAdj: cat(parts.map((p) => p.result.pAdj)),
      },
      curves: {
        peth: cat(parts.map((p) => p.curves.peth)),
        sem: cat(parts.map((p) => p.curves.sem)),
        pPrePost: cat(parts.map((p) => p.curves.pPrePost)),
        bins: first.bins,
        timeS: first.timeS,
        nEvents: first.nEvents,
      },
      band: bandShifts
        ? {
            lo: cat(bands.map((b) => b.lo)),
            hi: cat(bands.map((b) => b.hi)),
            mean: cat(bands.map((b) => b.mean)),
            latencyS: cat(bands.map((b) => b.latencyS)),
            latencyDir: cat(bands.map((b) => b.latencyDir)),
          }
        : undefined,
      cellsMissing: data.cellsMissing,
      shifts: draw.shifts,
      bandShifts,
      uniqueShifts: draw.unique,
      minShiftS,
      timescale,
      seconds: (performance.now() - t0) / 1000,
      settings: cfg,
      prep: prepUsed,
    });
    cache.clear();
    setPethShowResults(true);
    setPethStatus({ kind: 'idle' });
  } catch (e) {
    if (pool !== mine) return; // cancelled
    setPethStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (pool === mine) {
      mine.dispose();
      pool = undefined;
    }
  }
}

const cache = new Map<number, Float64Array>();

/**
 * The shifted statistic of one cell, shuffles x behaviors, recomputed from the run's stored shifts,
 * onsets and neural data, so they are exactly the draws the p-values came from. Cached per cell.
 */
export function shiftedValues(out: PethOutcome, cellIndex: number): Float64Array {
  let v = cache.get(cellIndex);
  if (!v) {
    v = shiftedPethCell(out.input, cellIndex, out.onsets, out.params, out.shifts);
    cache.set(cellIndex, v);
  }
  return v;
}

/** The automatic minimum shift for the current data and selection, worked out on a worker before the run. */
export const [autoShift, setAutoShift] = createSignal<AurocMinShift | undefined>();
let estimateId = 0;
export function estimateMinShift(input: PethInput): void {
  const mine = ++estimateId;
  setAutoShift(undefined);
  if (!input.nBehaviors) return;
  const p = createPethWorkerPool();
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
  } as PethPoolJob);
}

