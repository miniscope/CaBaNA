// Running the decoding analysis: settings, the run on the worker pool, and the results the panels read.
// Stage 1: Bayesian position decoding. The Target selector will also offer behaviors.

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import { effectiveBin } from './arena.ts';
import { DEFAULT_BAYES, type BayesOut, type BayesParams } from './decode-bayes.ts';
import { positionDecodeData, type PositionDecodeData } from './decode-data.ts';
import { blockFrames, decodeTest, overallStatistic, type DecodeTestResult } from './decode-test.ts';
import { createDecodingWorkerPool, type DecodingPoolJob } from './decoding-pool.ts';
import { DEFAULT_PREP, prep } from './preprocess.ts';
import { onClear } from './store.ts';
import type { ShuffleBatch } from '../workers/decoding-types.ts';

/** The starting preset: a practical starting point, not a validated optimum. Every value can be changed and is exported. */
export const DEFAULT_DECODE_SETTINGS = {
  target: 'position' as 'position' | 'behavior',
  position: {
    likelihood: 'gaussian' as BayesParams['likelihood'],
    sigma: 'per_state' as BayesParams['sigma'],
    /** Integration window: the width of the test window centred on each frame, in seconds. */
    windowS: 0.25,
    /** Smoothing of the training maps, in spatial bins. 0 is off. */
    smoothSigmaBins: 0,
    nFolds: 5,
    prior: 'occupancy' as BayesParams['prior'],
    /** States with fewer used frames are not decoded and show as Not evaluated. */
    minFrames: 20,
  },
  /** `shuffle`: label-shuffle test; `none`: decoding only. */
  test: 'shuffle' as 'shuffle' | 'none',
  nShuffles: 1000,
  blockS: 5,
  seed: 0,
  alpha: 0.05,
  /** Across the tested states of this target and run. */
  correction: 'max_stat' as 'none' | 'max_stat',
};
export type DecodeSettings = typeof DEFAULT_DECODE_SETTINGS;
export const [decodeSettings, setDecodeSettings] = createStore(structuredClone(DEFAULT_DECODE_SETTINGS));

/** The number of shuffles offered as a quick preview: too few for a reliable p-value. */
export const QUICK_SHUFFLES = 50;

export const bayesParamsOf = (s: DecodeSettings['position']): BayesParams => ({
  ...DEFAULT_BAYES,
  likelihood: s.likelihood,
  sigma: s.sigma,
  windowS: s.windowS,
  smoothSigmaBins: s.smoothSigmaBins,
  nFolds: s.nFolds,
  prior: s.prior,
  minFramesPerClass: s.minFrames,
  clipWindowToFold: true,
});

/** What a finished run used and found. */
export interface DecodeOutcome {
  target: 'position';
  data: PositionDecodeData;
  params: BayesParams;
  observed: BayesOut;
  /** Absent when the test was off. */
  test?: DecodeTestResult;
  nullValues?: Float64Array;
  nullOverall?: Float64Array;
  blockFrames: number;
  seconds: number;
  settings: DecodeSettings;
  /** The Preprocess settings this run used, and the bin size of the spatial grid. */
  prep: typeof DEFAULT_PREP;
  binCm: number;
}

export const [decodeStatus, setDecodeStatus] = createSignal<
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
export const [decodeOutcome, setDecodeOutcome] = createSignal<DecodeOutcome | undefined>();
export const [decodeShowResults, setDecodeShowResults] = createSignal(false);

let pool: WorkerPool<DecodingPoolJob> | undefined;
let nextJob = 1;

export function cancelDecodeRun(): void {
  pool?.dispose();
  pool = undefined;
  setDecodeStatus({ kind: 'idle' });
}
onClear(() => {
  cancelDecodeRun();
  setDecodeOutcome(undefined);
  setDecodeShowResults(false);
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
    } as DecodingPoolJob);
  });
}

