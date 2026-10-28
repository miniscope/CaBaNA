// Running the decoding analysis: settings, the run on the worker pool, and the results the panels read.
// Stage 1: Bayesian position decoding. The Target selector will also offer behaviors.

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkerPool } from '@calab/compute';
import { effectiveBin } from './arena.ts';
import { DEFAULT_BAYES, type BayesInput, type BayesOut, type BayesParams } from './decode-bayes.ts';
import {
  behaviorDecodeData,
  positionDecodeData,
  type BehaviorDecodeData,
  type PositionDecodeData,
} from './decode-data.ts';
import { blockFrames, decodeTest, overallStatistic, type DecodeTestResult, type Tail } from './decode-test.ts';
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
  behavior: {
    likelihood: 'gaussian' as BayesParams['likelihood'],
    /** Integration window in seconds, as for position. Sigma is always pooled for behaviors. */
    windowS: 0.25,
    nFolds: 5,
    prior: 'occupancy' as BayesParams['prior'],
    minFrames: 20,
    /** Every loaded behavior in priority order (the earlier one wins an overlap); empty until set from the loaded order. */
    order: [] as string[],
    /** Behaviors left out of the decoding. */
    unselected: [] as string[],
    /** Add a state for annotated frames with none of the selected behaviors. When off those frames are left out. */
    other: false,
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

export const behaviorParamsOf = (s: DecodeSettings['behavior']): BayesParams => ({
  ...DEFAULT_BAYES,
  likelihood: s.likelihood,
  sigma: 'pooled',
  windowS: s.windowS,
  smoothSigmaBins: 0,
  nFolds: s.nFolds,
  prior: s.prior,
  minFramesPerClass: s.minFrames,
  clipWindowToFold: true,
});

/** What the two targets share in a finished run. */
interface RunCommon {
  params: BayesParams;
  observed: BayesOut;
  /** Absent when the test was off. */
  test?: DecodeTestResult;
  nullValues?: Float64Array;
  nullOverall?: Float64Array;
  blockFrames: number;
  seconds: number;
  settings: DecodeSettings;
  /** The Preprocess settings this run used. */
  prep: typeof DEFAULT_PREP;
}

/** What a finished position run used and found. */
export interface DecodeOutcome extends RunCommon {
  target: 'position';
  data: PositionDecodeData;
  binCm: number;
}

/** What a finished behavior run used and found. `names` are the states, in priority order, with Other last when on. */
export interface BehaviorOutcome extends RunCommon {
  target: 'behavior';
  data: BehaviorDecodeData;
}

export const [decodeStatus, setDecodeStatus] = createSignal<
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });
export const [decodeOutcome, setDecodeOutcome] = createSignal<DecodeOutcome | undefined>();
export const [behaviorOutcome, setBehaviorOutcome] = createSignal<BehaviorOutcome | undefined>();
export const [decodeShowResults, setDecodeShowResults] = createSignal(false);
export const [behaviorShowResults, setBehaviorShowResults] = createSignal(false);

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
  setBehaviorOutcome(undefined);
  setDecodeShowResults(false);
  setBehaviorShowResults(false);
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

/** The test settings both targets use. */
type TestConfig = Pick<DecodeSettings, 'test' | 'nShuffles' | 'blockS' | 'seed' | 'correction'>;

/**
 * The observed decode and, with the test on, the shuffled decodes on the pool, then the p-values.
 * `tail` is lower for position (error) and upper for behaviors (recall). Each shuffle has its own seed,
 * so the result does not depend on how shuffles are split across workers.
 */
