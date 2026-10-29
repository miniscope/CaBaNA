import type { Accessor, Setter } from 'solid-js';
import type { Overall } from '../lib/place-outcome.ts';
import type { PlaceOutcome } from '../lib/place-run.ts';
import type { Filter, Row, SortKey } from '../lib/place-table.ts';
import { OVERALL, OVERALL_ORDER, outcomeOf, type Test } from '../lib/place-outcome.ts';

/** What the three results views share: the run, the filtered cell list, and the selected cell. */
export interface ResultsCtx {
  out: PlaceOutcome;
  rows: Accessor<Row[]>;
  /** The rows that pass the filter and search, sorted. */
  list: Accessor<Row[]>;
  counts: Accessor<Record<Overall, number>>;
  filter: Accessor<Filter>;
  setFilter: Setter<Filter>;
  query: Accessor<string>;
  setQuery: Setter<string>;
  sort: Accessor<SortKey>;
  desc: Accessor<boolean>;
  setSort: (key: SortKey, desc: boolean) => void;
  /** Row of the selected cell in the run's results, or -1. */
  selected: Accessor<number>;
  /** Place of the selected cell in `list`, or -1 when the filter hides it. */
  position: Accessor<number>;
  pick: (i: number) => void;
  step: (d: 1 | -1) => void;
  openInspector: () => void;
}

export const FILTERS: [Filter, string][] = [
  ['all', 'All cells'],
  ...OVERALL_ORDER.map((k): [Filter, string] => [k, OVERALL[k].filter]),
];

export const p3 = (p: number) => (Number.isNaN(p) ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));
export const pText = (p: number) =>
  Number.isNaN(p) ? 'p undefined' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
export const num = (v: number, d = 2) => (Number.isNaN(v) ? '–' : v.toFixed(d));

/** The class that colors an outcome, so the same color means the same thing on every screen. */
export const outcomeClass = (o: Overall) => `cb-oc cb-oc--${o}`;

export const testsOf = (out: PlaceOutcome, i: number): { info: Test; stab: Test } =>
  outcomeOf(out, i);
