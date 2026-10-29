// Decoding on the browser engine: the same settings as the framework page, run on a worker pool,
// shown on the same results page. It is a separate, labeled action. Random draws differ from the
// framework's, so p-values agree only within shuffling error.

import { batch, createSignal } from 'solid-js';
import type { WorkerPool } from '@calab/compute';
import { effectiveBin } from './arena.ts';
import { DEFAULT_BAYES, type BayesOut, type BayesParams } from './decode-bayes.ts';
import {
  annotatedBehaviors,
  behaviorDecodeData,
  linearDecodeData,
  positionDecodeData,
  type BehaviorChoice,
  type BehaviorDecodeData,
  type LinearDecodeData,
  type PositionDecodeData,
} from './decode-data.ts';
import type { LinearOut, LinearParams } from './decode-linear.ts';
import { decodeTest, overallStatistic, type Tail } from './decode-test.ts';
import { createDecodingWorkerPool, type DecodingPoolJob } from './decoding-pool.ts';
import {
  behaviorBayesDump,
  behaviorLogisticDump,
  dumpSource,
  positionDump,
  type EngineTest,
} from './decoding-engine-results.ts';
import {
  behaviorDecoding,
  decodeTarget,
  positionDecoding,
  type BehaviorDecoding,
  type PositionDecoding,
} from './decoding-settings.ts';
import type { ResultSource } from './results-load.ts';
import { onClear } from './store.ts';
import type { ShuffleBatch } from '../workers/decoding-types.ts';

export const BROWSER_DECODING_RUN_LABEL = 'Run in browser engine (different random draws)';
export const BROWSER_DECODING_ENGINE_TEXT =
  'Browser engine (TypeScript port of framework 57c0c4b, with GUI extensions)';

/** A finished browser run: the result as a results source, and what the page says about it. */
export interface BrowserDecodingRun {
  target: 'position' | 'behaviors';
  decoder: 'bayesian' | 'logistic';
  source: ResultSource;
  seconds: number;
  shuffles: number;
  /** p-value of the overall statistic (the framework does not test it yet). */
  overallP: number | null;
  overallName: string;
  /** What differs from a framework run with the same settings. */
  notes: string[];
}

export type BrowserStatus =
  | { kind: 'idle' }
  | { kind: 'running'; step: string; done: number; total: number }
  | { kind: 'error'; message: string };

export const [browserRun, setBrowserRun] = createSignal<BrowserDecodingRun | undefined>();
export const [browserStatus, setBrowserStatus] = createSignal<BrowserStatus>({ kind: 'idle' });
/** Which engine the Results page shows: set by whichever kind of run finished last. */
export const [shownEngine, setShownEngine] = createSignal<'framework' | 'browser'>('framework');

let pool: WorkerPool<DecodingPoolJob> | undefined;
let nextJob = 1;

export function cancelBrowserDecoding(): void {
  pool?.dispose();
  pool = undefined;
  setBrowserStatus({ kind: 'idle' });
}
onClear(() => {
  cancelBrowserDecoding();
  batch(() => {
    setBrowserRun(undefined);
    setShownEngine('framework');
  });
});

// ---- settings -> engine inputs ---------------------------------------------------------------------

const bayesParams = (s: PositionDecoding | BehaviorDecoding): BayesParams => ({
  ...DEFAULT_BAYES,
  likelihood: s.likelihood,
  sigma: s.sigma,
  windowS: s.windowS,
  smoothSigmaBins: s.smoothSigmaBins,
  nFolds: s.folds,
  prior: s.prior,
  minFramesPerClass: s.minFramesPerClass,
});

const linearParams = (s: BehaviorDecoding): LinearParams => ({
  nFolds: s.folds,
  C: s.C,
  minFramesPerClass: s.minFramesPerClass,
});

/** The behaviors to decode in priority order: the selection, or every annotated behavior. */
export function behaviorChoice(s: BehaviorDecoding): BehaviorChoice | { error: string } {
  const b = annotatedBehaviors();
  if ('error' in b) return b;
  const order = s.labels.length ? s.labels.filter((l) => b.labels.includes(l)) : b.labels;
  return {
    order,
    unselected: b.labels.filter((l) => !order.includes(l)),
    other: s.other,
    overlap: s.overlap,
  };
}

const settingsIssue = (s: PositionDecoding | BehaviorDecoding): string | undefined => {
  if (!(s.windowS >= 0)) return 'The integration window must be 0 or longer.';
  if (!(s.folds >= 2)) return 'Use at least 2 folds.';
  if (!(s.shuffles >= 1)) return 'Use at least 1 shuffle.';
  if (!(s.alpha > 0 && s.alpha < 1)) return 'The significance threshold must be between 0 and 1.';
  return undefined;
};