async function runBayesTest(
  input: BayesInput,
  params: BayesParams,
  cfg: TestConfig,
  tail: Tail,
  what: string,
): Promise<Pick<RunCommon, 'observed' | 'test' | 'nullValues' | 'nullOverall' | 'blockFrames'>> {
  const mine = pool!;
  const test = cfg.test === 'shuffle';
  const progress = (step: string, done = 0, total = 1) => setDecodeStatus({ kind: 'running', step, done, total });
  progress(`Decoding ${what}`, 0, test ? cfg.nShuffles : 1);
  const doneBy = new Map<number, number>();
  const size = Math.max(1, Math.ceil(cfg.nShuffles / (mine.size * 3)));
  const batches: { from: number; to: number }[] = [];
  if (test) for (let from = 0; from < cfg.nShuffles; from += size) batches.push({ from, to: Math.min(from + size, cfg.nShuffles) });
  const observedP = submit<BayesOut>((onComplete) => ({ kind: 'observed', input, params, onComplete }));
  const shuffleP = Promise.all(
    batches.map(({ from, to }) =>
      submit<ShuffleBatch>((onComplete, jobId) => ({
        kind: 'shuffles',
        input,
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
  const common = { observed, blockFrames: blockFrames(cfg.blockS, input.fs) };
  if (!test) return common;
  const nullValues = new Float64Array(parts.reduce((n, p) => n + p.values.length, 0));
  const nullOverall = new Float64Array(cfg.nShuffles);
  let at = 0;
  let k = 0;
  for (const p of parts) {
    nullValues.set(p.values, at);
    nullOverall.set(p.overall, k);
    at += p.values.length;
    k += p.overall.length;
  }
  const overall = overallStatistic(observed, !!input.centers);
  return { ...common, nullValues, nullOverall, test: decodeTest(observed.values, overall, nullValues, nullOverall, tail, cfg.correction) };
}

/** Runs `body` on a fresh pool, reporting a failure in the status and ignoring a cancelled run. */
async function withPool(body: () => Promise<void>, show: (v: boolean) => void): Promise<void> {
  cancelDecodeRun();
  pool = createDecodingWorkerPool();
  const mine = pool;
  try {
    await body();
    show(true);
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

const snapshot = (): DecodeSettings => JSON.parse(JSON.stringify(decodeSettings));

export async function runDecoding(): Promise<void> {
  const data = positionDecodeData();
  const cfg = snapshot();
  const issue = decodeRunIssue(data, cfg);
  if (issue || !data || 'error' in data) {
    setDecodeStatus({ kind: 'error', message: issue ?? 'No data.' });
    return;
  }
  const prepUsed = { ...prep };
  const params = bayesParamsOf(cfg.position);
  const t0 = performance.now();
  await withPool(async () => {
    const r = await runBayesTest(data.input, params, cfg, 'lower', 'position');
    setDecodeOutcome({ ...r, target: 'position', data, params, seconds: (performance.now() - t0) / 1000, settings: cfg, prep: prepUsed, binCm: effectiveBin() });
  }, setDecodeShowResults);
}

/** Why behavior decoding cannot run with these settings, or undefined. */
export function behaviorRunIssue(d: BehaviorDecodeData | { error: string } | undefined, cfg: DecodeSettings): string | undefined {
  if (!d) return 'Load deconvolved events, behavior annotations and neural timestamps first.';
  if ('error' in d) return d.error;
  const b = cfg.behavior;
  if (!(b.windowS >= 0)) return 'The integration window must be 0 or longer.';
  if (!(b.nFolds >= 2)) return 'Use at least 2 folds.';
  if (d.names.length < 2) return 'Select at least two behaviors, or one behavior and the Other state.';
  if (d.input.labels.filter((l) => l >= 0).length < b.nFolds * 2) return 'Too few labeled frames.';
  if (cfg.test === 'shuffle' && !(cfg.nShuffles >= 1)) return 'Use at least 1 shuffle.';
  return undefined;
}

export async function runBehaviorDecoding(): Promise<void> {
  const cfg = snapshot();
  const data = behaviorDecodeData(cfg.behavior);
  const issue = behaviorRunIssue(data, cfg);
  if (issue || !data || 'error' in data) {
    setDecodeStatus({ kind: 'error', message: issue ?? 'No data.' });
    return;
  }
  const prepUsed = { ...prep };
  const params = behaviorParamsOf(cfg.behavior);
  const t0 = performance.now();
  await withPool(async () => {
    const r = await runBayesTest(data.input, params, cfg, 'upper', 'behaviors');
    setBehaviorOutcome({ ...r, target: 'behavior', data, params, seconds: (performance.now() - t0) / 1000, settings: cfg, prep: prepUsed });
  }, setBehaviorShowResults);
}
