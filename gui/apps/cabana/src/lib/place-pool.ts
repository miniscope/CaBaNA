// The worker pool for place-cell jobs, the same shape as CaDecon's (cadecon-pool.ts):
// jobs are queued on the shared @calab/compute pool and settle through callbacks.

import {
  createWorkerPool,
  getWorkersOverride,
  type BaseJob,
  type MessageRouter,
  type WorkerPool,
} from '@calab/compute';
import type {
  PlaceInput,
  PlaceParams,
  PlaceResult,
  SigmaChoice,
  TimescaleChoice,
} from './placecells.ts';
import type { PlaceWorkerOutbound } from '../workers/place-types.ts';

export type PlacePoolJob = BaseJob &
  (
    | { kind: 'sigma'; input: PlaceInput; onComplete(r: SigmaChoice): void }
    | { kind: 'timescale'; input: PlaceInput; onComplete(r: TimescaleChoice): void }
    | {
        kind: 'cells';
        input: PlaceInput;
        params: PlaceParams;
        shifts: Int32Array;
        onProgress(done: number): void;
        onComplete(r: PlaceResult): void;
      }
  );

const router: MessageRouter<PlacePoolJob, PlaceWorkerOutbound> = {
  isReady: (msg) => msg.type === 'ready',
  getJobId: (msg) => ('jobId' in msg ? msg.jobId : undefined),
  routeMessage(job, msg, finish) {
    switch (msg.type) {
      case 'progress':
        if (job.kind === 'cells') job.onProgress(msg.done);
        break;
      case 'sigma-complete':
        finish();
        if (job.kind === 'sigma') job.onComplete(msg.result);
        break;
      case 'timescale-complete':
        finish();
        if (job.kind === 'timescale') job.onComplete(msg.result);
        break;
      case 'cells-complete':
        finish();
        if (job.kind === 'cells') job.onComplete(msg.result);
        break;
      case 'error':
        finish();
        job.onError(msg.message);
        break;
    }
  },
  // Each job sends its own copy of the data, so the main thread keeps its arrays.
  buildDispatch(job) {
    const input = {
      ...job.input,
      neural: job.input.neural.slice(),
      labels: job.input.labels.slice(),
    };
    const msg =
      job.kind === 'cells'
        ? { type: 'cells-job', jobId: job.jobId, input, params: job.params, shifts: job.shifts }
        : { type: `${job.kind}-job`, jobId: job.jobId, input };
    return [msg, [input.neural.buffer, input.labels.buffer]];
  },
};

// Half the cores, at most 4. Using every core left the browser too starved to answer clicks,
// and Chrome offered to kill the page during a run. `?workers=N` still overrides it.
const poolSize = () =>
  getWorkersOverride() ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) >> 1));

export function createPlaceWorkerPool(): WorkerPool<PlacePoolJob> {
  return createWorkerPool<PlacePoolJob, PlaceWorkerOutbound>(
    () => new Worker(new URL('../workers/place-worker.ts', import.meta.url), { type: 'module' }),
    router,
    poolSize(),
  );
}
