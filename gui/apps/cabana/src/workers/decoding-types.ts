import type { BayesInput, BayesOut, BayesParams } from '../lib/decode-bayes.ts';

export type DecodingWorkerInbound =
  | { type: 'observed-job'; jobId: number; input: BayesInput; params: BayesParams }
  | {
      type: 'shuffles-job';
      jobId: number;
      input: BayesInput;
      params: BayesParams;
      blockS: number;
      seed: number;
      /** Shuffles `from` to `to - 1`: each one has its own generator, so the split does not change the draws. */
      from: number;
      to: number;
    };

export interface ShuffleBatch {
  /** (to - from) x states, and one overall statistic per shuffle. */
  values: Float64Array;
  overall: Float64Array;
}

export type DecodingWorkerOutbound =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; done: number }
  | { type: 'observed-complete'; jobId: number; result: BayesOut }
  | { type: 'shuffles-complete'; jobId: number; result: ShuffleBatch }
  | { type: 'error'; jobId: number; message: string };