/** Why the current data and settings cannot run, or undefined. */
export function decodeRunIssue(d: PositionDecodeData | { error: string } | undefined, cfg: DecodeSettings): string | undefined {
  if (!d) return 'Load deconvolved events, position and neural timestamps first.';
  if ('error' in d) return d.error;
  const p = cfg.position;
  if (!(p.windowS >= 0)) return 'The integration window must be 0 or longer.';
  if (!(p.nFolds >= 2)) return 'Use at least 2 folds.';
  const used = d.input.labels.filter((l) => l >= 0).length;
  if (used < p.nFolds * 2) return 'Too few frames are used: relax the speed filter in Preprocess.';
  if (cfg.test === 'shuffle' && !(cfg.nShuffles >= 1)) return 'Use at least 1 shuffle.';
  return undefined;
}

export async function runDecoding(): Promise<void> {
  const data = positionDecodeData();
  const cfg: DecodeSettings = JSON.parse(JSON.stringify(decodeSettings));
  const issue = decodeRunIssue(data, cfg);
  if (issue || !data || 'error' in data) {
    setDecodeStatus({ kind: 'error', message: issue ?? 'No data.' });
    return;
  }
  const prepUsed = { ...prep };
  const params = bayesParamsOf(cfg.position);
  const t0 = performance.now();
  cancelDecodeRun();
  pool = createDecodingWorkerPool();
  const mine = pool;
  const test = cfg.test === 'shuffle';
  const progress = (step: string, done = 0, total = 1) => setDecodeStatus({ kind: 'running', step, done, total });
  try {
    progress('Decoding position', 0, test ? cfg.nShuffles : 1);
    const doneBy = new Map<number, number>();
    const size = Math.max(1, Math.ceil(cfg.nShuffles / (mine.size * 3)));
    const batches: { from: number; to: number }[] = [];
    if (test) for (let from = 0; from < cfg.nShuffles; from += size) batches.push({ from, to: Math.min(from + size, cfg.nShuffles) });
    const observedP = submit<BayesOut>((onComplete) => ({ kind: 'observed', input: data.input, params, onComplete }));
    const shuffleP = Promise.all(
      batches.map(({ from, to }) =>
        submit<ShuffleBatch>((onComplete, jobId) => ({
          kind: 'shuffles',
          input: data.input,
          params,
          blockS: cfg.blockS,
          seed: cfg.seed,
          from,
          to,
          onProgress: (d: number) => {
            doneBy.set(jobId, d);
            progress('Decoding on shuffled labels', [...doneBy.values()].reduce((a, b) => a + b, 0), cfg.nShuffles);
          },
          onComplete,
        })),
      ),
    );
    const [observed, parts] = await Promise.all([observedP, shuffleP]);
    let testResult: DecodeTestResult | undefined;
    let nullValues: Float64Array | undefined;
    let nullOverall: Float64Array | undefined;
    if (test) {
      nullValues = new Float64Array(parts.reduce((n, p) => n + p.values.length, 0));
      nullOverall = new Float64Array(cfg.nShuffles);
      let at = 0;
      let k = 0;
      for (const p of parts) {
        nullValues.set(p.values, at);
        nullOverall.set(p.overall, k);
        at += p.values.length;
        k += p.overall.length;
      }
      testResult = decodeTest(observed.values, overallStatistic(observed, true), nullValues, nullOverall, 'lower', cfg.correction);
    }
    setDecodeOutcome({
      target: 'position',
      data,
      params,
      observed,
      test: testResult,
      nullValues,
      nullOverall,
      blockFrames: blockFrames(cfg.blockS, data.input.fs),
      seconds: (performance.now() - t0) / 1000,
      settings: cfg,
      prep: prepUsed,
      binCm: effectiveBin(),
    });
    setDecodeShowResults(true);
    setDecodeStatus({ kind: 'idle' });
  } catch (e) {
    if (pool !== mine) return; // cancelled
    setDecodeStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (pool === mine) {
      mine.dispose();
      pool = undefined;
    }
  }
}
