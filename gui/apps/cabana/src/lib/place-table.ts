// The cell list of a place-cell run: one row per cell, filtered, searched and sorted.

import { OVERALL_ORDER, outcomeOf, type Overall, type Test } from './place-outcome.ts';
import type { PlaceOutcome } from './place-run.ts';

export type Filter = 'all' | Overall;
export type SortKey =
  | 'cell'
  | 'overall'
  | 'information'
  | 'stability'
  | 'pInformation'
  | 'pStability'
  | 'peak'
  | 'inOut'
  | 'nFields';

/** The sort choices, with the direction each starts in (true: high to low). */
export const SORTS: { key: SortKey; label: string; desc: boolean }[] = [
  { key: 'information', label: 'Spatial information', desc: true },
  { key: 'stability', label: 'Spatial stability', desc: true },
  { key: 'pInformation', label: 'Information p', desc: false },
  { key: 'pStability', label: 'Stability p', desc: false },
  { key: 'peak', label: 'Peak event rate', desc: true },
  { key: 'inOut', label: 'Inside / outside rate', desc: true },
  { key: 'nFields', label: 'Number of fields', desc: true },
  { key: 'overall', label: 'Outcome', desc: false },
  { key: 'cell', label: 'Cell number', desc: false },
];

export interface Row {
  /** Row of the cell in the run's results. */
  i: number;
  /** Row of the cell in the loaded neural data; shown as id + 1. */
  id: number;
  info: Test;
  stab: Test;
  overall: Overall;
}

export const buildRows = (out: PlaceOutcome): Row[] =>
  out.data.cellIds.map((id, i) => ({ i, id, ...outcomeOf(out, i) }));

export function countOutcomes(rows: Row[]): Record<Overall, number> {
  const c = Object.fromEntries(OVERALL_ORDER.map((k) => [k, 0])) as Record<Overall, number>;
  for (const row of rows) c[row.overall]++;
  return c;
}

/** The rows that pass the filter and the cell-number search, sorted. A value that is undefined sorts last. */
export function listRows(
  rows: Row[],
  out: PlaceOutcome,
  { filter, query, sort, desc }: { filter: Filter; query: string; sort: SortKey; desc: boolean },
): Row[] {
  const sign = desc ? -1 : 1;
  const q = query.trim();
  const value = (row: Row) =>
    sort === 'cell'
      ? row.id
      : sort === 'overall'
        ? OVERALL_ORDER.indexOf(row.overall)
        : out.result[sort][row.i];
  return rows
    .filter(
      (row) =>
        (filter === 'all' || row.overall === filter) && (!q || String(row.id + 1).startsWith(q)),
    )
    .sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
      return sign * (x - y) || a.id - b.id;
    });
}
