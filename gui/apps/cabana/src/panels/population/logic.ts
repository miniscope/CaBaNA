// Pure helpers of the Population page: preview bin counts, readiness reasons, correction text,
// color scales, ordering, paging and CSV rows. Nothing here computes a result; every reported
// number comes from the framework arrays and is only reshaped, sorted, binned for a histogram
// or colored.

import type { LabelEntry } from '../../lib/labels.ts';
import type { PopulationMethod, PopulationSettings } from '../../lib/population-settings.ts';
import type { PairRow } from '../../lib/population-results.ts';

/** Per-state minimum number of time bins asked by the framework metrics (their `min_frames`). */
export const MIN_BINS = { pca: 20, participation: 50, pairwise: 50 } as const;

// ---------- bins per label (a display-only preview count) ----------

/** Time bins that `frames` neural frames fill at a bin of `binS` seconds (whole bins only). */
export function binsOf(frames: number, fs: number, binS: number): number {
  if (!(fs > 0 && binS > 0)) return 0;
  return Math.floor(frames / (binS * fs) + 1e-9);
}

/** Neural frames of a 0/1 mask in each of `blocks` equal consecutive parts of the session. */
export function framesPerBlock(mask: ArrayLike<number>, blocks: number): number[] {
  const out = new Array<number>(Math.max(1, blocks)).fill(0);
  const n = mask.length;
  for (let i = 0; i < n; i++)
    if (mask[i]) out[Math.min(out.length - 1, Math.floor((i * out.length) / n))]++;
  return out;
}

export interface LabelRow {
  name: string;
  /** Time bins in the whole session. */
  bins: number;
  /** Time bins in each block of the session (as many blocks as the stability setting asks). */
  blockBins: number[];
  /** Notes from the label registry (duplicates, disagreements). */
  problems: string[];
  /** A conflict that blocks the label from every analysis. */
  blocked: boolean;
}

/** One label's row from its registry entries and its frames per block. */
export function labelRow(
  name: string,
  entries: LabelEntry[],
  blockFrames: number[],
  fs: number,
  binS: number,
): LabelRow {
  const mine = entries.filter((e) => e.name === name);
  return {
    name,
    bins: binsOf(
      blockFrames.reduce((s, v) => s + v, 0),
      fs,
      binS,
    ),
    blockBins: blockFrames.map((f) => binsOf(f, fs, binS)),
    problems: [...new Set(mine.flatMap((e) => e.problems))],
    blocked: mine.some((e) => e.blocked),
  };
}

const minOccupancyBins = (s: PopulationSettings) =>
  Math.max(1, Math.ceil(s.pvMinOccupancyS / s.binS - 1e-9));

/** The most bins a label must have for the selected methods, and which method asks for it. */
export function labelMinimum(s: PopulationSettings): { min: number; by: string } {
  const asks: { min: number; by: string }[] = [];
  if (s.methods.similarity)
    asks.push({ min: minOccupancyBins(s), by: 'population vector similarity' });
  if (s.methods.stability)
    asks.push({
      min: minOccupancyBins(s) * Math.max(1, s.stabilityBlocks),
      by: 'population vector stability',
    });
  if (s.methods.separation && s.space === 'pca')
    asks.push({ min: MIN_BINS.pca, by: 'state separation (PCA)' });
  if (s.methods.dimensionality && s.perStateParticipation)
    asks.push({ min: MIN_BINS.participation, by: 'per-state participation ratio' });
  return asks.reduce((a, b) => (b.min > a.min ? b : a), { min: 1, by: 'any analysis' });
}

/** Why a label cannot be used, or undefined when it can. Wording follows the framework's checks. */
export function labelReason(row: LabelRow, s: PopulationSettings): string | undefined {
  if (row.blocked) return row.problems.join(' ') || 'Blocked by a label conflict.';
  const { min } = labelMinimum(s);
  if (row.bins < min) return `insufficient usable bins: ${row.bins} of ${min} needed`;
  return undefined;
}

/** `lo` of `hi` characters kept, ending in an ellipsis; the full name goes in a hover title. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

// ---------- readiness per method ----------

export interface ReadinessContext {
  rows: LabelRow[];
  /** Names of the labels that will run (selected and usable). */
  selected: string[];
  nCells: number;
  /** Time bins of the whole session (all frames). */
  totalBins: number;
  hasArena: boolean;
  hasPosition: boolean;
}
export interface Readiness {
  ready: boolean;
  reason?: string;
}

