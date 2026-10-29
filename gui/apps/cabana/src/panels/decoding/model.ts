// What the decoding result views display, as plain rows and cells. Every number is read from the
// framework's arrays; the only things made here are display groupings (histogram bins, grid
// placement, row order).

import type { BehaviorDecodingView, PositionDecodingView } from '../../lib/decoding-results.ts';
import { exportNotes, toCsv } from '../../lib/export-figure.ts';
import { finite, type Nd } from '../../lib/results-load.ts';

export const fmt = (v: number | null | undefined, digits = 3): string =>
  v == null || !Number.isFinite(v) ? 'n/a' : String(+v.toFixed(digits));
export const fmtP = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? 'n/a' : v < 0.001 ? '< 0.001' : v.toFixed(3);

/** Statement shown beside the overall value while the framework cannot test it. */
export const OVERALL_NOT_TESTED =
  'Overall value not tested (needs a framework update); the per-bin tests are unaffected';
export const OVERALL_NOT_TESTED_BEHAVIOR =
  'Overall value not tested (needs a framework update); the per-behavior tests are unaffected';

export interface Stat {
  label: string;
  value: string;
  note?: string;
}

export function positionStats(v: PositionDecodingView): Stat[] {
  const evaluated = v.excluded.filter((x) => !x).length;
  // frames with a decoded position: the per-frame error is finite exactly there
  const decoded = v.frameError ? Array.from(v.frameError.data).filter(finite).length : null;
  return [
    {
      label: 'Overall median error',
      value: fmt(v.overall.value, 2),
      note: v.overall.testNote ? OVERALL_NOT_TESTED : 'Tested against the shuffled null',
    },
    { label: 'Chance error', value: fmt(v.overall.chance, 2), note: 'Expected by guessing' },
    { label: 'Frames decoded', value: decoded == null ? 'n/a' : decoded.toLocaleString() },
    { label: 'Bins evaluated', value: `${evaluated} of ${v.bins.length}` },
  ];
}

export function behaviorStats(v: BehaviorDecodingView): Stat[] {
  return [
    {
      label: 'Overall accuracy',
      value: fmt(v.overall.value),
      note: v.overall.testNote ? OVERALL_NOT_TESTED_BEHAVIOR : 'Tested against the shuffled null',
    },
    { label: 'Chance', value: fmt(v.overall.chance), note: 'Expected by guessing' },
    { label: 'Behaviors', value: String(v.states.length) },
  ];
}

export interface BinCell {
  bin: string;
  /** Column (first grid axis) and row (second axis) of the bin, as the framework numbered them. */
  col: number;
  row: number;
  error: number | null;
  excluded: boolean;
  p: number | null;
  pAdj: number | null;
  significant: boolean;
  significantAdj: boolean;
}

const flag = (nd: Nd | null | undefined, i: number): boolean => !!nd && Number(nd.data[i]) === 1;

/** One cell per bin. The framework numbers bins with the first axis slowest. */
export function binCells(v: PositionDecodingView): BinCell[] | undefined {
  if (!v.gridShape || v.gridShape.length !== 2) return undefined;
  const [, rows] = v.gridShape;
  return v.bins.map((bin, i) => ({
    bin,
    col: Math.floor(i / rows),
    row: i % rows,
    error: v.medianErrorPerBin[i],
    excluded: v.excluded[i],
    p: v.p[i] ?? null,
    pAdj: v.pAdj?.[i] ?? null,
    significant: flag(v.tested?.significant, i),
    significantAdj: flag(v.tested?.significantAdj, i),
  }));
}

/** Color limits of the map: the framework values' range unless the user set them. */
export function errorRange(cells: BinCell[]): [number, number] {
  const f = cells.map((c) => c.error).filter(finite);
  return f.length ? [Math.min(...f), Math.max(...f)] : [0, 1];
}

