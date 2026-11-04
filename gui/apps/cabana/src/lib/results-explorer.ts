// Logic of the Results Explorer: which plots an analysis has, saved CSV tables (read, sorted,
// copied), the statistics read from saved numbers, and the factual summary. Everything is read
// from a saved run; nothing here computes a new statistic, only counts and ranges of saved values.

import type { RunRecord } from './bridge-client.ts';
import { RESPONSE_CSV, RESPONSE_LABEL } from './auroc-view.ts';
import { OVERALL, type Overall } from './place-outcome.ts';
import { POPULATION_RESULT } from './population-results.ts';
import { preliminaryText } from './preview.ts';
import { analysisLabel, formatWhen } from './results-overview.ts';
import type { AnalysisId } from './runs.ts';

// ---------------------------------------------------------------- plots

/** One plot of an analysis's results page. `view` is the name the page uses for it. */
export interface PlotEntry {
  id: string;
  title: string;
  view: string;
  text: string;
}

const PLOTS: Record<Exclude<AnalysisId, 'population'>, PlotEntry[]> = {
  place: [
    {
      id: 'maps',
      title: 'Rate maps',
      view: 'gallery',
      text: 'One rate map per cell, with the outcome of the information and stability tests.',
    },
    {
      id: 'population',
      title: 'Population plots',
      view: 'population',
      text: 'Shuffle histograms, metric strips, population tuning and the smoothing choice.',
    },
    {
      id: 'inspector',
      title: 'Cell inspector',
      view: 'inspector',
      text: 'Maps, null histograms, footprint and trace of one cell.',
    },
  ],
  auroc: [
    {
      id: 'inspector',
      title: 'Cell inspector',
      view: 'inspector',
      text: 'Null histogram, behaviors, event trace and footprint of one cell.',
    },
    {
      id: 'heatmap',
      title: 'Population heatmap',
      view: 'heatmap',
      text: 'auROC of every cell for every behavior.',
    },
    {
      id: 'summary',
      title: 'Population summary',
      view: 'summary',
      text: 'Ranked strip, auROC histogram and response patterns.',
    },
  ],
  peth: [
    {
      id: 'population',
      title: 'Population PETH',
      view: 'population',
      text: 'Heatmap and raster of all cells, mean curves, null histogram and latencies.',
    },
    {
      id: 'inspector',
      title: 'Cell inspector',
      view: 'inspector',
      text: 'Mean curve, single-bout windows and latency of one cell.',
    },
    {
      id: 'summary',
      title: 'Summary',
      view: 'summary',
      text: 'Response counts per behavior and the bouts table.',
    },
  ],
  decoding: [
    {
      id: 'map',
      title: 'Error map',
      view: 'map',
      text: 'Median decoding error per position bin (position decoding).',
    },
    {
      id: 'trajectory',
      title: 'Decoded vs true position',
      view: 'trajectory',
      text: 'Decoded and true position over time (position decoding).',
    },
    {
      id: 'errors',
      title: 'Error distribution',
      view: 'errors',
      text: 'Decoding error per frame (position decoding).',
    },
    {
      id: 'scores',
      title: 'Scores',
      view: 'scores',
      text: 'Score per behavior against its shuffled null (behavior decoding).',
    },
    {
      id: 'confusion',
      title: 'Confusion matrix or one-vs-rest tables',
      view: 'confusion',
      text: 'What each behavior was decoded as (behavior decoding).',
    },
    {
      id: 'timeline',
      title: 'Decoded vs true behavior',
      view: 'timeline',
      text: 'Decoded and true behavior over time (Bayes decoder only).',
    },
  ],
};

const POPULATION_PLOTS: Record<keyof typeof POPULATION_RESULT, string> = {
  similarity: 'Population vector similarity',
  stability: 'Population vector stability',
  separation: 'State separation',
  dimensionality: 'Dimensionality',
  pairwise: 'Pairwise correlations',
};

/**
 * The plots a saved run can show. Population runs list the methods that finished. Decoding lists
 * the views of its target (position or behaviors) when the settings say which.
 */
export function plotsOf(analysis: AnalysisId, resultNames: string[] = [], target?: string) {
  if (analysis === 'population')
    return (Object.keys(POPULATION_RESULT) as (keyof typeof POPULATION_RESULT)[])
      .filter((m) => resultNames.includes(POPULATION_RESULT[m]))
      .map((m) => ({
        id: m,
        title: POPULATION_PLOTS[m],
        view: m,
        text: 'Opens this method on the Population activity page.',
      }));
  const all = PLOTS[analysis];
  if (analysis !== 'decoding' || !target) return all;
  const position = ['map', 'trajectory', 'errors'];
  return all.filter((p) => (target === 'position') === position.includes(p.id));
}

// ---------------------------------------------------------------- tables

export interface SavedTable {
  name: string;
  /** `#` lines above the header: what the values mean and what the p-values depend on. */
  notes: string[];
  columns: string[];
  rows: string[][];
}

