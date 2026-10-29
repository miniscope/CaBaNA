// What the auROC results screens show, derived from a finished run.

import { responseOf, type Response } from './auroc.ts';
import { aurocOutcome, aurocSettings, type AurocOutcome } from './auroc-run.ts';
import { AUROC_LABELS, describeChanges, runMatch } from './engine.ts';
import { prepChanges } from './prep-deps.ts';
import { canonicalJson } from './settings-hash.ts';

/** Settings changed since the last run, in words. Empty when there is no run or nothing changed. */
export function aurocChanges(): string[] {
  const o = aurocOutcome();
  if (!o) return [];
  // A framework run is compared by the hash of its settings, not field by field.
  if (o.record) return describeChanges(runMatch('auroc')?.diff ?? [], AUROC_LABELS);
  const filterOn = o.settings.speedFilter || aurocSettings.speedFilter;
  const out = prepChanges('auroc', o.prep, filterOn);
  const s = o.settings;
  // Every analysis setting counts, not only the speed filter (a changed shuffle count or method made the results stale).
  const same = (k: keyof typeof s) => canonicalJson(s[k]) === canonicalJson(aurocSettings[k]);
  const unused = (k: keyof typeof s) =>
    (k === 'minSpeed' && !filterOn) ||
    (k === 'minShiftS' && s.shiftAuto && aurocSettings.shiftAuto) ||
    (k === 'match' && s.method === 'circular' && aurocSettings.method === 'circular');
  for (const k of Object.keys(AUROC_LABELS) as (keyof typeof s)[])
    if (!same(k) && !unused(k)) out.push(AUROC_LABELS[k]);
  return [...new Set(out)];
}

export const RESPONSES: Response[] = ['excited', 'inhibited', 'not significant', 'not evaluated'];
/** Direction is named only for significant results; the symbol keeps it readable without color. */
export const RESPONSE_LABEL: Record<Response, string> = {
  excited: '▲ Higher (excited)',
  inhibited: '▼ Lower (inhibited)',
  'not significant': 'Not significant',
  'not evaluated': 'Not evaluated',
};
/** The response names in the exported CSV, which stay as they were. */
export const RESPONSE_CSV: Record<Response, string> = {
  excited: 'Excited',
  inhibited: 'Inhibited',
  'not significant': 'Not significant',
  'not evaluated': 'Not evaluated',
};

export const nBehaviors = (out: AurocOutcome) => out.labels.length;
export const aurocOf = (out: AurocOutcome, c: number, b: number) =>
  out.result.observed[c * nBehaviors(out) + b];
export const pAdjOf = (out: AurocOutcome, c: number, b: number) =>
  out.result.pAdj[c * nBehaviors(out) + b];
export const pRawOf = (out: AurocOutcome, c: number, b: number) =>
  out.result.pRaw[c * nBehaviors(out) + b];
export const responseAt = (out: AurocOutcome, c: number, b: number): Response =>
  responseOf(aurocOf(out, c, b), pAdjOf(out, c, b), out.settings.alpha);

/** Largest departure from 0.5 across the tested behaviors of a cell; -1 if none was tested. */
export function strength(out: AurocOutcome, c: number): number {
  let best = -1;
  for (let b = 0; b < nBehaviors(out); b++) {
    const a = aurocOf(out, c, b);
    if (Number.isFinite(a)) best = Math.max(best, Math.abs(a - 0.5));
  }
  return best;
}

export interface Summary {
  cells: number;
  /** Cells with at least one tested behavior. */
  evaluated: number;
  /** Cells with a missing neural value among the included frames. */
  missingCells: number;
  evaluatedPairs: number;
  significantPairs: number;
  excited: number;
  inhibited: number;
  respondingCells: number;
  perBehavior: { label: string; counts: Record<Response, number> }[];
  /** Cells by number of significant behaviors (index = number). */
  bySignificantCount: number[];
  /** Cells by which behaviors they respond to, e.g. "Investigation ▲ + Mounting ▼". */
  patterns: { pattern: string; cells: number }[];
  /** Behaviors with too few frames during or outside (not tested). */
  tooFewFrames: string[];
}

const MARK: Partial<Record<Response, string>> = { excited: '▲', inhibited: '▼' };

export function summarize(out: AurocOutcome): Summary {
  const nb = nBehaviors(out);
  const cells = out.cellIds.length;
  const perBehavior = out.labels.map((label) => ({
    label,
    counts: { excited: 0, inhibited: 0, 'not significant': 0, 'not evaluated': 0 } as Record<
      Response,
      number
    >,
  }));
  const bySignificantCount = new Array<number>(nb + 1).fill(0);
  const patterns = new Map<string, number>();
  let evaluated = 0;
  let evaluatedPairs = 0;
  let excited = 0;
  let inhibited = 0;
  let responding = 0;
  for (let c = 0; c < cells; c++) {
    const parts: string[] = [];
    let tested = 0;
    for (let b = 0; b < nb; b++) {
      const r = responseAt(out, c, b);
      perBehavior[b].counts[r]++;
      if (r === 'not evaluated') continue;
      tested++;
      if (r === 'excited') excited++;
      if (r === 'inhibited') inhibited++;
      if (MARK[r]) parts.push(`${out.labels[b]} ${MARK[r]}`);
    }
    if (!tested) continue;
    evaluated++;
    evaluatedPairs += tested;
    bySignificantCount[parts.length]++;
    if (parts.length) {
      responding++;
      patterns.set(parts.join(' + '), (patterns.get(parts.join(' + ')) ?? 0) + 1);
    }
  }
  return {
    cells,
    evaluated,
    missingCells: out.cellsMissing.length,
    evaluatedPairs,
    significantPairs: excited + inhibited,
    excited,
    inhibited,
    respondingCells: responding,
    perBehavior,
    bySignificantCount,
    patterns: [...patterns].map(([pattern, n]) => ({ pattern, cells: n })).sort((a, b) => b.cells - a.cells),
    tooFewFrames: out.info.filter((i) => i.during < 20 || i.outside < 20).map((i) => i.label),
  };
}

/** Purple (lower) through light gray (0.5) to orange (higher); values outside [lo, hi] share the end colors. */
export function aurocColor(v: number, lo = 0, hi = 1): string {
  if (!Number.isFinite(v)) return '#d0d0d0';
  const t = Math.max(-1, Math.min(1, (v - 0.5) / ((hi - lo) / 2)));
  const mix = (a: number[], b: number[], f: number) =>
    `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * f)).join(',')})`;
  const mid = [238, 236, 234];
  return t >= 0 ? mix(mid, [242, 140, 30], t) : mix(mid, [106, 61, 184], -t);
}

/** Cells in the order the heatmap and the list show them, strongest association first. */
export function rankedCells(out: AurocOutcome): number[] {
  const cells = out.cellIds.map((_, i) => i);
  return cells.sort((a, b) => strength(out, b) - strength(out, a) || a - b);
}