export interface Histogram {
  edges: number[];
  counts: number[];
}
/** Display grouping of the per-frame errors into `n` equal-width bins. */
export function errorHistogram(error: ArrayLike<number | null>, n = 30): Histogram | undefined {
  const values: number[] = [];
  for (let i = 0; i < error.length; i++) {
    const e = error[i];
    if (e != null && Number.isFinite(e)) values.push(e);
  }
  if (!values.length) return undefined;
  let lo = values[0];
  let hi = values[0];
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const width = (hi - lo) / n || 1;
  const counts = new Array<number>(n).fill(0);
  for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
  return { edges: Array.from({ length: n + 1 }, (_, i) => lo + i * width), counts };
}

export interface BehaviorRow {
  name: string;
  score: number | null;
  nullLo: number | null;
  nullHi: number | null;
  p: number | null;
  pAdj: number | null;
  significant: boolean;
}
export function behaviorRows(v: BehaviorDecodingView): BehaviorRow[] {
  // a run without correction still stores adjusted arrays; they are not shown as corrected
  const corrected = !!v.pAdj && !!v.tested?.correction && v.tested.correction !== 'none';
  return v.states.map((name, i) => ({
    name,
    score: v.score[i],
    nullLo: v.nullLo[i],
    nullHi: v.nullHi[i],
    p: v.p[i],
    pAdj: corrected ? (v.pAdj![i] ?? null) : null,
    significant: flag(corrected ? v.tested?.significantAdj : v.tested?.significant, i),
  }));
}

export interface OneVsRest {
  behavior: string;
  tn: number;
  fp: number;
  fn: number;
  tp: number;
}
/** One 2 x 2 table per behavior, rows = true, columns = decoded, index 1 = in the behavior. */
export function oneVsRestTables(v: BehaviorDecodingView): OneVsRest[] {
  const c = v.confusion;
  if (!c || v.confusionKind !== 'one_vs_rest') return [];
  return v.states.map((behavior, i) => {
    const at = (k: number) => Number(c.data[i * 4 + k]);
    return { behavior, tn: at(0), fp: at(1), fn: at(2), tp: at(3) };
  });
}

/** Confusion matrix for display: counts, or the row shares the framework view provides. */
export function confusionMatrix(
  v: BehaviorDecodingView,
  normalize: boolean,
): number[][] | undefined {
  if (v.confusionKind !== 'matrix' || !v.confusion) return undefined;
  if (normalize) return v.rowShares();
  const [rows, cols] = v.confusion.shape;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => Number(v.confusion!.data[i * cols + j] ?? 0)),
  );
}

type RunLike = { scope: string; analysis: string; run_id: string };
const bool = (b: boolean) => (b ? 'yes' : 'no');

export function positionCsv(v: PositionDecodingView, run: RunLike): string {
  const cells = binCells(v);
  return toCsv(
    [
      'bin',
      'grid_column',
      'grid_row',
      'median_error',
      'excluded_too_few_frames',
      'p_uncorrected',
      'p_corrected',
      'significant_uncorrected',
      'significant_corrected',
    ],
    v.bins.map((bin, i) => {
      const c = cells?.[i];
      return [
        bin,
        c?.col,
        c?.row,
        v.medianErrorPerBin[i],
        bool(v.excluded[i]),
        v.p[i],
        v.pAdj?.[i],
        c ? bool(c.significant) : '',
        c ? bool(c.significantAdj) : '',
      ];
    }),
    [
      ...exportNotes(run),
      `overall median error ${v.overall.value}; chance error ${v.overall.chance}`,
      v.overall.testNote ? OVERALL_NOT_TESTED : 'overall value tested',
      v.label,
    ],
  );
}

export function behaviorCsv(v: BehaviorDecodingView, run: RunLike): string {
  return toCsv(
    ['behavior', 'score', 'null_low', 'null_high', 'p_uncorrected', 'p_corrected', 'significant'],
    behaviorRows(v).map((r) => [
      r.name,
      r.score,
      r.nullLo,
      r.nullHi,
      r.p,
      r.pAdj,
      bool(r.significant),
    ]),
    [
      ...exportNotes(run),
      `overall accuracy ${v.overall.value}; chance ${v.overall.chance}`,
      v.overall.testNote ? OVERALL_NOT_TESTED_BEHAVIOR : 'overall value tested',
      v.label,
    ],
  );
}
