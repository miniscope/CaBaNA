// The worker pool for PETH jobs, the same shape as the auROC one (auroc-pool.ts).

import {
  createWorkerPool,
  getWorkersOverride,
  type BaseJob,
  type MessageRouter,
  type WorkerPool,
} from '@calab/compute';
import type { AurocMinShift } from './auroc.ts';
import type { PethInput } from './peth.ts';
import type {
  PethCells,
  PethWorkerInbound,
  PethWorkerOutbound,
  ShiftDraw,
} from '../workers/peth-types.ts';

type Fields<T> = T extends { type: string; jobId: number } ? Omit<T, 'type' | 'jobId'> : never;
export type PethPoolJob = BaseJob &
  (
    | { kind: 'timescale'; input: PethInput; onComplete(r: AurocMinShift): void }
    | ({ kind: 'shifts'; onComplete(r: ShiftDraw): void } & Fields<
        Extract<PethWorkerInbound, { type: 'shifts-job' }>
      >)
    | ({ kind: 'cells'; onProgress(done: number): void; onComplete(r: PethCells): void } & Fields<
        Extract<PethWorkerInbound, { type: 'cells-job' }>
      >)
  );

const router: MessageRouter<PethPoolJob, PethWorkerOutbound> = {
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
    const { kind, jobId, ...rest } = job as Record<string, unknown> & typeof job;
    // Callbacks stay on this side; only data goes to the worker.
    const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
    const src = (job as { input?: PethInput }).input;
    if (!src) return [{ ...data, type: `${kind}-job`, jobId }, []];
    const input = {
      ...src,
      neural: src.neural.slice(),
      behaviors: src.behaviors.slice(),
      mask: src.mask.slice(),
    };
    return [
      { ...data, type: `${kind}-job`, jobId, input },
      [input.neural.buffer, input.behaviors.buffer, input.mask.buffer],
    ];
  },
};

// Half the cores, at most 4, as for auROC. `?workers=N` overrides it.
const poolSize = () =>
  getWorkersOverride() ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) >> 1));

export function createPethWorkerPool(): WorkerPool<PethPoolJob> {
  return createWorkerPool<PethPoolJob, PethWorkerOutbound>(
    () => new Worker(new URL('../workers/peth-worker.ts', import.meta.url), { type: 'module' }),
    router,
    poolSize(),
  );
}
