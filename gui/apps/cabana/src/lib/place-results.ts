// A framework place-cell run read into the shapes the Place cells results views use
// (`PlaceResult` and the choices behind it). Every number is read from an array of the run;
// nothing is recomputed here. The place-cell call follows the framework's `place_cell_criteria`:
// information AND stability significant at alpha.

import type { Nd, ResultSource } from './results-load.ts';
import { loadResult, type LoadedResult } from './results-load.ts';
import type { PlaceResult, SigmaChoice, TimescaleChoice } from './placecells.ts';

export interface FrameworkPlace {
  result: PlaceResult;
  sigma: number;
  /** Present when the framework chose the smoothing (`auto_smooth_sigma`). */
  sigmaChoice?: SigmaChoice;
  minShiftS: number;
  timescale?: TimescaleChoice;
  nShuffles: number;
  distinctShifts: number;
  alpha: number;
  /** False when the run did not keep the shifted values (large runs). */
  nullKept: boolean;
}

interface Selection {
  path: string;
  value: number;
  method: string;
  candidates: number[] | null;
  scores: number[] | null;
  note: string;
}

const NAMES = ['information', 'stability', 'fields'] as const;

const float64 = (nd: Nd) => Float64Array.from(nd.data as ArrayLike<number | null>, (v) => v ?? NaN);
const float32 = (nd: Nd) => Float32Array.from(nd.data as ArrayLike<number | null>, (v) => v ?? NaN);

/**
 * The framework numbers a grid in C order over (x, y): state = ix * ny + iy. The views read
 * state = iy * nx + ix. Reorders the states of each cell's map; values are not changed.
 */
export function gridOrder<A extends Float32Array | Uint8Array>(
  maps: A,
  cells: number,
  [nx, ny]: [number, number],
): A {
  const n = nx * ny;
  const out = new (maps.constructor as new (length: number) => A)(maps.length);
  for (let c = 0; c < cells; c++)
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++) out[c * n + iy * nx + ix] = maps[c * n + ix * ny + iy];
  return out;
}

/** The saved draws are shuffle x cell; the views read cell x shuffle. */
function byCell(draws: Nd | undefined, cells: number, shuffles: number): Float32Array {
  const out = new Float32Array(cells * shuffles).fill(NaN);
  if (!draws) return out;
  for (let s = 0; s < shuffles; s++)
    for (let c = 0; c < cells; c++) out[c * shuffles + s] = draws.data[s * cells + c] ?? NaN;
  return out;
}

const pOf = (r: LoadedResult, name: string): Nd => {
  if (!r.tested) throw new Error(`The "${name}" result has no p-values.`);
  return r.tested.p;
};
const extra = (r: LoadedResult, key: string): Nd => {
  const nd = r.extras[key];
  if (!nd) throw new Error(`The "${r.meta.name}" result has no "${key}".`);
  return nd;
};

/** `tau_activity=0.133s` style numbers in a selector note. NaN when the note has no such number. */
export const tauFromNote = (note: string, key: string): number =>
  Number(new RegExp(`${key}=([0-9.eE+-]+)s`).exec(note)?.[1] ?? NaN);

export function sigmaChoiceOf(sel: Selection | undefined): SigmaChoice | undefined {
  if (!sel?.candidates || !sel.scores) return undefined;
  const best = sel.candidates[sel.scores.indexOf(Math.max(...sel.scores))];
  // The run records the standard error of the best score only, in its note: no per-width error bars.
  return {
    sigma: sel.value,
    candidates: sel.candidates,
    scores: sel.scores,
    se: sel.candidates.map(() => 0),
    best,
  };
}

export function timescaleOf(sel: Selection | undefined, tauB: string): TimescaleChoice | undefined {
  if (!sel) return undefined;
  return {
    minShiftS: sel.value,
    tauNeuralS: tauFromNote(sel.note, 'tau_activity'),
    tauPositionS: tauFromNote(sel.note, tauB),
    note: sel.note,
  };
}

