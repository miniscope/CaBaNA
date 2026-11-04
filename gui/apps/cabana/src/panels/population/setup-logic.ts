// Pure helpers of the guided Population page: the stability block layout, the statistics table,
// the setup summary and the one-line result summaries. Nothing here computes a result; the
// numbers come from the framework arrays and are only counted or formatted.

import type {
  DimensionalityView,
  MatrixView,
  PairwiseView,
  StabilityView,
} from '../../lib/population-results.ts';
import type { PopulationMethod, PopulationSettings } from '../../lib/population-settings.ts';
import { correctionScope, fmt } from './logic.ts';

// ---------- stability blocks ----------

export interface BlockSpan {
  block: number;
  /** First and one past the last used frame of the block, counted among the used frames. */
  start: number;
  end: number;
  half: 'A' | 'B';
}

/**
 * How the framework cuts the used frames for stability: `blocks` contiguous parts of equal size
 * (frame i is in block floor(i * blocks / n)); even blocks form half A, odd blocks half B.
 */
export function stabilityBlocks(nUsed: number, blocks: number): BlockSpan[] {
  const k = Math.max(2, Math.round(blocks));
  const first = (b: number) => Math.floor((b * nUsed + k - 1) / k);
  return Array.from({ length: k }, (_, b) => ({
    block: b,
    start: first(b),
    end: b + 1 === k ? nUsed : first(b + 1),
    half: b % 2 === 0 ? ('A' as const) : ('B' as const),
  }));
}

// ---------- statistics table ----------

export type StatStatus = 'corrected' | 'uncorrected' | 'descriptive';
export interface StatRow {
  method: PopulationMethod;
  label: string;
  /** What is compared with the null, and how many tests that makes. */
  comparisons: string;
  nullText: string;
  correction: string;
  status: StatStatus;
  /** What max-stat does to this row, stated whatever the correction setting is. */
  maxStat: 'covered' | 'not covered' | 'not tested';
}

export const MAX_STAT_SCOPE = 'applies to stability and per-state participation ratio only';

/** One row per selected analysis: comparisons, null, correction and status, from the settings. */
export function statsTable(s: PopulationSettings, nStates: number | undefined): StatRow[] {
  const shuffled = `Circular cell shift, ${s.shuffles} shuffles`;
  const states =
    nStates === undefined ? 'each state' : `${nStates} state${nStates === 1 ? '' : 's'}`;
  const pairs =
    nStates === undefined
      ? 'each pair of states'
      : `${(nStates * (nStates - 1)) / 2} state pair${nStates === 2 ? '' : 's'}`;
  return correctionScope(s, nStates).map((l) => {
    const descriptive = l.method === 'pairwise';
    const perState =
      l.method === 'stability' || (l.method === 'dimensionality' && s.perStateParticipation);
    const comparisons = descriptive
      ? 'None'
      : l.method === 'similarity' || l.method === 'separation'
        ? pairs
        : perState
          ? states
          : 'Whole session';
    return {
      method: l.method,
      label: l.label,
      comparisons,
      nullText: descriptive ? 'None' : shuffled,
      correction: descriptive ? 'None' : l.corrected ? 'Max-stat' : 'None',
      status: descriptive ? 'descriptive' : l.corrected ? 'corrected' : 'uncorrected',
      maxStat: descriptive ? 'not tested' : perState ? 'covered' : 'not covered',
    };
  });
}

/** Beside a result that max-stat does not cover, when max-stat is chosen; otherwise nothing. */
export function maxStatNote(s: PopulationSettings, row: StatRow): string | undefined {
  return s.correction === 'max_stat' && row.maxStat !== 'covered' ? MAX_STAT_SCOPE : undefined;
}

// ---------- setup summary ----------

const METHOD_SHORT: Record<PopulationMethod, string> = {
  similarity: 'PV similarity',
  stability: 'PV stability',
  separation: 'State separation',
  dimensionality: 'Dimensionality',
  pairwise: 'Pairwise correlations',
};

