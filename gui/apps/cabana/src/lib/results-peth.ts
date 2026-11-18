// The PETH explorer's data, read from the two tables a PETH run saves (`peth.csv`: one row per cell
// and behavior; `peth_curves.csv`: the mean curve of each). The population heat map and the mean
// curve are drawn from these saved numbers only; nothing is recomputed from the neural data.

import { DEFAULT_STYLE, PLOT_SPEC_VERSION, type PlotSpec } from './plot-spec.ts';
import type { SavedTable } from './results-explorer.ts';
import type { RunRecord } from './bridge-client.ts';
import { deltaColor, niceLimit } from './peth-view.ts';

export type PethResponse = 'Excited' | 'Inhibited' | 'Not significant' | 'Not evaluated' | '';

export interface PethCell {
  /** Cell number as shown (1-based). */
  cell: number;
  /** Mean response minus mean baseline over onsets (a.u.). NaN when not evaluated. */
  value: number;
  /** Response label from the saved shuffle test; '' when the run had no test. */
  response: PethResponse;
  latencyS: number;
  /** Mean curve over the time bins of the model. */
  mean: Float64Array;
}

export interface PethBehavior {
  label: string;
  onsets: number;
  /** Cells in heat map order: largest response first, cells without a value last. */
  cells: PethCell[];
}

export interface PethModel {
  timeS: number[];
  behaviors: PethBehavior[];
  /** The run held a shuffle test, so its pairs carry response labels. */
  hasTest: boolean;
  /** The curves were baseline-subtracted (each onset minus its own baseline mean). */
  baselineSubtracted: boolean;
  baselineS?: [number, number];
  responseS?: [number, number];
}

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? NaN : Number(s));
const col = (t: SavedTable, name: string) => t.columns.indexOf(name);
const pair = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')
    ? [v[0], v[1]]
    : undefined;

/** Heat map order: largest response first; cells without a value last, in cell order. */
const byResponse = (a: PethCell, b: PethCell) => {
  const [x, y] = [a.value, b.value];
  if (Number.isNaN(x) || Number.isNaN(y))
    return Number.isNaN(x) ? (Number.isNaN(y) ? a.cell - b.cell : 1) : -1;
  return y - x || a.cell - b.cell;
};

/**
 * The model of a saved PETH run, or undefined when the tables are not the expected ones. The
 * window comes from `metadata.json` when that is saved too.
 */
export function pethModel(
  pairs: SavedTable | undefined,
  curves: SavedTable | undefined,
  metadata?: unknown,
): PethModel | undefined {
  if (!pairs || !curves) return undefined;
  const [pc, pb, pn, pv, pr, pl] = [
    'cell',
    'behavior',
    'onsets',
    'value_au',
    'response',
    'latency_s',
  ].map((n) => col(pairs, n));
  const [cc, cb, ct, cm] = ['cell', 'behavior', 'time_s', 'mean'].map((n) => col(curves, n));
  if ([pc, pb, pn, pv, cc, cb, ct, cm].some((i) => i < 0)) return undefined;

  const means = new Map<string, number[]>();
  const timeS: number[] = [];
  let first: string | undefined;
  for (const r of curves.rows) {
    const key = `${r[cb]}\u0000${r[cc]}`;
    first ??= key;
    if (key === first) timeS.push(num(r[ct]));
    const list = means.get(key) ?? [];
    list.push(num(r[cm]));
    means.set(key, list);
  }

  const order: string[] = [];
  const byBehavior = new Map<string, { onsets: number; cells: PethCell[] }>();
  for (const r of pairs.rows) {
    const label = r[pb];
    if (!byBehavior.has(label)) {
      order.push(label);
      byBehavior.set(label, { onsets: num(r[pn]), cells: [] });
    }
    byBehavior.get(label)!.cells.push({
      cell: Number(r[pc]),
      value: num(r[pv]),
      response: (pr >= 0 ? r[pr] : '') as PethResponse,
      latencyS: pl >= 0 ? num(r[pl]) : NaN,
      mean: Float64Array.from(means.get(`${label}\u0000${r[pc]}`) ?? []),
    });
  }

  const window = (metadata as { window?: Record<string, unknown> } | undefined)?.window;
  return {
    timeS,
    behaviors: order.map((label) => {
      const b = byBehavior.get(label)!;
      return { label, onsets: b.onsets, cells: b.cells.sort(byResponse) };
    }),
    hasTest: pairs.rows.some((r) => pr >= 0 && r[pr] !== ''),
    baselineSubtracted: curves.notes.some((n) => n.includes('minus its own baseline')),
    baselineS: pair(window?.baseline_s),
    responseS: pair(window?.response_s),
  };
}