const no = (reason: string): Readiness => ({ ready: false, reason });
const yes: Readiness = { ready: true };
const countText = (k: number, n: number, what: string) => `${k} of ${n} labels ${what}`;

/** Whether a method can run with the current target and settings, and the reason when it cannot. */
export function methodReadiness(
  method: PopulationMethod,
  s: PopulationSettings,
  ctx: ReadinessContext,
): Readiness {
  const position = s.target === 'position';
  if (position) {
    if (!ctx.hasArena) return no('Position bins need the arena outline (Experimental setup).');
    if (!ctx.hasPosition) return no('Position bins need a position file (Load data).');
  }
  const used = ctx.rows.filter((r) => ctx.selected.includes(r.name));
  if (!position && used.length < 2)
    return no(`Needs at least 2 usable labels (selected ${used.length}).`);
  const enough = (min: number, bins = (r: LabelRow) => r.bins) =>
    used.filter((r) => bins(r) >= min).length;
  switch (method) {
    case 'similarity': {
      const min = minOccupancyBins(s);
      const k = enough(min);
      return position || k >= 2
        ? yes
        : no(
            `Needs at least 2 labels with ${min} or more bins (${countText(k, used.length, 'have enough')}).`,
          );
    }
    case 'stability': {
      if (s.stabilityBlocks < 2) return no('Needs at least 2 blocks.');
      if (position) return yes;
      const min = minOccupancyBins(s);
      const k = used.filter((r) => r.blockBins.every((b) => b >= min)).length;
      return k >= 1
        ? yes
        : no(
            `No label has ${min} or more bins in each of the ${s.stabilityBlocks} blocks; each block needs enough bins of the label.`,
          );
    }
    case 'separation': {
      if (s.space === 'pca' && s.components > ctx.nCells)
        return no(`Asks for ${s.components} components but only ${ctx.nCells} cells are kept.`);
      if (position || s.space !== 'pca') return yes;
      const k = enough(MIN_BINS.pca);
      return k >= 2
        ? yes
        : no(
            `Needs at least 2 labels with ${MIN_BINS.pca} or more bins (${countText(k, used.length, 'have enough')}).`,
          );
    }
    case 'dimensionality': {
      if (s.perStateParticipation && !position) {
        return enough(MIN_BINS.participation) >= 1
          ? yes
          : no(`No label has ${MIN_BINS.participation} or more bins for a per-state value.`);
      }
      return ctx.totalBins >= MIN_BINS.participation
        ? yes
        : no(`Needs ${MIN_BINS.participation} or more time bins (found ${ctx.totalBins}).`);
    }
    case 'pairwise': {
      if (s.pairwiseKind === 'noise' && s.target === 'behaviors')
        return no(
          'Noise correlation needs exclusive states; behaviors can overlap. Use total or signal correlation.',
        );
      return ctx.totalBins >= MIN_BINS.pairwise
        ? yes
        : no(`Needs ${MIN_BINS.pairwise} or more time bins (found ${ctx.totalBins}).`);
    }
  }
}

// ---------- correction scope ----------

const pairsOf = (n: number) => (n * (n - 1)) / 2;

/** Pairs of states tested, or undefined when the number of states is not known (position bins). */
export const pairCount = (nStates: number | undefined) =>
  nStates === undefined ? undefined : pairsOf(nStates);

export interface ScopeLine {
  method: PopulationMethod;
  label: string;
  text: string;
  corrected: boolean;
}

/**
 * The correction each selected method gets, written before the run. Max-stat is offered only for
 * per-state results; matrices stay uncorrected and say how many pairs were tested.
 */
export function correctionScope(s: PopulationSettings, nStates: number | undefined): ScopeLine[] {
  const pairs = pairCount(nStates);
  const pairText = `Uncorrected; ${pairs === undefined ? 'one test per state pair' : `${pairs} state pair${pairs === 1 ? '' : 's'} tested`}`;
  const perState = (on: boolean): { text: string; corrected: boolean } =>
    on && s.correction === 'max_stat'
      ? { text: `Max-stat correction across ${nStates ?? 'the'} states`, corrected: true }
      : {
          text: `Uncorrected; ${nStates === undefined ? 'one test per state' : `${nStates} state${nStates === 1 ? '' : 's'} tested`}`,
          corrected: false,
        };
  const lines: ScopeLine[] = [];
  const add = (method: PopulationMethod, label: string, t: { text: string; corrected: boolean }) =>
    s.methods[method] && lines.push({ method, label, ...t });
  add('similarity', 'Population vector similarity', { text: pairText, corrected: false });
  add('stability', 'Population vector stability', perState(true));
  add('separation', 'State separation', { text: pairText, corrected: false });
  add(
    'dimensionality',
    s.perStateParticipation ? 'Participation ratio (per state)' : 'Participation ratio',
    s.perStateParticipation
      ? perState(true)
      : { text: 'One test for the session; no correction needed', corrected: false },
  );
  add('pairwise', 'Pairwise correlations', {
    text: 'Descriptive; no significance test',
    corrected: false,
  });
  return lines;
}