export const selectionsOf = (r: LoadedResult): Selection[] =>
  ((r.meta.provenance as { selections?: Selection[] }).selections ?? []) as Selection[];

/**
 * Read the three place-cell analyses of a framework run. `fallback` supplies the values to report
 * when the run did not choose them from the data (manual smoothing or shift).
 */
export async function placeFromFramework(
  src: ResultSource,
  fallback: { sigma: number; minShiftS: number; alpha: number },
): Promise<FrameworkPlace> {
  const manifest = await src.manifest();
  const missing = NAMES.filter((n) => !manifest.results.some((r) => r.name === n));
  if (missing.length)
    throw new Error(`This run did not finish: no result for ${missing.join(', ')}.`);
  const [info, stab, fields] = await Promise.all(NAMES.map((n) => loadResult(src, manifest, n)));

  const cells = info.values.shape[0];
  const rateMap = extra(fields, 'rate_map');
  const nStates = rateMap.shape[1];
  const alpha = info.tested?.alpha ?? fallback.alpha;
  const pInformation = float64(pOf(info, 'information'));
  const pStability = float64(pOf(stab, 'stability'));

  const shifts = await src.array('information', 'sh_shifts').catch(() => undefined);
  const nShuffles = info.tested?.nShuffles ?? shifts?.shape[0] ?? 0;
  const [drawsInfo, drawsStab, drawsFields] = await Promise.all(
    [info, stab, fields].map((r) => r.nullDraws()),
  );
  const nullKept = !!(drawsInfo && drawsStab && drawsFields);
  const nShifts = drawsInfo?.shape[0] ?? nShuffles;

  const sigmaSel = selectionsOf(info).find((s) => s.path.endsWith('smooth_sigma_bins'));
  const shiftSel = selectionsOf(info).find((s) => s.path.endsWith('min_shift_s'));
  const sigmaParam = info.meta.params.smooth_sigma_bins;

  const shape = (fields.meta.provenance as { target_shape?: number[] }).target_shape;
  const grid: [number, number] =
    shape?.length === 2 ? [shape[0], shape[1]] : [Math.sqrt(nStates), Math.sqrt(nStates)];
  const ordered = <A extends Float32Array | Uint8Array>(a: A) => gridOrder(a, cells, grid);

  const result: PlaceResult = {
    cells,
    nStates,
    information: float64(info.values),
    pInformation,
    stability: float64(stab.values),
    pStability,
    inOut: float64(fields.values),
    pFields: float64(pOf(fields, 'fields')),
    nFields: float64(extra(fields, 'n_fields')),
    peak: float64(extra(fields, 'peak_rate')),
    placeCell: Uint8Array.from(pInformation, (p, i) =>
      p < alpha && pStability[i] < alpha ? 1 : 0,
    ),
    rate: ordered(float32(rateMap)),
    rateA: ordered(float32(extra(stab, 'rate_map_a'))),
    rateB: ordered(float32(extra(stab, 'rate_map_b'))),
    fieldLabels: ordered(Uint8Array.from(extra(fields, 'field_labels').data as ArrayLike<number>)),
    nShifts,
    nullInformation: byCell(drawsInfo, cells, nShifts),
    nullStability: byCell(drawsStab, cells, nShifts),
    nullInOut: byCell(drawsFields, cells, nShifts),
  };
  return {
    result,
    sigma: sigmaSel?.value ?? (typeof sigmaParam === 'number' ? sigmaParam : fallback.sigma),
    sigmaChoice: sigmaChoiceOf(sigmaSel),
    minShiftS: shiftSel?.value ?? fallback.minShiftS,
    timescale: timescaleOf(shiftSel, 'tau_target'),
    nShuffles,
    distinctShifts: shifts ? new Set(Array.from(shifts.data as ArrayLike<number>)).size : nShuffles,
    alpha,
    nullKept,
  };
}