export interface PethCounts {
  excited: number;
  inhibited: number;
  notSignificant: number;
  /** Pairs with a value, the ones the counts above are out of. */
  evaluated: number;
  notEvaluated: number;
}

/** Counts of the saved response labels for one behavior, or for all when `behavior` is omitted. */
export function pethCounts(m: PethModel, behavior?: number): PethCounts {
  const cells = (behavior === undefined ? m.behaviors : [m.behaviors[behavior]]).flatMap(
    (b) => b?.cells ?? [],
  );
  const n = (r: PethResponse) => cells.filter((c) => c.response === r).length;
  const notEvaluated = cells.filter(
    (c) => c.response === 'Not evaluated' || Number.isNaN(c.value),
  ).length;
  return {
    excited: n('Excited'),
    inhibited: n('Inhibited'),
    notSignificant: n('Not significant'),
    evaluated: cells.length - notEvaluated,
    notEvaluated,
  };
}

/** Cells with a significant response for one behavior, in saved order. */
export const significantCells = (b: PethBehavior): PethCell[] =>
  b.cells.filter((c) => c.response === 'Excited' || c.response === 'Inhibited');

export type SortKey = 'cell' | 'value' | 'latency' | 'direction';
const sortValue = (c: PethCell, k: SortKey) =>
  k === 'cell'
    ? c.cell
    : k === 'value'
      ? c.value
      : k === 'latency'
        ? c.latencyS
        : c.response === 'Excited'
          ? 1
          : 0;

/** Cells ordered by a column; cells with no value in it stay last, whichever way it is sorted. */
export function sortCells(cells: PethCell[], key: SortKey, descending: boolean): PethCell[] {
  const sign = descending ? -1 : 1;
  const present = cells
    .filter((c) => !Number.isNaN(sortValue(c, key)))
    .sort((a, b) => (sortValue(a, key) - sortValue(b, key)) * sign || a.cell - b.cell);
  return [...present, ...cells.filter((c) => Number.isNaN(sortValue(c, key)))];
}

/** Color limit of one behavior's heat map: 99th percentile of |mean|, rounded up to a round number. */
export function heatLimit(b: PethBehavior): number {
  const v = b.cells
    .flatMap((c) => Array.from(c.mean, Math.abs))
    .filter(Number.isFinite)
    .sort((p, q) => p - q);
  return niceLimit(v.length ? v[Math.floor(0.99 * (v.length - 1))] : 0);
}

/** The Analysis page's PETH scale (orange above 0, purple below), so one variable keeps one color. */
export const heatColor = (v: number, limit: number): string =>
  Number.isFinite(v) ? deltaColor(v, limit) : '#e6e6e6';

/** Mean over cells with a value at each time bin (the curve under the heat map). */
export function populationMean(b: PethBehavior): number[] {
  const bins = b.cells[0]?.mean.length ?? 0;
  const cells = b.cells.filter((c) => !Number.isNaN(c.value));
  return Array.from({ length: bins }, (_, i) => {
    const v = cells.map((c) => c.mean[i]).filter(Number.isFinite);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  });
}

/** The population mean curve of one behavior as a plot the Plot editor can restyle. */
export function pethMeanSpec(m: PethModel, behavior: number, r: RunRecord): PlotSpec {
  const b = m.behaviors[behavior];
  const label = `PETH population mean, ${b.label}`;
  return {
    version: PLOT_SPEC_VERSION,
    source: {
      analysis: 'peth',
      runId: r.run_id,
      engine: r.engine,
      label,
      settings: {
        cells: pethCounts(m, behavior).evaluated,
        onsets: b.onsets,
        baseline_subtracted: m.baselineSubtracted,
      },
    },
    data: {
      type: 'line',
      x: m.timeS,
      series: [{ label: `${b.label} (mean over cells)`, y: populationMean(b) }],
      markers: [{ x: 0, label: 'Aligned frame' }],
      spans: [
        ...(m.baselineS ? [{ from: m.baselineS[0], to: m.baselineS[1], label: 'Baseline' }] : []),
        ...(m.responseS ? [{ from: m.responseS[0], to: m.responseS[1], label: 'Response' }] : []),
      ],
    },
    axes: {
      x: 'Time from aligned frame (s)',
      y: m.baselineSubtracted
        ? 'Deconvolved events, baseline-subtracted (a.u.)'
        : 'Deconvolved events (a.u.)',
    },
    display: {},
    style: { ...DEFAULT_STYLE, title: label },
  };
}
