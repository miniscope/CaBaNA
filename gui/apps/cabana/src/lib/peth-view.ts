// What the PETH setup and results screens show, derived from the data and a finished run.

import type { Response } from './auroc.ts';
import { aurocColor } from './auroc-view.ts';
import { bouts, pethGeometry, pethResponse, type Align, type OnsetReport } from './peth.ts';
import { pethOutcome, pethSettings, type PethData, type PethOutcome } from './peth-run.ts';
import { prepChanges } from './prep-deps.ts';

/** Preprocess settings changed since the last run, in words. Empty when there is no run or nothing changed. */
export function pethChanges(): string[] {
  const o = pethOutcome();
  return o ? prepChanges('peth', o.prep, false) : [];
}

/** Settings that differ from the last run and would change its results; empty when there is no run. */
export function pethSettingChanges(): string[] {
  const o = pethOutcome();
  if (!o) return [];
  const s = pethSettings;
  const a = JSON.stringify(o.settings);
  const b = JSON.stringify(s);
  return a === b ? [] : ['analysis settings'];
}

export const nBehaviors = (o: PethOutcome) => o.labels.length;
const at = (o: PethOutcome, c: number, b: number) => c * nBehaviors(o) + b;
/** Mean over onsets of (mean response - mean baseline), a.u. */
export const valueOf = (o: PethOutcome, c: number, b: number) => o.result.observed[at(o, c, b)];
export const pAdjOf = (o: PethOutcome, c: number, b: number) => o.result.pAdj[at(o, c, b)];
export const pRawOf = (o: PethOutcome, c: number, b: number) => o.result.pRaw[at(o, c, b)];
export const wilcoxonOf = (o: PethOutcome, c: number, b: number) => o.curves.pPrePost[at(o, c, b)];
export const latencyOf = (o: PethOutcome, c: number, b: number) =>
  o.band ? o.band.latencyS[at(o, c, b)] : NaN;
/** 1 above the band, -1 below it, 0 when no latency was found (or no band was computed). */
export const latencyDirOf = (o: PethOutcome, c: number, b: number) =>
  o.band ? o.band.latencyDir[at(o, c, b)] : 0;
/** The latency with its direction, "Not detected" when no run was found, or undefined with no band. */
export function latencyText(o: PethOutcome, c: number, b: number): string | undefined {
  if (!o.band) return undefined;
  const s = latencyOf(o, c, b);
  if (!Number.isFinite(s)) return 'Not detected';
  return `${s.toFixed(2)} s (${latencyDirOf(o, c, b) > 0 ? 'above' : 'below'} band)`;
}
/** The x-axis label of every PETH plot: the shown results' alignment, or the setup's before a run. */
export function timeAxisLabel(): string {
  const align = (pethOutcome() ?? { settings: pethSettings }).settings.align;
  return `Time from ${align === 'onset' ? 'behavior onset' : align === 'offset' ? 'bout offset' : 'bout onset or offset'} (s)`;
}

/** What the p-value used for labels is called: with no correction it is not "adjusted". */
export const pUsedName = (o: PethOutcome) => (o.settings.correction === 'max_stat' ? 'Adjusted p' : 'Uncorrected p');
/** The correction, its scope and α, for headers and run details. */
export const correctionText = (o: PethOutcome) =>
  o.settings.correction === 'max_stat'
    ? o.settings.align === 'both'
      ? `Max-stat within each cell, separately for onset and offset (${o.labels.length / 2} behaviors each), not across cells · α = ${o.settings.alpha}`
      : `Max-stat across the ${o.labels.length} selected behaviors within each cell, not across cells · α = ${o.settings.alpha}`
    : `No correction (uncorrected p-values) · α = ${o.settings.alpha}`;
export const hasTest = (o: PethOutcome) => o.settings.test !== 'none';

/** The label of one cell-behavior pair, or undefined when the run had no shuffle test. */
export function labelAt(o: PethOutcome, c: number, b: number): Response | undefined {
  return hasTest(o) ? pethResponse(valueOf(o, c, b), pAdjOf(o, c, b), o.settings.alpha) : undefined;
}

/** Why a behavior has no results for any cell, or undefined when it was tested. */
export function behaviorReason(o: PethOutcome, b: number): string | undefined {
  const n = o.reports[b].onsets.length;
  const min = o.params.minEvents;
  return n < min ? `${n} bout${n === 1 ? '' : 's'}, minimum ${min}` : undefined;
}

/** Why one pair has no value, or undefined when it has one. */
export function whyNotEvaluated(o: PethOutcome, c: number, b: number): string | undefined {
  return behaviorReason(o, b) ?? (o.cellsMissing.includes(c) ? 'non-finite neural value in this cell' : undefined);
}

