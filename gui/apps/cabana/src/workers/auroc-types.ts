import type { AurocInput, AurocMinShift, AurocResult } from '../lib/auroc.ts';
import type { MatchedDraw, MatchOptions } from '../lib/speed-match.ts';

export type AurocWorkerInbound =
  | { type: 'timescale-job'; jobId: number; input: AurocInput }
  | {
      type: 'shifts-job';
      jobId: number;
      input: AurocInput;
      minShift: number;
      nShuffles: number;
      seed: number;
      /** Set for the speed-matched null: the speed signal and how closely to match it. */
      match?: { speed: Float64Array; options: MatchOptions };
    }
  | {
      type: 'cells-job';
      jobId: number;
      input: AurocInput;
      shifts: Int32Array;
      correction: 'none' | 'max_stat';
    };

export interface ShiftDraw {
  shifts: Int32Array;
  unique: number;
  /** Only with speed matching. */
  matched?: MatchedDraw;
}

export type AurocWorkerOutbound =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; done: number }
  | { type: 'timescale-complete'; jobId: number; result: AurocMinShift }
  | { type: 'shifts-complete'; jobId: number; result: ShiftDraw }
  | { type: 'cells-complete'; jobId: number; result: AurocResult }
  | { type: 'error'; jobId: number; message: string };
