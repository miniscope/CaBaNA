// Decoding worker: runs the functions in lib/decode-bayes.ts and lib/decode-test.ts for one job at a time.
// A running job cannot be cancelled; the pool is terminated instead (see decoding-pool.ts).

import { makeBayesDecoder } from '../lib/decode-bayes.ts';
import { runShuffles } from '../lib/decode-test.ts';
import type { DecodingWorkerInbound, DecodingWorkerOutbound } from './decoding-types.ts';

const workerScope = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const post = (msg: DecodingWorkerOutbound, transfer: Transferable[] = []) =>
  workerScope.postMessage(msg, transfer);

onmessage = (e: MessageEvent<DecodingWorkerInbound>) => {
  const msg = e.data;
  try {
    if (msg.type === 'observed-job') {
      const result = makeBayesDecoder(msg.input, msg.params)();
      post({ type: 'observed-complete', jobId: msg.jobId, result }, [
        result.values.buffer,
        result.confusion.buffer,
        result.decoded.buffer,
        result.error.buffer,
        result.errGuess.buffer,
        result.confPost.buffer,
        result.nFrames.buffer,
        result.valid.buffer,
        result.usedFrames.buffer,
        result.folds.buffer,
      ]);
    } else {
      const { input, params, blockS, seed, from, to } = msg;
      const result = runShuffles(input, params, blockS, seed, from, to, (done) =>
        post({ type: 'progress', jobId: msg.jobId, done }),
      );
      post({ type: 'shuffles-complete', jobId: msg.jobId, result }, [result.values.buffer, result.overall.buffer]);
    }
  } catch (err) {
    post({ type: 'error', jobId: msg.jobId, message: err instanceof Error ? err.message : String(err) });
  }
};

post({ type: 'ready' });
