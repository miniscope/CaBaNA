// The Results page's table of saved runs and the four counts above it. Pure functions of the saved
// records and of whether each analysis's newest result still matches the current settings.

import type { RunRecord } from './bridge-client.ts';
import {
  analysisLabel,
  ANALYSIS_IDS,
  hasResults,
  isInProgress,
  targetOf,
} from './results-overview.ts';
import type { AnalysisId } from './runs.ts';

export type RunKind =
  | 'running'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'preliminary'
  /** Its settings and inputs match the current ones. */
  | 'current'
  | 'needs_rerun'
  /** A newer run of the same analysis exists. */
  | 'earlier'
  /** The newest run, but it cannot be compared (Python engine off, or a browser-engine run). */
  | 'saved';

export const RUN_KIND_TEXT: Record<RunKind, string> = {
  running: 'running',
  failed: 'failed',
  partial: 'partial',
  cancelled: 'cancelled',
  preliminary: 'preliminary',
  current: 'current',
  needs_rerun: 'needs rerun',
  earlier: 'earlier run',
  saved: 'saved',
};

/** Whether the newest result of an analysis still matches the current settings, when known. */
export type MatchOf = (r: RunRecord) => { matches: boolean } | undefined;

const SIGNAL_WORD = { deconvolved: 'events', denoised: 'denoised', raw: 'raw' } as const;

/** The neural signal a run read: events unless its saved dependencies name another file. */
export function signalOf(r: RunRecord): string {
  const s = (r.gui?.settings ?? {}) as { deps?: { analysisData?: string } };
  const kind = s.deps?.analysisData as keyof typeof SIGNAL_WORD | undefined;
  return (kind && SIGNAL_WORD[kind]) || 'events';
}

/** The cells a run used, in words. Records keep the excluded cells, not the total. */
export function cellsOf(r: RunRecord): string {
  const out = r.rejected_cell_ids?.length ?? r.gui?.rejected_cells?.length ?? 0;
  return out ? `all but ${out}` : 'all';
}

export function runKind(r: RunRecord, newestOfAnalysis: boolean, match?: ReturnType<MatchOf>) {
  if (isInProgress(r)) return 'running';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'partial') return 'partial';
  if (r.status === 'cancelled') return 'cancelled';
  if (r.scope === 'preview') return 'preliminary';
  if (!newestOfAnalysis) return 'earlier';
  if (match) return match.matches ? 'current' : 'needs_rerun';
  return 'saved';
}

export interface RunRow {
  record: RunRecord;
  analysis: AnalysisId;
  label: string;
  /** What the run compared or aligned to, in words; empty when it left no results. */
  target: string;
  signal: string;
  cells: string;
  kind: RunKind;
  status: string;
}

/** One row per saved run, newest first, optionally of one analysis. */
export function runRows(records: RunRecord[], matchOf: MatchOf, analysis?: AnalysisId): RunRow[] {
  const newest = new Map<string, string>();
  for (const id of ANALYSIS_IDS) {
    const top = records
      .filter((r) => r.analysis === id && r.status === 'ok' && hasResults(r))
      .sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];
    if (top) newest.set(id, top.run_id);
  }
  return records
    .filter((r) => !analysis || r.analysis === analysis)
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc))
    .map((record) => {
      const kind = runKind(record, newest.get(record.analysis) === record.run_id, matchOf(record));
      return {
        record,
        analysis: record.analysis as AnalysisId,
        label: analysisLabel(record.analysis),
        target: hasResults(record) ? targetOf(record) : '',
        signal: signalOf(record),
        cells: cellsOf(record),
        kind,
        status: RUN_KIND_TEXT[kind],
      };
    });
}

export interface RunCounts {
  saved: number;
  current: number;
  needRerun: number;
  preliminary: number;
  /** Running, failed, partial or cancelled: not counted in the three above. */
  other: number;
}

export function runCounts(rows: RunRow[]): RunCounts {
  const n = (kinds: RunKind[]) => rows.filter((r) => kinds.includes(r.kind)).length;
  return {
    saved: rows.length,
    current: n(['current']),
    needRerun: n(['needs_rerun']),
    preliminary: n(['preliminary']),
    other: n(['running', 'failed', 'partial', 'cancelled']),
  };
}
