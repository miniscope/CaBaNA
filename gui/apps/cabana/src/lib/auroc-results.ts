// A framework auROC run read into the shapes the auROC results views use. Observed values and
// p-values are read from the run's arrays; the shifted values of one cell come from its saved
// draws (`sh_null`), never from a recomputation.

import type { AurocResult } from './auroc.ts';
import type { AurocMinShift } from './auroc.ts';
import { loadResult, type Nd, type ResultSource } from './results-load.ts';
import { selectionsOf, tauFromNote } from './place-results.ts';
import type { MatchedDraw } from './speed-match.ts';

/** The saved shifted values: shuffle x cell x behavior, as the run stored them. */
export interface SavedDraws {
  data: Float32Array;
  shuffles: number;
  cells: number;
  behaviors: number;
}

export interface FrameworkAuroc {
  labels: string[];
  result: AurocResult;
  shifts: Int32Array;
  uniqueShifts: number;
  minShiftS: number;
  /** Present when `auto_null_timescale` chose the minimum shift. */
  timescale?: AurocMinShift;
  /** Diagnostics of a speed-matched null. */
  matched?: MatchedDraw;
  /** Frames inside each behavior, and frames the analysis used. */
  nInState: number[];
  framesUsed: number;
  /** Undefined when the run did not keep the shifted values. */
  draws?: SavedDraws;
}

const float64 = (nd: Nd) => Float64Array.from(nd.data as ArrayLike<number | null>, (v) => v ?? NaN);

/** Read the `auroc` result of a framework run. `fallbackMinShiftS` is used when the shift was set by hand. */
export async function aurocFromFramework(
  src: ResultSource,
  fallbackMinShiftS: number,
): Promise<FrameworkAuroc> {
  const manifest = await src.manifest();
  if (!manifest.results.some((r) => r.name === 'auroc'))
    throw new Error('This run did not finish: no auROC result.');
  const r = await loadResult(src, manifest, 'auroc');
  if (!r.tested) throw new Error('The auROC result has no p-values.');
  const labels = r.meta.state_names ?? [];
  const observed = float64(r.values);
  const pRaw = float64(r.tested.p);
  const shifts = Int32Array.from((await src.array('auroc', 'sh_shifts')).data as ArrayLike<number>);
  const draws = await r.nullDraws();
  const sel = selectionsOf(r).find((s) => s.path.endsWith('min_shift_s'));
  const info = r.tested.nullParams as Record<string, number | undefined>;
  const unique = new Set(shifts).size;
  return {
    labels,
    result: {
      observed,
      pRaw,
      // With no correction the adjusted p equals the raw p (also what the run stores)
      pAdj: r.tested.pAdj ? float64(r.tested.pAdj) : pRaw,
    },
    shifts,
    uniqueShifts: unique,
    minShiftS: sel?.value ?? fallbackMinShiftS,
    timescale: sel && {
      minShiftS: sel.value,
      tauNeuralS: tauFromNote(sel.note, 'tau_activity'),
      tauBehaviorS: tauFromNote(sel.note, 'tau_target'),
      note: sel.note,
    },
    matched:
      r.tested.nullName === 'covariate_matched_shift'
        ? {
            shifts,
            unique,
            candidates: info.n_candidates ?? 0,
            acceptanceRate: info.acceptance_rate ?? NaN,
            balanceMax: info.balance_max ?? NaN,
            balanceMean: info.balance_mean ?? NaN,
            reused: unique < shifts.length,
          }
        : undefined,
    nInState: Array.from(r.extras.n_in_state?.data ?? [], (v) => v ?? 0),
    framesUsed: Number((r.meta.provenance as { n_frames_used?: number }).n_frames_used ?? 0),
    draws: draws && {
      data: Float32Array.from(draws.data as ArrayLike<number | null>, (v) => v ?? NaN),
      shuffles: draws.shape[0],
      cells: draws.shape[1],
      behaviors: draws.shape[2] ?? 1,
    },
  };
}

/** The shifted values of one cell as shuffles x behaviors, from the saved draws. */
export function savedDrawsOfCell(d: SavedDraws, cell: number): Float64Array {
  const out = new Float64Array(d.shuffles * d.behaviors);
  for (let s = 0; s < d.shuffles; s++)
    for (let b = 0; b < d.behaviors; b++)
      out[s * d.behaviors + b] = d.data[(s * d.cells + cell) * d.behaviors + b];
  return out;
}
