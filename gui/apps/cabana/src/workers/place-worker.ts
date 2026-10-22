// Place-cell worker: runs the functions in lib/placecells.ts for one job at a time.
// Like the CaDecon worker, a running job cannot be cancelled; the pool is
// terminated instead (see place-pool.ts).

import { analyzePlaceCells, selectMinShift, selectSigma } from '../lib/placecells.ts';
import type { PlaceWorkerInbound, PlaceWorkerOutbound } from './place-types.ts';

const workerScope = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const post = (msg: PlaceWorkerOutbound, transfer: Transferable[] = []) =>
  workerScope.postMessage(msg, transfer);

onmessage = (e: MessageEvent<PlaceWorkerInbound>) => {
  const msg = e.data;
  if (msg.type === 'cancel') return;
  try {
    if (msg.type === 'sigma-job') {
      post({ type: 'sigma-complete', jobId: msg.jobId, result: selectSigma(msg.input) });
    } else if (msg.type === 'timescale-job') {
      post({ type: 'timescale-complete', jobId: msg.jobId, result: selectMinShift(msg.input) });
    } else {
      const result = analyzePlaceCells(msg.input, msg.params, msg.shifts, (done) =>
        post({ type: 'progress', jobId: msg.jobId, done }),
      );
      post({ type: 'cells-complete', jobId: msg.jobId, result }, [
        result.information.buffer,
        result.pInformation.buffer,
        result.stability.buffer,
        result.pStability.buffer,
        result.inOut.buffer,
        result.pFields.buffer,
        result.nFields.buffer,
        result.peak.buffer,
        result.placeCell.buffer,
        result.rate.buffer,
        result.rateA.buffer,
        result.rateB.buffer,
        result.fieldLabels.buffer,
        result.nullInformation.buffer,
        result.nullStability.buffer,
        result.nullInOut.buffer,
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
