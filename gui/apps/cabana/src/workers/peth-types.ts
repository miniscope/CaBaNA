import type { AurocMinShift } from '../lib/auroc.ts';
import type {
  PethBand,
  PethCurves,
  PethInput,
  PethParams,
  PethResult,
} from '../lib/peth.ts';

export interface PethCells {
  result: PethResult;
  curves: PethCurves;
  band?: PethBand;
}

export type PethWorkerInbound =
  | { type: 'timescale-job'; jobId: number; input: PethInput }
  | { type: 'shifts-job'; jobId: number; frames: number; minShift: number; nShuffles: number; seed: number }
  | {
      type: 'cells-job';
      jobId: number;
      input: PethInput;
      onsets: Int32Array[];
      params: PethParams;
      /** Absent when the shuffle test is off: only the observed values are computed. */
      test?: { shifts: Int32Array; correction: 'none' | 'max_stat' };
      /** Absent when the null band is off. */
      band?: { shifts: Int32Array; latencyBins: number };
    };

export interface ShiftDraw {
  shifts: Int32Array;
  unique: number;
}

export type PethWorkerOutbound =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; done: number }
  | { type: 'timescale-complete'; jobId: number; result: AurocMinShift }
  | { type: 'shifts-complete'; jobId: number; result: ShiftDraw }
  | { type: 'cells-complete'; jobId: number; result: PethCells }
  | { type: 'error'; jobId: number; message: string };
