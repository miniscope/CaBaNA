// The worker pool for auROC jobs, the same shape as the place-cell one (place-pool.ts).

import {
  createWorkerPool,
  getWorkersOverride,
  type BaseJob,
  type MessageRouter,
  type WorkerPool,
} from '@calab/compute';
import type { AurocInput, AurocMinShift, AurocResult } from './auroc.ts';
import type {
  AurocWorkerInbound,
  AurocWorkerOutbound,
  ShiftDraw,
} from '../workers/auroc-types.ts';

type Fields<T> = T extends { type: string; jobId: number } ? Omit<T, 'type' | 'jobId'> : never;
export type AurocPoolJob = BaseJob &
  (
    | { kind: 'timescale'; input: AurocInput; onComplete(r: AurocMinShift): void }
    | ({ kind: 'shifts'; onComplete(r: ShiftDraw): void } & Fields<
        Extract<AurocWorkerInbound, { type: 'shifts-job' }>
      >)
    | ({ kind: 'cells'; onProgress(done: number): void; onComplete(r: AurocResult): void } & Fields<
        Extract<AurocWorkerInbound, { type: 'cells-job' }>
      >)
  );

const router: MessageRouter<AurocPoolJob, AurocWorkerOutbound> = {
  isReady: (msg) => msg.type === 'ready',
  getJobId: (msg) => ('jobId' in msg ? msg.jobId : undefined),
  routeMessage(job, msg, finish) {
    if (msg.type === 'progress') {
      if (job.kind === 'cells') job.onProgress(msg.done);
    } else if (msg.type === 'error') {
      finish();
      job.onError(msg.message);
    } else if ('result' in msg) {
      finish();
      (job.onComplete as (r: unknown) => void)(msg.result);
    }
  },
  // Each job sends its own copy of the data, so the main thread keeps its arrays.
  buildDispatch(job) {
    const input = {
      ...job.input,
      neural: job.input.neural.slice(),
      behaviors: job.input.behaviors.slice(),
      mask: job.input.mask.slice(),
    };
    const { kind, jobId, input: _in, ...rest } = job as Record<string, unknown> & typeof job;
    // Callbacks stay on this side; only data goes to the worker.
    const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
    const msg = { ...data, type: `${kind}-job`, jobId, input };
    return [msg, [input.neural.buffer, input.behaviors.buffer, input.mask.buffer]];
  },
};

// Half the cores, at most 4, as for place cells. `?workers=N` overrides it.
const poolSize = () =>
  getWorkersOverride() ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) >> 1));

export function createAurocWorkerPool(): WorkerPool<AurocPoolJob> {
  return createWorkerPool<AurocPoolJob, AurocWorkerOutbound>(
    () => new Worker(new URL('../workers/auroc-worker.ts', import.meta.url), { type: 'module' }),
    router,
    poolSize(),
  );
}