/** The mean curve, its SEM across onsets and the null band of one cell and behavior. */
export function curveOf(o: PethOutcome, c: number, b: number) {
  const n = o.curves.bins;
  const from = at(o, c, b) * n;
  const part = (a?: Float64Array) => a?.subarray(from, from + n);
  return {
    mean: part(o.curves.peth)!,
    sem: part(o.curves.sem)!,
    lo: part(o.band?.lo),
    hi: part(o.band?.hi),
  };
}

/** Time of the largest value of `pick(mean)` among bins where `keep(time)`; NaN without a curve. */
function argmaxTime(o: PethOutcome, c: number, b: number, pick: (v: number) => number, keep: (t: number) => boolean) {
  const { mean } = curveOf(o, c, b);
  let best = -Infinity;
  let t = NaN;
  mean.forEach((v, i) => {
    if (keep(o.curves.timeS[i]) && Number.isFinite(v) && pick(v) > best) {
      best = pick(v);
      t = o.curves.timeS[i];
    }
  });
  return t;
}

/** `plot_peth_data` sort "peak": time of the highest point of the mean curve over the whole window. */
export const peakTimeS = (o: PethOutcome, c: number, b: number) => argmaxTime(o, c, b, (v) => v, () => true);

/**
 * `plot_peth_data` sort "latency": the null-band latency when the band was computed; otherwise the
 * time of the largest absolute value inside the response interval.
 */
export function sortLatencyS(o: PethOutcome, c: number, b: number): number {
  if (o.band) return latencyOf(o, c, b);
  const [lo, hi] = o.params.responseS;
  return argmaxTime(o, c, b, Math.abs, (t) => t >= lo && t < hi);
}

export type CellSort = 'response' | 'latency' | 'peak';
export const SORT_LABEL: Record<CellSort, string> = {
  response: 'response',
  latency: 'latency',
  peak: 'peak time',
};

/** The cell list filter: all cells, or only those labelled Higher (excited) or Lower (inhibited) for the behavior. */
export type CellFilter = 'all' | 'excited' | 'inhibited';
export const filterCells = (o: PethOutcome, b: number, cells: number[], filter: CellFilter) =>
  filter === 'all' ? cells : cells.filter((c) => labelAt(o, c, b) === filter);

/**
 * Cells for one behavior in heatmap order. Response: largest response minus baseline first.
 * Latency and peak time: earliest first. Cells without a value come last, in cell order.
 */
export function sortCells(o: PethOutcome, b: number, sort: CellSort): number[] {
  const key = (c: number) =>
    sort === 'response' ? -valueOf(o, c, b) : sort === 'latency' ? sortLatencyS(o, c, b) : peakTimeS(o, c, b);
  const cells = o.cellIds.map((_, c) => c);
  const k = cells.map(key);
  return cells.sort((x, y) => {
    const [a, d] = [k[x], k[y]];
    if (Number.isNaN(a) || Number.isNaN(d)) return Number.isNaN(a) ? (Number.isNaN(d) ? x - y : 1) : -1;
    return a - d || x - y;
  });
}

/** Rounds up to the next of 1, 1.5, 2, 3, 4, 5, 6, 8 or 10 times a power of ten. */
export function niceLimit(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return ([1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((v) => m <= v + 1e-9) ?? 10) * p;
}

/** Color limit of the heatmap of one behavior: the 99th percentile of |mean curve| over evaluated cells, rounded up. */
export function clipLimit(o: PethOutcome, b: number): number {
  const v: number[] = [];
  for (let c = 0; c < o.cellIds.length; c++)
    for (const x of curveOf(o, c, b).mean) if (Number.isFinite(x)) v.push(Math.abs(x));
  v.sort((p, q) => p - q);
  return niceLimit(v.length ? v[Math.floor(0.99 * (v.length - 1))] : 0);
}

/** Orange above 0, purple below, as the auROC scale; values beyond ±lim share the end colors. */
export const deltaColor = (v: number, lim: number) => aurocColor(0.5 + v, 0.5 - lim, 0.5 + lim);

/** Mean and SEM (ddof 1, NaN for one cell) over cells at each bin, skipping cells with a non-finite value there. */
export function meanOverCells(o: PethOutcome, b: number, cells: number[]) {
  const n = o.curves.bins;
  const mean = new Float64Array(n).fill(NaN);
  const sem = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const v = cells.map((c) => curveOf(o, c, b).mean[i]).filter(Number.isFinite);
    if (!v.length) continue;
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    mean[i] = m;
    if (v.length > 1)
      sem[i] = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1) / v.length);
  }
  return { mean, sem };
}