const correctionName = (c: string) => (c === 'max_stat' ? 'Max-stat' : c.replace(/_/g, ' '));

/** The correction text of one saved result, from what the framework recorded. */
export function resultScope(
  key: PopulationMethod,
  recorded: { correction?: unknown } | undefined,
  o: { nStates: number; perState?: boolean },
): string {
  if (key === 'pairwise') return 'Descriptive; no significance test';
  const corrected = recorded?.correction && recorded.correction !== 'none';
  if (corrected)
    return `${correctionName(String(recorded!.correction))} correction across ${o.nStates} states`;
  if (key === 'similarity' || key === 'separation') {
    const pairs = pairsOf(o.nStates);
    return `Uncorrected; ${pairs} state pair${pairs === 1 ? '' : 's'} tested`;
  }
  if (key === 'dimensionality' && !o.perState)
    return 'One test for the session; no correction needed';
  return `Uncorrected; ${o.nStates} state${o.nStates === 1 ? '' : 's'} tested`;
}

/** What the significance mark in a figure means. */
export function markMeaning(alpha: number | null | undefined, corrected: boolean): string {
  return `* p ${corrected ? 'adjusted ' : ''}< ${alpha ?? '?'}`;
}

// ---------- color scales ----------

export type ScaleKind = 'sequential' | 'diverging';
/** Cosine similarity is 0 to 1 here (non-negative events); Pearson is -1 to 1; distances start at 0. */
export function scaleKind(similarity: string | undefined): ScaleKind {
  return similarity === 'pearson' ? 'diverging' : 'sequential';
}

const SEQ: [number, number, number][] = [
  [248, 250, 252],
  [191, 219, 254],
  [96, 165, 250],
  [37, 99, 235],
  [30, 58, 138],
];
const NEG: [number, number, number] = [37, 99, 235];
const POS: [number, number, number] = [220, 38, 38];
const WHITE: [number, number, number] = [255, 255, 255];

const mix = (a: number[], b: number[], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** RGB of `value` on the scale between `lo` and `hi` (diverging scales are centered on zero). */
export function colorRgb(
  value: number,
  kind: ScaleKind,
  lo: number,
  hi: number,
): [number, number, number] {
  if (!Number.isFinite(value)) return [226, 232, 240];
  if (kind === 'diverging') {
    const reach = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const t = Math.max(-1, Math.min(1, value / reach));
    return t >= 0 ? mix(WHITE, POS, t) : mix(WHITE, NEG, -t);
  }
  const t = hi === lo ? 0 : Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  const x = t * (SEQ.length - 1);
  const i = Math.min(SEQ.length - 2, Math.floor(x));
  return mix(SEQ[i], SEQ[i + 1], x - i);
}
export const colorCss = (value: number, kind: ScaleKind, lo: number, hi: number) =>
  `rgb(${colorRgb(value, kind, lo, hi).join(',')})`;

/** Text color that stays readable on the filled cell. */
export function inkOn(rgb: [number, number, number]): string {
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luma < 140 ? '#fff' : '#0f172a';
}

export interface Limits {
  lo: number;
  hi: number;
}
/** Color limits: the natural range of the measure, or the fixed numbers the user gave. */
export function colorLimits(
  kind: ScaleKind,
  o: { values: ArrayLike<number | null>; fixed?: Limits; natural?: Limits },
): Limits {
  if (o.fixed && o.fixed.hi > o.fixed.lo) return o.fixed;
  if (o.natural) return o.natural;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < o.values.length; i++) {
    const v = o.values[i];
    if (v != null && Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
  if (kind === 'diverging') {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return { lo: -m, hi: m };
  }
  return { lo: Math.min(0, lo), hi: hi > Math.min(0, lo) ? hi : 1 };
}

/** Natural limits of a similarity measure; distances have none. */
export const similarityLimits = (kind: 'cosine' | 'pearson' | string): Limits | undefined =>
  kind === 'pearson' ? { lo: -1, hi: 1 } : kind === 'cosine' ? { lo: 0, hi: 1 } : undefined;

/** `n` evenly spaced tick values between the limits, for the color bar. */
export const colorTicks = (l: Limits, n = 5): number[] =>
  Array.from({ length: n }, (_, i) => l.lo + ((l.hi - l.lo) * i) / (n - 1));

/** A number written with at most `digits` significant places and no trailing zeros. */
export function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e5)) return v.toExponential(1);
  return String(+v.toFixed(digits));
}

