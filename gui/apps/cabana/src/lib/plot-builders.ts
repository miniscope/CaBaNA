// Plot specs built from saved results, for the Plot editor. A builder copies the numbers the
// results page already shows; it computes no statistics. The binning of the auROC null
// histogram matches ShiftHistogram in panels/AurocResults.tsx (40 bins over the same domain).

import type { AurocOutcome } from './auroc-run.ts';
import { shiftedValues as aurocDraws } from './auroc-run.ts';
import { aurocOf } from './auroc-view.ts';
import type { PethOutcome } from './peth-run.ts';
import { curveOf } from './peth-view.ts';
import { DEFAULT_STYLE, PLOT_SPEC_VERSION, type PlotSpec, type Source } from './plot-spec.ts';
import { preliminaryText } from './preview.ts';

const NULL_BINS = 40;

/** Percentile with linear interpolation, like numpy's default (as on the results page). */
function percentile(sorted: number[], q: number): number {
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

/** Counts of `draws` in 40 bins over the page's domain, and the central (1 - alpha) interval. */
export function nullHistogram(draws: ArrayLike<number>, observed: number, alpha: number) {
  const f = Array.from(draws)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const lo0 = Math.min(f[0] ?? 0.5, observed, 0.5);
  const hi0 = Math.max(f[f.length - 1] ?? 0.5, observed, 0.5);
  const pad = (hi0 - lo0) * 0.06 || 0.05;
  const [lo, hi] = [lo0 - pad, hi0 + pad];
  const counts = new Array<number>(NULL_BINS).fill(0);
  for (const v of f)
    counts[Math.min(NULL_BINS - 1, Math.floor(((v - lo) / (hi - lo)) * NULL_BINS))]++;
  const edges = counts.map((_, i) => lo + (i * (hi - lo)) / NULL_BINS).concat(hi);
  const band = f.length
    ? { lo: percentile(f, (100 * alpha) / 2), hi: percentile(f, 100 - (100 * alpha) / 2) }
    : undefined;
  return { edges, counts, band, n: f.length };
}

const sourceOf = (
  analysis: Source['analysis'],
  out: { record?: { run_id: string; scope?: string; gui_settings?: unknown }; engine: string },
  label: string,
  settings: Source['settings'],
): Source => ({
  analysis,
  runId: out.record?.run_id,
  engine: out.engine,
  label,
  settings,
  preliminary:
    out.record?.scope === 'preview'
      ? preliminaryText(out.record as Parameters<typeof preliminaryText>[0])
      : undefined,
});

/** The null histogram of one auROC cell and behavior, as the cell inspector draws it. */
export function aurocNullSpec(
  out: AurocOutcome,
  cell: number,
  behavior: number,
): PlotSpec | undefined {
  if (!out.nullKept) return undefined;
  // Saved as shuffle x behavior for the cell, as in the cell inspector.
  const all = aurocDraws(out, cell);
  const n = out.shifts.length;
  const nb = out.labels.length;
  const draws = Array.from({ length: n }, (_, i) => all[i * nb + behavior]);
  const observed = aurocOf(out, cell, behavior);
  const h = nullHistogram(draws, observed, out.settings.alpha);
  const cover = Math.round(100 * (1 - out.settings.alpha));
  const label = `auROC null, cell ${out.cellIds[cell] + 1}, ${out.labels[behavior]}`;
  return {
    version: PLOT_SPEC_VERSION,
    source: sourceOf('auroc', out, label, {
      shuffles: n,
      alpha: out.settings.alpha,
      correction: out.settings.correction,
      null: out.settings.method,
      seed: out.settings.seed,
    }),
    data: {
      type: 'histogram',
      edges: h.edges,
      counts: h.counts,
      markers: [{ x: observed, label: `Observed ${observed.toFixed(3)}` }],
      band: h.band && { ...h.band, label: `Central ${cover}% of the null (unadjusted)` },
    },
    axes: { x: 'auROC of time-shifted data', y: 'Shifts' },
    display: {},
    style: { ...DEFAULT_STYLE, colors: ['#888888', ...DEFAULT_STYLE.colors], title: label },
  };
}

/** The mean curve of one PETH cell and tested column (behavior and alignment), ± SEM across onsets. */
export function pethCurveSpec(out: PethOutcome, cell: number, column: number): PlotSpec {
  const k = curveOf(out, cell, column);
  const x = Array.from(out.curves.timeS);
  const mean = Array.from(k.mean);
  const sem = Array.from(k.sem);
  const label = `PETH mean, cell ${out.cellIds[cell] + 1}, ${out.labels[column]}`;
  const p = out.params;
  return {
    version: PLOT_SPEC_VERSION,
    // PETH runs only in the browser and has no saved record of its own here.
    source: sourceOf('peth', { engine: 'browser-ts' }, label, {
      shuffles: out.shifts.length,
      alpha: out.settings.alpha,
      correction: out.settings.correction,
      baseline_subtracted: !!p.baselineSubtract,
      onsets: out.curves.nEvents[column],
    }),
    data: {
      type: 'line',
      x,
      series: [
        {
          label: `${out.labels[column]} (mean ± SEM)`,
          y: mean,
          lo: mean.map((v, i) => v - sem[i]),
          hi: mean.map((v, i) => v + sem[i]),
        },
      ],
      markers: [{ x: 0, label: 'Aligned frame' }],
      spans: [
        { from: p.baselineS[0], to: p.baselineS[1], label: 'Baseline' },
        { from: p.responseS[0], to: p.responseS[1], label: 'Response' },
      ],
    },
    axes: {
      x: 'Time from aligned frame (s)',
      y: p.baselineSubtract
        ? 'Deconvolved events, baseline-subtracted (a.u.)'
        : 'Deconvolved events (a.u.)',
    },
    display: {},
    style: { ...DEFAULT_STYLE, title: label },
  };
}
