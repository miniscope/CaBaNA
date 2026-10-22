import type {
  PlaceInput,
  PlaceParams,
  PlaceResult,
  SigmaChoice,
  TimescaleChoice,
} from '../lib/placecells.ts';

export type PlaceWorkerInbound =
  | { type: 'cancel' }
  | { type: 'sigma-job'; jobId: number; input: PlaceInput }
  | { type: 'timescale-job'; jobId: number; input: PlaceInput }
  | {
      type: 'cells-job';
      jobId: number;
      input: PlaceInput;
      params: PlaceParams;
      shifts: Int32Array;
    };

export type PlaceWorkerOutbound =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; done: number }
  | { type: 'sigma-complete'; jobId: number; result: SigmaChoice }
  | { type: 'timescale-complete'; jobId: number; result: TimescaleChoice }
  | { type: 'cells-complete'; jobId: number; result: PlaceResult }
  | { type: 'error'; jobId: number; message: string };
