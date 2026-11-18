// The auROC and Place cells explorers' data, read from the tables those runs save (`auroc.csv`,
// `place_cells.csv`). Counts and order come from the saved numbers; nothing is recomputed.

import { OVERALL, type Overall } from './place-outcome.ts';
import type { SavedTable } from './results-explorer.ts';

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? NaN : Number(s));
const cols = (t: SavedTable, names: string[]) => names.map((n) => t.columns.indexOf(n));

// ---------------------------------------------------------------- auROC

export interface AurocModel {
  behaviors: string[];
  /** Cell numbers as shown (1-based), in saved order. */
  cells: number[];
  /** auroc[cell][behavior], NaN when not evaluated. */
  auroc: number[][];
  /** Saved response labels: Excited, Inhibited, Not significant, Not evaluated, or '' without a test. */
  response: string[][];
  pAdj: number[][];
}

/** The model of a saved `auroc.csv`, or undefined when it is not that table. */
export function aurocModel(t: SavedTable | undefined): AurocModel | undefined {
  if (!t) return undefined;
  const [c, b, a, p, r] = cols(t, ['cell', 'behavior', 'auroc', 'p_adjusted', 'response']);
  if ([c, b, a].some((i) => i < 0)) return undefined;
  const behaviors = [...new Set(t.rows.map((row) => row[b]))];
  const cells = [...new Set(t.rows.map((row) => Number(row[c])))];
  const grid = <T>(fill: T) => cells.map(() => behaviors.map(() => fill));
  const m: AurocModel = { behaviors, cells, auroc: grid(NaN), response: grid(''), pAdj: grid(NaN) };
  for (const row of t.rows) {
    const i = cells.indexOf(Number(row[c]));
    const j = behaviors.indexOf(row[b]);
    m.auroc[i][j] = num(row[a]);
    m.pAdj[i][j] = p >= 0 ? num(row[p]) : NaN;
    m.response[i][j] = r >= 0 ? row[r] : '';
  }
  return m;
}

export interface ResponseCounts {
  excited: number;
  inhibited: number;
  notSignificant: number;
  evaluated: number;
  notEvaluated: number;
}

/** Counts of the saved labels over one behavior, or all behaviors when `behavior` is omitted. */
export function responseCounts(m: AurocModel, behavior?: number): ResponseCounts {
  const labels = m.response.flatMap((row) => (behavior === undefined ? row : [row[behavior]]));
  const n = (v: string) => labels.filter((x) => x === v).length;
  const notEvaluated = n('Not evaluated');
  return {
    excited: n('Excited'),
    inhibited: n('Inhibited'),
    notSignificant: n('Not significant'),
    notEvaluated,
    evaluated: labels.length - notEvaluated,
  };
}

/** Cell rows (indexes into `cells`) ordered by one behavior's auROC, highest first, blanks last. */
export function aurocOrder(m: AurocModel, behavior: number): number[] {
  const v = (i: number) => m.auroc[i][behavior];
  return m.cells
    .map((_, i) => i)
    .sort((x, y) =>
      Number.isNaN(v(x)) || Number.isNaN(v(y))
        ? Number(Number.isNaN(v(x))) - Number(Number.isNaN(v(y))) || x - y
        : v(y) - v(x) || x - y,
    );
}

// ---------------------------------------------------------------- Place cells

export interface PlaceCell {
  cell: number;
  outcome: Overall | undefined;
  information: number;
  stability: number;
  nFields: number;
  peakRate: number;
}

/** The cells of a saved `place_cells.csv`, or undefined when it is not that table. */
export function placeCells(t: SavedTable | undefined): PlaceCell[] | undefined {
  if (!t) return undefined;
  const [c, o, i, s, f, k] = cols(t, [
    'cell',
    'outcome',
    'information',
    'stability',
    'n_fields',
    'peak_rate',
  ]);
  if ([c, o, i, s].some((x) => x < 0)) return undefined;
  return t.rows.map((row) => ({
    cell: Number(row[c]),
    outcome: row[o] in OVERALL ? (row[o] as Overall) : undefined,
    information: num(row[i]),
    stability: num(row[s]),
    nFields: f >= 0 ? num(row[f]) : NaN,
    peakRate: k >= 0 ? num(row[k]) : NaN,
  }));
}

/** How many cells have each saved outcome. */
export function outcomeCounts(cells: PlaceCell[]): Record<Overall, number> {
  const out = { both: 0, info: 0, stab: 0, neither: 0, cannot: 0 };
  for (const c of cells) if (c.outcome) out[c.outcome] += 1;
  return out;
}