type Data = PositionDecodeData | BehaviorDecodeData | LinearDecodeData;
interface Plan {
  data: Data;
  decoder: 'bayesian' | 'logistic';
  /** Why this cannot run on the browser engine, or undefined. */
  issue?: string;
}

/** The data and decoder the current settings would run, or the reason they cannot run here. */
function plan(): Plan | { error: string } {
  if (decodeTarget.type === 'position') {
    const issue = settingsIssue(positionDecoding);
    if (issue) return { error: issue };
    const d = positionDecodeData(effectiveBin());
    if (!d) return { error: 'Load deconvolved events, position and neural timestamps first.' };
    if ('error' in d) return d;
    if (d.input.labels.filter((l) => l >= 0).length < positionDecoding.folds * 2)
      return { error: 'Too few frames are used: relax the speed filter in Preprocess.' };
    return { data: d, decoder: 'bayesian' };
  }
  const s = behaviorDecoding;
  const issue = settingsIssue(s);
  if (issue) return { error: issue };
  const choice = behaviorChoice(s);
  if ('error' in choice) return choice;
  const logistic = s.decoder === 'logistic';
  if (logistic && s.mode === 'multiclass')
    return {
      error:
        'Multiclass logistic regression is not available on the browser engine. Use one against the rest.',
    };
  if (logistic && !(s.C > 0)) return { error: 'C must be above 0.' };
  const d = logistic ? linearDecodeData(choice, s.binS) : behaviorDecodeData(choice);
  if (!d)
    return { error: 'Load deconvolved events, behavior annotations and neural timestamps first.' };
  if ('error' in d) return d;
  if (d.names.length < 2)
    return { error: 'Select at least two behaviors, or one behavior and the Other state.' };
  if (d.input.labels.filter((l) => l >= 0).length < s.folds * 2)
    return { error: 'Too few labeled frames.' };
  if (logistic && (d as LinearDecodeData).linear.frames < s.folds * 2)
    return { error: 'Too few time bins: use a shorter time bin.' };
  return { data: d, decoder: logistic ? 'logistic' : 'bayesian' };
}

/** The reason the browser engine cannot run the current settings; empty when it can. */
export function browserBlock(): string {
  const p = plan();
  return 'error' in p ? p.error : '';
}

// ---- running ---------------------------------------------------------------------------------------

function submit<T>(
  make: (done: (r: T) => void, jobId: number) => Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const jobId = nextJob++;
    pool!.dispatch({
      jobId,
      onCancelled: () => reject(new Error('cancelled')),
      onError: (m: string) => reject(new Error(m)),
      ...make(resolve, jobId),
    } as DecodingPoolJob);
  });
}

interface TestSettings {
  shuffles: number;
  blockS: number;
  seed: number;
  alpha: number;
  correction: 'max_stat' | 'none';
}

/**
 * The observed decode and the shuffled decodes on the pool, then the p-values. Each shuffle has its
 * own seed, so the draws do not depend on how shuffles are split across workers.
 */
async function decodeAndTest<O extends { values: Float64Array }>(
  jobs: { observed: 'observed' | 'linear-observed'; shuffles: 'shuffles' | 'linear-shuffles' },
  input: { fs: number },
  params: unknown,
  cfg: TestSettings,
  tail: Tail,
  what: string,
  overallOf: (o: O) => number,
): Promise<{ observed: O; test: EngineTest }> {
  const mine = pool!;
  const progress = (step: string, done: number) =>
    setBrowserStatus({ kind: 'running', step, done, total: cfg.shuffles });
  progress(`Decoding ${what}`, 0);
  const doneBy = new Map<number, number>();
  const size = Math.max(1, Math.ceil(cfg.shuffles / (mine.size * 3)));
  const batches: { from: number; to: number }[] = [];
  for (let from = 0; from < cfg.shuffles; from += size)
    batches.push({ from, to: Math.min(from + size, cfg.shuffles) });
  const observedP = submit<O>((onComplete) => ({ kind: jobs.observed, input, params, onComplete }));
  const shuffleP = Promise.all(
    batches.map(({ from, to }) =>
      submit<ShuffleBatch>((onComplete, jobId) => ({
        kind: jobs.shuffles,
        input,
        params,
        blockS: cfg.blockS,
        seed: cfg.seed,
        from,
        to,
        onProgress: (d: number) => {
          doneBy.set(jobId, d);
          progress(
            'Decoding on shuffled labels',
            [...doneBy.values()].reduce((a, b) => a + b, 0),
          );
        },
        onComplete,
      })),
    ),
  );
  const [observed, parts] = await Promise.all([observedP, shuffleP]);
  const nullValues = new Float64Array(parts.reduce((n, p) => n + p.values.length, 0));
  const nullOverall = new Float64Array(cfg.shuffles);
  let at = 0;
  let k = 0;
  for (const p of parts) {
    nullValues.set(p.values, at);
    nullOverall.set(p.overall, k);
    at += p.values.length;
    k += p.overall.length;
  }
  const t = decodeTest(
    observed.values,
    overallOf(observed),
    nullValues,
    nullOverall,
    tail,
    cfg.correction,
  );
  return {
    observed,
    test: {
      ...t,
      nullValues,
      nullOverall,
      alpha: cfg.alpha,
      correction: cfg.correction,
      blockS: cfg.blockS,
      tail,
    },
  };
}

