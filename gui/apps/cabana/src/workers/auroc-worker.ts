// auROC worker: runs the functions in lib/auroc.ts and lib/speed-match.ts for one job at a time.
// A running job cannot be cancelled; the pool is terminated instead (see auroc-pool.ts).

import { analyzeAuroc, matchGroupsOf, selectAurocMinShift } from '../lib/auroc.ts';
import { drawShifts, makeRng } from '../lib/placecells.ts';
import { acceptShifts, candidateOrder } from '../lib/speed-match.ts';
import type { AurocWorkerInbound, AurocWorkerOutbound } from './auroc-types.ts';

const workerScope = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const post = (msg: AurocWorkerOutbound, transfer: Transferable[] = []) =>
  workerScope.postMessage(msg, transfer);

onmessage = (e: MessageEvent<AurocWorkerInbound>) => {
  const msg = e.data;
  try {
    if (msg.type === 'timescale-job') {
      post({ type: 'timescale-complete', jobId: msg.jobId, result: selectAurocMinShift(msg.input) });
    } else if (msg.type === 'shifts-job') {
      const rng = makeRng(msg.seed);
      const n = msg.input.frames;
      if (msg.match) {
        const { groups } = matchGroupsOf(msg.input, msg.match.options.minFrames);
        if (!groups.length)
          throw new Error('No selected behavior has enough included frames to match speed.');
        const matched = acceptShifts(
          msg.match.speed,
          groups,
          candidateOrder(n, msg.minShift, rng),
          msg.nShuffles,
          msg.match.options,
          rng,
        );
        post({
          type: 'shifts-complete',
          jobId: msg.jobId,
          result: { shifts: matched.shifts, unique: matched.unique, matched },
        });
      } else {
        const { shifts, distinct } = drawShifts(n, msg.nShuffles, msg.minShift, rng);
        post({ type: 'shifts-complete', jobId: msg.jobId, result: { shifts, unique: distinct } });
      }
    } else {
      const result = analyzeAuroc(msg.input, msg.shifts, msg.correction, undefined, (done) =>
        post({ type: 'progress', jobId: msg.jobId, done }),
      );
      post({ type: 'cells-complete', jobId: msg.jobId, result }, [
        result.observed.buffer,
        result.pRaw.buffer,
        result.pAdj.buffer,
      ]);
    }
  } catch (err) {
    post({
      type: 'error',
      jobId: msg.jobId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

post({ type: 'ready' });
