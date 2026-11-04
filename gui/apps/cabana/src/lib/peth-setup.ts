// Counts, setting tags, signal labels and result cards of the PETH setup and results pages.
// Pure functions: the panels only show what these return.

import type { MetricCard } from '../components/MetricCards.tsx';
import { denomText, percentText } from './metrics.ts';
import { pethCurves, type Align, type OnsetReport, type PethCurves, type PethParams } from './peth.ts';
import {
  alignsOf,
  pethPlan,
  type AlignedReports,
  type PethData,
  type PethOutcome,
  type PethSettings,
} from './peth-run.ts';
import { hasTest, labelAt, latencyDirOf, latencyOf, summarize } from './peth-view.ts';

/** Bouts of the given behaviors and how many each rule left out. */
export interface EventCounts {
  bouts: number;
  included: number;
  excluded: number;
  short: number;
  gap: number;
  outside: number;
  edge: number;
}

/** Sums the reports of `behaviors` (indexes into `reports`); each excluded bout is counted once, under its first reason. */
export function eventCounts(reports: OnsetReport[], behaviors: number[]): EventCounts {
  const c: EventCounts = {
    bouts: 0,
    included: 0,
    excluded: 0,
    short: 0,
    gap: 0,
    outside: 0,
    edge: 0,
  };
  for (const b of behaviors) {
    const r = reports[b];
    c.bouts += r.bouts;
    c.included += r.onsets.length;
    c.short += r.short;
    c.gap += r.gap;
    c.outside += r.outside;
    c.edge += r.edge;
  }
  c.excluded = c.bouts - c.included;
  return c;
}

/** "26 included · 13 excluded": always both numbers, never a ratio. */
export const countsText = (c: Pick<EventCounts, 'included' | 'excluded'>) =>
  `${c.included.toLocaleString()} included · ${c.excluded.toLocaleString()} excluded`;

type Reason = 'short' | 'gap' | 'outside' | 'edge';

/** Why a bout was excluded, in words; the gap side follows the alignment. */
export function reasonText(
  why: Reason,
  p: Pick<PethParams, 'minDurationS' | 'minGapS'>,
  align: Align,
): string {
  const gapWhere = align === 'offset' ? 'before the next bout' : 'after the end of the previous bout';
  return {
    short: `too short (under ${p.minDurationS} s)`,
    gap: `too close: under ${p.minGapS} s ${gapWhere}`,
    outside: 'aligned frame excluded',
    edge: 'window runs past the recording edge',
  }[why];
}

/** The exclusion reasons that occurred with their counts, in the order the code checks them. Empty when nothing was excluded. */
export function reasonLines(
  c: EventCounts,
  p: Pick<PethParams, 'minDurationS' | 'minGapS'>,
  align: Align,
): string[] {
  return (['short', 'gap', 'outside', 'edge'] as const).flatMap((why) =>
    c[why] ? [`${c[why]} ${reasonText(why, p, align)}`] : [],
  );
}

export type SettingTag = 'test' | 'display';

/**
 * Which settings change the significance test and which only change what is drawn or reported
 * alongside it. From the comments in `peth-run.ts` and `peth-view.ts` (PETH_DISPLAY).
 */
export const SETTING_TAGS = {
  behaviors: 'test', // max-stat correction runs across the selected behaviors
  alignment: 'test',
  baseline: 'test',
  response: 'test',
  minDuration: 'test',
  minGap: 'test',
  minEvents: 'test',
  testMethod: 'test',
  shuffles: 'test',
  minShift: 'test',
  seed: 'test',
  alpha: 'test',
  correction: 'test',
  window: 'display',
  binSize: 'display',
  baselineSubtract: 'display',
  nullBand: 'display',
  latency: 'display',
  wilcoxon: 'display',
} as const satisfies Record<string, SettingTag>;
export type SettingId = keyof typeof SETTING_TAGS;

export const tagText = (id: SettingId) =>
  SETTING_TAGS[id] === 'test' ? 'changes the test' : 'display only';

/**
 * The full window sets what is drawn, but a bout whose window would run past the recording edge is
 * left out, and that bout is then also left out of the test.
 */
export const WINDOW_CAVEAT =
  'Bouts whose window runs past the recording edge are excluded, so a longer window can remove bouts from the test too.';

/** The neural signal as the curves and heatmaps show it. */
export function signalLabel(baselineSubtract: boolean): string {
  return baselineSubtract
    ? 'Deconvolved events (baseline-subtracted, a.u.)'
    : 'Deconvolved events (a.u.)';
}

/** The input signal in words, with the smoothing it was given in Preprocess. */
export const inputSignalText = (eventSigmaS: number) =>
  eventSigmaS
    ? `Deconvolved events, Gaussian-smoothed (σ = ${eventSigmaS} s), a.u.`
    : 'Deconvolved events, not smoothed, a.u.';

/** Indexes of the run's columns aligned to `align`; every column when `align` is not given. */
export const columnsOf = (o: PethOutcome, align?: Align): number[] =>
  o.columns.flatMap((c, b) => (!align || c.align === align ? [b] : []));