/** Selected methods with their main settings, one string each. */
export function methodSummaries(s: PopulationSettings): string[] {
  const out: string[] = [];
  const on = (m: PopulationMethod) => s.methods[m];
  if (on('similarity'))
    out.push(
      `${METHOD_SHORT.similarity} (${s.similarity === 'cosine' ? 'cosine' : 'Pearson'}, min ${s.pvMinOccupancyS} s)`,
    );
  if (on('stability')) out.push(`${METHOD_SHORT.stability} (${s.stabilityBlocks} blocks)`);
  if (on('separation'))
    out.push(
      s.space === 'pca'
        ? `${METHOD_SHORT.separation} (PCA, ${s.components} components, ${s.pcaDistance})`
        : `${METHOD_SHORT.separation} (all cells, ${s.allDistance})`,
    );
  if (on('dimensionality'))
    out.push(
      `${METHOD_SHORT.dimensionality} (participation ratio${s.perStateParticipation ? ', per state' : ''})`,
    );
  if (on('pairwise')) out.push(`${METHOD_SHORT.pairwise} (${s.pairwiseKind}, ${s.pairwiseMethod})`);
  return out;
}

// ---------- result summaries ----------

export interface OverviewLine {
  text: string;
  /** True when the result can be read against a null (a p-value exists). */
  tested: boolean;
}

const countBelow = (p: (number | null)[], alpha: number) =>
  p.filter((v) => v != null && v <= alpha).length;

/** "2 of 3 state pairs with p ≤ 0.05 (uncorrected)" for a matrix result. */
export function matrixLine(v: MatrixView, alpha: number, what: string): OverviewLine {
  const ps = v.pairs.map((r) => r.p);
  if (!ps.length || ps.every((p) => p == null))
    return { text: `${ps.length} state pairs; no test in this run`, tested: false };
  return {
    text: `${countBelow(ps, alpha)} of ${ps.length} state pairs ${what} (p ≤ ${alpha}, uncorrected)`,
    tested: true,
  };
}

export function stabilityLine(v: StabilityView, alpha: number, corrected: boolean): OverviewLine {
  const p = corrected && v.pAdj ? v.pAdj : v.p;
  if (p.every((x) => x == null))
    return { text: `${v.states.length} states; no test`, tested: false };
  return {
    text: `${countBelow(p, alpha)} of ${v.states.length} states with ${corrected ? 'adjusted ' : ''}p ≤ ${alpha}${corrected ? ' (max-stat)' : ' (uncorrected)'}`,
    tested: true,
  };
}

/** The participation ratio, with its null range and p only when the run returned them. */
export function dimensionalityText(
  v: Pick<DimensionalityView, 'participationRatio' | 'nullLo' | 'nullHi' | 'p'>,
  perState: boolean,
): string {
  const pr = v.participationRatio[0];
  const head = `Participation ratio ${fmt(pr, 1)}${perState ? ' (first state)' : ''}`;
  const hasNull = v.nullLo[0] != null && v.nullHi[0] != null;
  if (!hasNull) return `${head}; no null returned, descriptive`;
  const p = v.p[0] != null ? `; two-sided p ${fmt(v.p[0], 3)}` : '';
  return `${head}; null ${fmt(v.nullLo[0], 1)} to ${fmt(v.nullHi[0], 1)}${p}`;
}

export function dimensionalityLine(v: DimensionalityView, perState: boolean): OverviewLine {
  return { text: dimensionalityText(v, perState), tested: v.nullLo[0] != null };
}

export function pairwiseLine(v: PairwiseView): OverviewLine {
  return {
    text: `Mean pair correlation ${fmt(v.meanOffDiagonal, 3)} over ${v.cells} cells; descriptive`,
    tested: false,
  };
}

// ---------- data preview ----------

export interface StateTime {
  name: string;
  bins: number;
  seconds: number;
  /** Share of all time bins of the session, 0 to 1. */
  share: number;
}

/** Time in each state at the chosen bin size, from the preview bin counts. */
export function stateTimes(
  rows: { name: string; bins: number }[],
  binS: number,
  totalBins: number,
): StateTime[] {
  return rows.map((r) => ({
    name: r.name,
    bins: r.bins,
    seconds: r.bins * binS,
    share: totalBins > 0 ? r.bins / totalBins : 0,
  }));
}

export interface TimelineBar {
  /** Left edge and width as fractions of the session. */
  left: number;
  width: number;
}

/** The epochs of each label as bars on a 0 to 1 time axis; epochs outside the session are clipped. */
export function timelineBars(
  epochs: { label: string; start: number; stop: number }[],
  labels: string[],
  duration: number,
): Record<string, TimelineBar[]> {
  const out: Record<string, TimelineBar[]> = Object.fromEntries(labels.map((l) => [l, []]));
  if (!(duration > 0)) return out;
  for (const e of epochs) {
    if (!out[e.label]) continue;
    const a = Math.max(0, e.start);
    const b = Math.min(duration, e.stop);
    if (b > a) out[e.label].push({ left: a / duration, width: (b - a) / duration });
  }
  return out;
}