const NOTES = [
  'Random draws differ from the framework, so p-values agree only within shuffling error.',
  'The fold gap setting is not applied; training folds are contiguous blocks of frames.',
  'The overall value is tested here (a GUI extension); the framework does not test it yet.',
];

/** Runs the current decoding settings on the browser engine and, when done, shows the result. */
export async function runBrowserDecoding(): Promise<boolean> {
  const p = plan();
  if ('error' in p) {
    setBrowserStatus({ kind: 'error', message: p.error });
    return false;
  }
  cancelBrowserDecoding();
  pool = createDecodingWorkerPool();
  const mine = pool;
  const position = decodeTarget.type === 'position';
  const s = position ? positionDecoding : behaviorDecoding;
  const t0 = performance.now();
  try {
    let run: Omit<BrowserDecodingRun, 'seconds' | 'shuffles' | 'target' | 'decoder' | 'notes'>;
    if (position) {
      const d = p.data as PositionDecodeData;
      const params = bayesParams(s);
      const r = await decodeAndTest<BayesOut>(
        { observed: 'observed', shuffles: 'shuffles' },
        d.input,
        params,
        s,
        'lower',
        'position',
        (o) => overallStatistic(o, true),
      );
      const [ny, nx] = d.input.shape!;
      run = {
        source: dumpSource(
          positionDump({ out: r.observed, nx, ny, params: bayesParamRecord(params), test: r.test }),
        ),
        overallP: r.test.pOverall,
        overallName: 'median error',
      };
    } else if (p.decoder === 'logistic') {
      const d = p.data as LinearDecodeData;
      const params = linearParams(behaviorDecoding);
      const r = await decodeAndTest<LinearOut>(
        { observed: 'linear-observed', shuffles: 'linear-shuffles' },
        d.linear,
        params,
        s,
        'upper',
        'behaviors',
        (o) => o.overall,
      );
      run = {
        source: dumpSource(
          behaviorLogisticDump({
            out: r.observed,
            names: d.names,
            test: r.test,
            params: {
              classifier: 'logistic',
              n_folds: params.nFolds,
              C: params.C,
              min_frames_per_class: params.minFramesPerClass,
              mode: 'one_vs_rest',
              time_bin_s: d.binS,
            },
          }),
        ),
        overallP: r.test.pOverall,
        overallName: 'mean balanced accuracy',
      };
    } else {
      const d = p.data as BehaviorDecodeData;
      const params = bayesParams(s);
      const r = await decodeAndTest<BayesOut>(
        { observed: 'observed', shuffles: 'shuffles' },
        d.input,
        params,
        s,
        'upper',
        'behaviors',
        (o) => overallStatistic(o, false),
      );
      run = {
        source: dumpSource(
          behaviorBayesDump({
            out: r.observed,
            names: d.names,
            test: r.test,
            params: bayesParamRecord(params),
          }),
        ),
        overallP: r.test.pOverall,
        overallName: 'mean recall',
      };
    }
    batch(() => {
      setBrowserRun({
        ...run,
        target: position ? 'position' : 'behaviors',
        decoder: p.decoder,
        seconds: (performance.now() - t0) / 1000,
        shuffles: s.shuffles,
        notes: NOTES,
      });
      setShownEngine('browser');
      setBrowserStatus({ kind: 'idle' });
    });
    return true;
  } catch (e) {
    if (pool !== mine) return false; // cancelled
    setBrowserStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    return false;
  } finally {
    if (pool === mine) {
      mine.dispose();
      pool = undefined;
    }
  }
}

const bayesParamRecord = (p: BayesParams): Record<string, unknown> => ({
  likelihood: p.likelihood,
  window_s: p.windowS,
  smooth_sigma_bins: p.smoothSigmaBins,
  n_folds: p.nFolds,
  sigma: p.sigma,
  prior: p.prior,
  min_frames_per_class: p.minFramesPerClass,
});