/** The alignments a finished run has, in display order. */
export const alignsRun = (o: PethOutcome): Align[] => alignsOf(o.settings.align);

/**
 * Cards for one alignment of a run. Onset and offset are never added together: with both, ask for
 * each separately. The unit follows the number of behaviors in that alignment.
 */
export function pethCards(o: PethOutcome, align?: Align): MetricCard[] {
  const s = summarize(o, align);
  const cols = columnsOf(o, align);
  const single = cols.length === 1;
  const unit = single ? 'cells' : 'cell–behavior pairs';
  const base = `evaluated${align ? ` (aligned to bout ${align})` : ''}`;
  if (!hasTest(o))
    return [
      {
        label: 'Cells evaluated',
        value: String(s.evaluated),
        denom: `of ${s.cells} cells; no shuffle test, so no labels`,
        tone: 'blue',
      },
    ];
  const share = (n: number) =>
    `${denomText(n, s.evaluatedPairs, unit, base)} · ${percentText(n, s.evaluatedPairs)}`;
  const lat = cols.flatMap((b) => [
    ...s.perBehavior[b].latencies.higher,
    ...s.perBehavior[b].latencies.lower,
  ]);
  const what = single ? 'cell' : 'pair';
  const latDenom = !o.band
    ? 'null band off in this run'
    : lat.length
      ? `mean over ${lat.length} significant ${lat.length === 1 ? what : `${what}s`} with a latency · descriptive`
      : 'no significant cell has a latency · descriptive';
  return [
    {
      label: 'Responsive cells',
      value: String(s.respondingCells),
      denom: `${denomText(s.respondingCells, s.evaluated, 'cells', base)}${single ? '' : ', significant for at least one behavior'} · ${percentText(s.respondingCells, s.evaluated)}`,
      tone: 'blue',
      help: 'Cells with a significant response, higher or lower, for at least one selected behavior.',
    },
    {
      label: 'Higher',
      value: String(s.higher),
      denom: share(s.higher),
      tone: 'orange',
      help: 'Response minus baseline above 0, with p below α.',
    },
    {
      label: 'Lower',
      value: String(s.lower),
      denom: share(s.lower),
      tone: 'purple',
      help: 'Response minus baseline below 0, with p below α.',
    },
    {
      label: 'Latency (descriptive)',
      value: lat.length ? `${(lat.reduce((a, v) => a + v, 0) / lat.length).toFixed(2)} s` : '–',
      denom: latDenom,
      tone: 'gray',
      help: `Center of the first bin, at or after the aligned point, that starts ${o.settings.latencyBins} consecutive bins outside the null band on the same side. Not a test and not corrected.`,
    },
  ];
}

/** Significant cells of column `b` with the latency of each, for the tick plot under the heatmap. */
export function latencyTicks(o: PethOutcome, b: number) {
  const ticks: { cell: number; latencyS: number; dir: 1 | -1 }[] = [];
  let significant = 0;
  for (let c = 0; c < o.cellIds.length; c++) {
    const r = labelAt(o, c, b);
    if (r !== 'excited' && r !== 'inhibited') continue;
    significant++;
    const t = latencyOf(o, c, b);
    if (Number.isFinite(t))
      ticks.push({ cell: c, latencyS: t, dir: latencyDirOf(o, c, b) > 0 ? 1 : -1 });
  }
  return { ticks, significant };
}

/** Mean and SEM (ddof 1, NaN for one cell) over cells of column `col` of curves from `pethCurves`, skipping non-finite values. */
export function columnMean(curves: PethCurves, cells: number, columns: number, col: number) {
  const { bins } = curves;
  const mean = new Float64Array(bins).fill(NaN);
  const sem = new Float64Array(bins).fill(NaN);
  for (let i = 0; i < bins; i++) {
    const v: number[] = [];
    for (let c = 0; c < cells; c++) {
      const x = curves.peth[(c * columns + col) * bins + i];
      if (Number.isFinite(x)) v.push(x);
    }
    if (!v.length) continue;
    const m = v.reduce((a, x) => a + x, 0) / v.length;
    mean[i] = m;
    if (v.length > 1) sem[i] = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1) / v.length);
  }
  return { mean, sem };
}

/**
 * The Review preview: mean curve over cells for each tested behavior, from the loaded data and the
 * current settings. No shuffle test, band or labels. A column below the minimum bouts has no curve.
 */
export function previewCurves(
  d: PethData,
  cfg: Pick<PethSettings, 'params' | 'unselected' | 'align'>,
  reports: AlignedReports,
) {
  const plan = pethPlan(d, cfg, reports);
  const curves = pethCurves(plan.input, plan.onsets, cfg.params);
  const columns = plan.columns.map((col, j) => ({
    ...col,
    label: d.labels[col.b],
    bouts: plan.onsets[j].length,
    ...columnMean(curves, d.cells, plan.columns.length, j),
  }));
  return { axis: { curves, input: plan.input, params: cfg.params }, columns };
}