/** One CSV line, honoring double quotes (behavior names are written quoted). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') ((cur += '"'), i++);
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A saved CSV: `#` lines are notes, the first other line is the header. Blank cells stay blank. */
export function parseSavedCsv(name: string, text: string): SavedTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const notes = lines.filter((l) => l.startsWith('#')).map((l) => l.replace(/^#\s*/, ''));
  const body = lines.filter((l) => !l.startsWith('#'));
  return {
    name,
    notes,
    columns: body.length ? splitLine(body[0]) : [],
    rows: body.slice(1).map(splitLine),
  };
}

const asNumber = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Rows ordered by a column: numbers by value, text alphabetically, blank cells always last. */
export function sortRows(rows: string[][], col: number, descending: boolean): string[][] {
  const numeric = rows.every((r) => r[col] === '' || !Number.isNaN(asNumber(r[col])));
  const blank = (r: string[]) => r[col] === '' || r[col] === undefined;
  const cmp = (a: string[], b: string[]) =>
    numeric ? asNumber(a[col]) - asNumber(b[col]) : a[col].localeCompare(b[col]);
  const present = rows
    .filter((r) => !blank(r))
    .sort((a, b) => (descending ? -cmp(a, b) : cmp(a, b)));
  return [...present, ...rows.filter(blank)];
}

/** Tab-separated text (header first) for pasting into a spreadsheet. */
export const tableText = (t: Pick<SavedTable, 'columns' | 'rows'>, rows = t.rows) =>
  [t.columns, ...rows].map((r) => r.join('\t')).join('\n');

// ---------------------------------------------------------------- statistics

/** How a saved CSV holds one statistic: its value column and the p-value columns beside it. */
interface StatColumns {
  name: string;
  unit: string;
  value: string;
  p?: string;
  pAdj?: string;
}
interface TableSpec {
  file: string;
  /** What one row is. */
  basis: string;
  stats: StatColumns[];
  /** A text column whose values are counted (the outcome or response of each row). */
  category?: { column: string; title: string; label: (v: string) => string };
}

const RESPONSE_FROM_CSV = Object.fromEntries(
  (Object.keys(RESPONSE_CSV) as (keyof typeof RESPONSE_CSV)[]).map((k) => [
    RESPONSE_CSV[k],
    RESPONSE_LABEL[k],
  ]),
);
const responseCategory = {
  column: 'response',
  title: 'Response',
  label: (v: string) => RESPONSE_FROM_CSV[v] ?? v,
};

/** Browser-engine runs: which saved file and columns hold each statistic. */
export const TABLE_SPECS: Partial<Record<AnalysisId, TableSpec>> = {
  place: {
    file: 'place_cells.csv',
    basis: 'cells',
    stats: [
      { name: 'Spatial information', unit: 'bits/event', value: 'information', p: 'p_information' },
      {
        name: 'Spatial stability',
        unit: 'split-half correlation r',
        value: 'stability',
        p: 'p_stability',
      },
      { name: 'Field in/out ratio', unit: 'ratio', value: 'in_out_ratio', p: 'p_in_out_ratio' },
    ],
    category: {
      column: 'outcome',
      title: 'Outcome',
      label: (v) => OVERALL[v as Overall]?.label ?? v,
    },
  },
  auroc: {
    file: 'auroc.csv',
    basis: 'cell-behavior pairs',
    stats: [
      {
        name: 'auROC',
        unit: '0 to 1 scale',
        value: 'auroc',
        p: 'p_unadjusted',
        pAdj: 'p_adjusted',
      },
    ],
    category: responseCategory,
  },
  peth: {
    file: 'peth.csv',
    basis: 'cell-behavior pairs',
    stats: [
      {
        name: 'Response minus baseline',
        unit: 'a.u.',
        value: 'value_au',
        p: 'p_unadjusted',
        pAdj: 'p_adjusted',
      },
    ],
    category: responseCategory,
  },
};

export interface Count {
  /** Values that are numbers. */
  n: number;
  /** Of those, how many are below alpha. */
  below: number;
}
export interface StatRow {
  name: string;
  /** Unit of the observed statistic; empty when the saved run does not say. */
  unit: string;
  /** Observed values: how many, and their smallest and largest. */
  n: number;
  range?: [number, number];
  pRaw?: Count;
  pAdj?: Count;
  /** What one value belongs to: a cell, a behavior pair, a population. */
  basis?: string;
}

const finiteColumn = (t: SavedTable, name: string): number[] | undefined => {
  const i = t.columns.indexOf(name);
  if (i < 0) return undefined;
  return t.rows.map((r) => asNumber(r[i] ?? '')).filter(Number.isFinite);
};

const countBelow = (values: number[] | undefined, alpha: number | undefined): Count | undefined =>
  values && {
    n: values.length,
    below: alpha === undefined ? 0 : values.filter((p) => p < alpha).length,
  };

/** One row per statistic of a saved table. */
export function tableStatRows(table: SavedTable, spec: TableSpec, alpha?: number): StatRow[] {
  return spec.stats.flatMap((s) => {
    const values = finiteColumn(table, s.value);
    if (!values) return [];
    return [
      {
        name: s.name,
        unit: s.unit,
        n: values.length,
        range: values.length ? [Math.min(...values), Math.max(...values)] : undefined,
        pRaw: s.p ? countBelow(finiteColumn(table, s.p), alpha) : undefined,
        pAdj: s.pAdj ? countBelow(finiteColumn(table, s.pAdj), alpha) : undefined,
        basis: spec.basis,
      } satisfies StatRow,
    ];
  });
}

/** How many rows hold each value of a text column, in first-seen order. */
export function categoryCounts(table: SavedTable, spec: TableSpec): [string, number][] {
  const i = table.columns.indexOf(spec.category?.column ?? '');
  if (i < 0 || !spec.category) return [];
  const counts = new Map<string, number>();
  for (const r of table.rows) counts.set(r[i], (counts.get(r[i]) ?? 0) + 1);
  return [...counts].map(([v, n]) => [spec.category!.label(v), n]);
}

/** The shuffle test as saved. A field the run did not record stays undefined. */
export interface TestSettings {
  nullMethod?: string;
  shuffles?: number;
  alpha?: number;
  correction?: string;
  tail?: string;
  seed?: number | null;
}

const text = (v: unknown) => (typeof v === 'string' && v ? v.replace(/_/g, ' ') : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** The test settings of a browser-engine run, from its saved settings and metadata file. */
export function browserTestSettings(
  analysis: AnalysisId,
  settings: unknown,
  metadata: unknown,
): TestSettings {
  const s = obj(settings);
  const m = obj(metadata);
  const method =
    text(obj(m.comparison).method) ??
    text(obj(m.shuffle_test).method) ??
    (analysis === 'place' && m.minimum_circular_shift ? 'circular shift' : undefined);
  return {
    nullMethod: method,
    shuffles: num(s.nShuffles) ?? num(m.shuffles),
    alpha: num(s.alpha),
    correction: analysis === 'place' ? 'no adjusted p saved' : text(s.correction),
    tail: analysis === 'place' ? undefined : text(obj(m.statistics).tail),
    seed: num(s.seed) ?? null,
  };
}

// ---------------------------------------------------------------- summary

const fmt = (x: number) => String(+x.toPrecision(3));

/** What the factual summary is built from. */
export interface SummaryInput {
  record: RunRecord;
  settings: TestSettings;
  stats: StatRow[];
  /** Counts of a text column (outcome or response), with the column's title. */
  categories?: { title: string; counts: [string, number][] };
}

const ENGINE_TEXT = { framework: 'Python framework', 'browser-ts': 'browser engine' } as const;

/** Sentences stating the saved numbers. No interpretation, no comparison with other runs. */
export function summarySentences(i: SummaryInput): string[] {
  const r = i.record;
  const scope = r.scope === 'preview' ? preliminaryText(r) : 'full analysis';
  const out = [
    `${analysisLabel(r.analysis)}: ${scope}, run ${r.run_id}, saved ${formatWhen(r.created_utc)}, ${ENGINE_TEXT[r.engine]}.`,
  ];
  const { alpha } = i.settings;
  for (const s of i.stats) {
    const what = s.basis ? `${s.n} ${s.basis}` : `${s.n} values`;
    const range = s.range
      ? `, from ${fmt(s.range[0])} to ${fmt(s.range[1])}${s.unit ? ` (${s.unit})` : ''}`
      : '';
    out.push(`${s.name}: ${what}${range}.`);
    const lim = alpha === undefined ? 'alpha' : `alpha ${alpha}`;
    if (s.pRaw)
      out.push(`${s.name}: ${s.pRaw.below} of ${s.pRaw.n} unadjusted p-values are below ${lim}.`);
    if (s.pAdj)
      out.push(`${s.name}: ${s.pAdj.below} of ${s.pAdj.n} adjusted p-values are below ${lim}.`);
  }
  if (i.categories?.counts.length)
    out.push(
      `${i.categories.title}: ${i.categories.counts.map(([k, n]) => `${k} ${n}`).join(', ')}.`,
    );
  const t = i.settings;
  const test = [
    t.nullMethod && `${t.nullMethod} null`,
    t.shuffles !== undefined && `${t.shuffles} shuffles`,
    t.alpha !== undefined && `alpha ${t.alpha}`,
    t.correction && `correction: ${t.correction}`,
    t.tail && `${t.tail} tail`,
    t.seed != null && `seed ${t.seed}`,
  ].filter(Boolean);
  if (test.length) out.push(`Shuffle test: ${test.join(', ')}.`);
  return out;
}
