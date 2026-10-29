// PETH worker: runs the functions in lib/peth.ts for one job at a time.
// A running job cannot be cancelled; the pool is terminated instead (see peth-pool.ts).

import { selectAurocMinShift } from '../lib/auroc.ts';
import { analyzePeth, observedPeth, pethCurves, pethNullBand } from '../lib/peth.ts';
import { drawShifts, makeRng } from '../lib/placecells.ts';
import type { PethWorkerInbound, PethWorkerOutbound } from './peth-types.ts';

const workerScope = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const post = (msg: PethWorkerOutbound, transfer: Transferable[] = []) =>
  workerScope.postMessage(msg, transfer);

onmessage = (e: MessageEvent<PethWorkerInbound>) => {
  const msg = e.data;
  try {
    if (msg.type === 'timescale-job') {
      post({ type: 'timescale-complete', jobId: msg.jobId, result: selectAurocMinShift(msg.input) });
    } else if (msg.type === 'shifts-job') {
      const { shifts, distinct } = drawShifts(msg.frames, msg.nShuffles, msg.minShift, makeRng(msg.seed));
      post({ type: 'shifts-complete', jobId: msg.jobId, result: { shifts, unique: distinct } });
    } else {
      const { input, onsets, params, test, band: bandCfg } = msg;
      const result = test
        ? analyzePeth(input, onsets, params, test.shifts, test.correction, (done) =>
            post({ type: 'progress', jobId: msg.jobId, done }),
          )
        : {
            observed: observedPeth(input, onsets, params),
            pRaw: new Float64Array(input.cells * input.nBehaviors).fill(NaN),
            pAdj: new Float64Array(input.cells * input.nBehaviors).fill(NaN),
          };
      const curves = pethCurves(input, onsets, params);
      const band = bandCfg
        ? pethNullBand(input, onsets, params, bandCfg.shifts, bandCfg.latencyBins, curves)
        : undefined;
      const buffers = [
        result.observed,
        result.pRaw,
        result.pAdj,
        curves.peth,
        curves.sem,
        curves.timeS,
        curves.nEvents,
        curves.pPrePost,
        ...(band ? [band.lo, band.hi, band.mean, band.latencyS] : []),
      ].map((a) => a.buffer);
      post({ type: 'cells-complete', jobId: msg.jobId, result: { result, curves, band } }, buffers);
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