// ---------- ordering, paging, histogram ----------

export type StateOrder = 'listed' | 'name' | 'mean';
/** Index order of the states: as listed, by name, or by the mean of each row (highest first). */
export function stateOrder(
  states: string[],
  mode: StateOrder,
  rowMeans?: (number | null)[],
): number[] {
  const idx = states.map((_, i) => i);
  if (mode === 'name') return idx.sort((a, b) => states[a].localeCompare(states[b]));
  if (mode === 'mean' && rowMeans)
    return idx.sort((a, b) => (rowMeans[b] ?? -Infinity) - (rowMeans[a] ?? -Infinity) || a - b);
  return idx;
}

/** Mean of each row of a square matrix, ignoring the diagonal and missing values. */
export function offDiagonalRowMeans(
  values: ArrayLike<number | null>,
  n: number,
): (number | null)[] {
  return Array.from({ length: n }, (_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      const v = values[i * n + j];
      if (j !== i && v != null && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    return count ? sum / count : null;
  });
}

export const PAGE_ROWS = 100;
export function pageOf<T>(rows: T[], page: number, size = PAGE_ROWS): T[] {
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const p = Math.min(Math.max(0, page), last);
  return rows.slice(p * size, (p + 1) * size);
}
export const pageCount = (n: number, size = PAGE_ROWS) => Math.max(1, Math.ceil(n / size));

/** Counts of `values` in `bins` equal-width bins between their minimum and maximum. */
export function histogram(
  values: ArrayLike<number>,
  bins: number,
): { edges: number[]; counts: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
  }
  if (!Number.isFinite(lo)) return { edges: [], counts: [] };
  if (hi === lo) hi = lo + 1;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++)
    counts[Math.min(bins - 1, Math.floor(((values[i] - lo) / (hi - lo)) * bins))]++;
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + ((hi - lo) * i) / bins), counts };
}

/** Round tick values from at or below `lo` to the first one at or above `hi`, so the axis covers the data. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, n - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step + 1e-9) * step; ; v += step) {
    out.push(+v.toPrecision(12));
    if (v >= hi - step * 1e-9) break;
  }
  return out;
}

// ---------- CSV rows ----------

const cell = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : v);

export function pairsCsv(pairs: PairRow[]): { header: string[]; rows: (string | number)[][] } {
  return {
    header: ['state_a', 'state_b', 'value', 'null_low', 'null_high', 'p_value'],
    rows: pairs.map((p) => [p.a, p.b, cell(p.value), cell(p.nullLo), cell(p.nullHi), cell(p.p)]),
  };
}

export function perStateCsv(
  states: string[],
  columns: Record<string, (number | null)[]>,
  name = 'state',
): { header: string[]; rows: (string | number)[][] } {
  const keys = Object.keys(columns);
  return {
    header: [name, ...keys],
    rows: states.map((s, i) => [s, ...keys.map((k) => cell(columns[k][i]))]),
  };
}

export function seriesCsv(
  x: string,
  columns: Record<string, ArrayLike<number | null>>,
): { header: string[]; rows: (string | number)[][] } {
  const keys = Object.keys(columns);
  const n = Math.max(0, ...keys.map((k) => columns[k].length));
  return {
    header: [x, ...keys],
    rows: Array.from({ length: n }, (_, i) => [i + 1, ...keys.map((k) => cell(columns[k][i]))]),
  };
}

export function matrixCsv(
  labels: string[],
  values: ArrayLike<number | null>,
  cols = labels.length,
): { header: string[]; rows: (string | number)[][] } {
  return {
    header: [
      '',
      ...(cols === labels.length ? labels : Array.from({ length: cols }, (_, i) => String(i + 1))),
    ],
    rows: labels.map((l, i) => [
      l,
      ...Array.from({ length: cols }, (_, j) => cell(values[i * cols + j])),
    ]),
  };
}