export interface Summary {
  cells: number;
  /** Cells with at least one tested behavior. */
  evaluated: number;
  missingCells: number;
  evaluatedPairs: number;
  significantPairs: number;
  higher: number;
  lower: number;
  /** Cells significant for at least one behavior. */
  respondingCells: number;
  perBehavior: {
    label: string;
    onsets: number;
    reason?: string;
    counts: Record<Response, number>;
    /** Latency (s) of the significant cells with one. */
    latencies: { higher: number[]; lower: number[] };
  }[];
}

/** `align` restricts the totals (not `perBehavior`) to the columns of one alignment, for runs with both. */
export function summarize(o: PethOutcome, align?: Align): Summary {
  const cells = o.cellIds.length;
  const labelled = hasTest(o);
  const perBehavior = o.labels.map((label, b) => ({
    label,
    onsets: o.reports[b].onsets.length,
    reason: behaviorReason(o, b),
    counts: { excited: 0, inhibited: 0, 'not significant': 0, 'not evaluated': 0 } as Record<Response, number>,
    latencies: { higher: [] as number[], lower: [] as number[] },
  }));
  let evaluated = 0;
  let pairs = 0;
  let higher = 0;
  let lower = 0;
  let responding = 0;
  for (let c = 0; c < cells; c++) {
    let tested = 0;
    let significant = 0;
    for (let b = 0; b < o.labels.length; b++) {
      if (align && o.columns[b].align !== align) continue;
      if (!Number.isFinite(valueOf(o, c, b))) {
        perBehavior[b].counts['not evaluated']++;
        continue;
      }
      tested++;
      const r = labelAt(o, c, b);
      if (!r) continue;
      perBehavior[b].counts[r]++;
      if (r === 'excited' || r === 'inhibited') {
        significant++;
        if (r === 'excited') higher++;
        else lower++;
        const l = latencyOf(o, c, b);
        if (Number.isFinite(l)) perBehavior[b].latencies[r === 'excited' ? 'higher' : 'lower'].push(l);
      }
    }
    if (!tested) continue;
    evaluated++;
    pairs += tested;
    if (labelled && significant) responding++;
  }
  return {
    cells,
    evaluated,
    missingCells: o.cellsMissing.length,
    evaluatedPairs: pairs,
    significantPairs: higher + lower,
    higher,
    lower,
    respondingCells: responding,
    perBehavior,
  };
}

/** Bouts of one behavior in seconds, with whether each onset was kept (all are, without a report); for the session timeline. */
export function boutTimeline(d: PethData, b: number, report?: OnsetReport, align: Align = 'onset') {
  const { onsets, lengths } = bouts(d.behaviors.subarray(b * d.frames, (b + 1) * d.frames));
  const kept = report && new Set(report.onsets);
  return Array.from(onsets, (o, i) => {
    const aligned = align === 'onset' ? o : o + lengths[i];
    return {
      startS: o / d.fs,
      lengthS: lengths[i] / d.fs,
      /** Where the circle goes: the aligned end of the bout. */
      markS: aligned / d.fs,
      included: !kept || kept.has(aligned),
    };
  });
}

/** Frames per curve bin, from the first bin's centre (the mean of its frame offsets). */
export function binFrames(o: PethOutcome): number {
  return Math.max(1, Math.round(2 * (o.curves.timeS[0] * o.input.fs + pethGeometry(o.params, o.input.fs).pre) + 1));
}

/** Time axis of the curves in seconds from the onset: frame k is centred on k / fs, so a bin spans its frames' edges. */
export function timeDomain(o: PethOutcome): [number, number] {
  const { fs } = o.input;
  const lo = (-pethGeometry(o.params, fs).pre - 0.5) / fs;
  return [lo, lo + (o.curves.bins * binFrames(o)) / fs];
}

/**
 * The raw windows of one cell around each included onset of a behavior, in time order, as stored in
 * the neural data: onsets x frames, not baseline-subtracted and not binned. Frames beyond the last
 * full bin are left off, so columns line up with the curves.
 */
export function rawWindows(o: PethOutcome, c: number, b: number) {
  const { frames, neural } = o.input;
  const { pre } = pethGeometry(o.params, o.input.fs);
  const len = o.curves.bins * binFrames(o);
  const onsets = o.onsets[b];
  const data = new Float32Array(onsets.length * len);
  onsets.forEach((t, e) => data.set(neural.subarray(c * frames + t - pre, c * frames + t - pre + len), e * len));
  return { data, rows: onsets.length, cols: len };
}
