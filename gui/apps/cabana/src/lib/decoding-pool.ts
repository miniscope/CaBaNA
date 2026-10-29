// The worker pool for decoding jobs, the same shape as the PETH one (peth-pool.ts).

import {
  createWorkerPool,
  getWorkersOverride,
  type BaseJob,
  type MessageRouter,
  type WorkerPool,
} from '@calab/compute';
import type { BayesInput, BayesOut } from './decode-bayes.ts';
import type { LinearInput, LinearOut } from './decode-linear.ts';
import type {
  DecodingWorkerInbound,
  DecodingWorkerOutbound,
  LinearWorkerInbound,
  ShuffleBatch,
} from '../workers/decoding-types.ts';

type Fields<T> = T extends { type: string; jobId: number } ? Omit<T, 'type' | 'jobId'> : never;
export type DecodingPoolJob = BaseJob &
  (
    | ({ kind: 'observed'; onComplete(r: BayesOut): void } & Fields<
        Extract<DecodingWorkerInbound, { type: 'observed-job' }>
      >)
    | ({ kind: 'linear-observed'; onComplete(r: LinearOut): void } & Fields<
        Extract<LinearWorkerInbound, { type: 'linear-observed-job' }>
      >)
    | ({
        kind: 'linear-shuffles';
        onProgress(done: number): void;
        onComplete(r: ShuffleBatch): void;
      } & Fields<Extract<LinearWorkerInbound, { type: 'linear-shuffles-job' }>>)
    | ({
        kind: 'shuffles';
        onProgress(done: number): void;
        onComplete(r: ShuffleBatch): void;
      } & Fields<Extract<DecodingWorkerInbound, { type: 'shuffles-job' }>>)
  );

const router: MessageRouter<DecodingPoolJob, DecodingWorkerOutbound> = {
  isReady: (msg) => msg.type === 'ready',
  getJobId: (msg) => ('jobId' in msg ? msg.jobId : undefined),
  routeMessage(job, msg, finish) {
    if (msg.type === 'progress') {
      if (job.kind === 'shuffles' || job.kind === 'linear-shuffles') job.onProgress(msg.done);
    } else if (msg.type === 'error') {
      finish();
      job.onError(msg.message);
    } else if ('result' in msg) {
      finish();
      (job.onComplete as (r: unknown) => void)(msg.result);
    }
  },
  // Each job gets its own copy of the data, so the main thread keeps its arrays.
  buildDispatch(job) {
    const { kind, jobId, ...rest } = job as Record<string, unknown> & typeof job;
    // Callbacks stay on this side; only data goes to the worker.
    const data = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => typeof v !== 'function'),
    );
    const src = (job as { input: BayesInput | LinearInput }).input;
    const input = {
      ...src,
      neural:
        src.neural instanceof Float64Array
          ? src.neural.slice()
          : Float32Array.from(src.neural as ArrayLike<number>),
      labels: src.labels.slice(),
      mask: src.mask.slice(),
      ...('centers' in src && src.centers ? { centers: src.centers.slice() } : {}),
    };
    const buffers = [(input.neural as Float32Array).buffer, input.labels.buffer, input.mask.buffer];
    if ('centers' in input && input.centers) buffers.push((input.centers as Float64Array).buffer);
    return [{ ...data, type: `${kind}-job`, jobId, input }, buffers as ArrayBuffer[]];
  },
};

// Half the cores, at most 4, as for the other analyses. `?workers=N` overrides it.
const poolSize = () =>
  getWorkersOverride() ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) >> 1));

export function createDecodingWorkerPool(): WorkerPool<DecodingPoolJob> {
  return createWorkerPool<DecodingPoolJob, DecodingWorkerOutbound>(
    () => new Worker(new URL('../workers/decoding-worker.ts', import.meta.url), { type: 'module' }),
    router,
    poolSize(),
  );
}
