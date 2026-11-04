// Counts and scales for the auROC results cards, population heatmap and summary. All numbers come
// from the run's observed values and p-values; nothing is recomputed.

import { aurocColor, aurocOf, nBehaviors, responseAt, summarize } from './auroc-view.ts';
import type { AurocOutcome } from './auroc-run.ts';
import type { MetricCard } from '../components/MetricCards.tsx';
import { denomText, percentText } from './metrics.ts';

export interface AurocCardCounts {
  /** Unique cells with a significant result for at least one analyzed behavior. */
  responsive: number;
  /** Cells with at least one evaluated behavior. */
  evaluatedCells: number;
  /** Cells with no evaluated behavior. */
  notEvaluatedCells: number;
  /** One behavior: cells in each class. They add up to `evaluatedForBehavior`. */
  higher: number;
  lower: number;
  notSignificant: number;
  evaluatedForBehavior: number;
  notEvaluatedForBehavior: number;
  totalCells: number;
}

/** Cell counts for the four cards: Responsive across the run, the rest for the chosen behavior. */
export function aurocCardCounts(out: AurocOutcome, behavior: number): AurocCardCounts {
  const s = summarize(out);
  const c = s.perBehavior[behavior]?.counts ?? {
    excited: 0,
    inhibited: 0,
    'not significant': 0,
    'not evaluated': 0,
  };
  return {
    responsive: s.respondingCells,
    evaluatedCells: s.evaluated,
    notEvaluatedCells: s.cells - s.evaluated,
    higher: c.excited,
    lower: c.inhibited,
    notSignificant: c['not significant'],
    evaluatedForBehavior: c.excited + c.inhibited + c['not significant'],
    notEvaluatedForBehavior: c['not evaluated'],
    totalCells: s.cells,
  };
}

/** The four metric cards. Unique cells (Responsive) and one behavior's cells are never mixed in one card. */
export function aurocCards(out: AurocOutcome, behavior: number): MetricCard[] {
  const n = aurocCardCounts(out, behavior);
  const label = out.labels[behavior] ?? '';
  const scope = `evaluated for ${label}`;
  const part = (k: number, extra = '') =>
    `${percentText(k, n.evaluatedForBehavior)} · ${denomText(k, n.evaluatedForBehavior, 'cells', scope)}${extra}`;
  const notEval = n.notEvaluatedCells ? ` · ${n.notEvaluatedCells} not evaluated` : '';
  return [
    {
      label: 'Responsive cells',
      value: n.responsive.toLocaleString(),
      denom: `${denomText(n.responsive, n.evaluatedCells, 'cells evaluated')}${notEval} · any behavior`,
      tone: 'blue',
      help: 'Unique cells with an adjusted p below α for at least one analyzed behavior. A cell counts once however many behaviors it responds to.',
    },
    {
      label: `Higher activity · ${label}`,
      value: n.higher.toLocaleString(),
      denom: part(n.higher),
      tone: 'orange',
      help: 'Cells significant for this behavior with auROC above 0.5: higher neural values during the behavior than in the reference frames.',
    },
    {
      label: `Lower activity · ${label}`,
      value: n.lower.toLocaleString(),
      denom: part(n.lower),
      tone: 'purple',
      help: 'Cells significant for this behavior with auROC below 0.5: lower neural values during the behavior than in the reference frames.',
    },
    {
      label: `Not significant · ${label}`,
      value: n.notSignificant.toLocaleString(),
      denom: part(
        n.notSignificant,
        n.notEvaluatedForBehavior ? ` · ${n.notEvaluatedForBehavior} not evaluated` : '',
      ),
      tone: 'gray',
      help: 'Evaluated cells that are not significant for this behavior. Not evidence of no relationship.',
    },
  ];
}

/**
 * Largest distance of any auROC in the run from 0.5, rounded up to 0.01, so the color scale uses
 * its full range on small effects (0.5 ± 0.06 shows 0.44 to 0.56). At least 0.01.
 */
export function heatHalfRange(out: AurocOutcome): number {
  let dev = 0;
  for (const v of out.result.observed)
    if (Number.isFinite(v)) dev = Math.max(dev, Math.abs(v - 0.5));
  // Round away float noise before taking the ceiling
  const hundredths = Math.ceil(Math.round(dev * 1e6) / 1e4) / 100;
  return Math.min(0.5, Math.max(0.01, hundredths));
}

/** Diverging color around 0.5, symmetric over 0.5 ± half. Gray only for a missing value. */
export const heatColor = (v: number, half: number): string => aurocColor(v, 0.5 - half, 0.5 + half);

export interface HistogramBin {
  from: number;
  to: number;
  higher: number;
  lower: number;
  notSignificant: number;
}

/** auROC of the evaluated cells for one behavior in equal bins over 0.5 ± half, split by response. */
export function aurocHistogram(
  out: AurocOutcome,
  behavior: number,
  half: number,
  nBins = 20,
): HistogramBin[] {
  const width = (2 * half) / nBins;
  const bins: HistogramBin[] = Array.from({ length: nBins }, (_, i) => ({
    from: 0.5 - half + i * width,
    to: 0.5 - half + (i + 1) * width,
    higher: 0,
    lower: 0,
    notSignificant: 0,
  }));
  for (let c = 0; c < out.cellIds.length; c++) {
    const r = responseAt(out, c, behavior);
    if (r === 'not evaluated') continue;
    const v = aurocOf(out, c, behavior);
    const i = Math.min(nBins - 1, Math.max(0, Math.floor((v - (0.5 - half)) / width)));
    if (r === 'excited') bins[i].higher++;
    else if (r === 'inhibited') bins[i].lower++;
    else bins[i].notSignificant++;
  }
  return bins;
}

/** Cells for the ranked strip: highest auROC for the behavior first, not evaluated last. */
export function rankedByBehavior(out: AurocOutcome, behavior: number): number[] {
  const v = (c: number) => {
    const a = aurocOf(out, c, behavior);
    return Number.isFinite(a) ? a : -Infinity;
  };
  return out.cellIds.map((_, c) => c).sort((a, b) => v(b) - v(a) || a - b);
}

/** One-behavior runs use a wide strip and hide the overlap chart. */
export const isSingleBehavior = (out: AurocOutcome) => nBehaviors(out) === 1;
