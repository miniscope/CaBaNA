// Logic of the Results Hub: one card per analysis counted from the saved records, and the
// filters of the history list. No display code; nothing here changes a setting or a record.

import type { RunRecord } from './bridge-client.ts';
import {
  analysisLabel,
  ANALYSIS_IDS,
  hasResults,
  isInProgress,
  overviewRows,
} from './results-overview.ts';
import type { AnalysisId } from './runs.ts';

export type ScopeFilter = 'all' | 'full' | 'preview';
export type StatusFilter = 'all' | 'ok' | 'partial' | 'cancelled' | 'failed' | 'running';
export interface RunFilter {
  analysis?: AnalysisId | '';
  scope?: ScopeFilter;
  status?: StatusFilter;
}

export const SCOPE_OPTIONS: [ScopeFilter, string][] = [
  ['all', 'Full and preliminary'],
  ['full', 'Full analysis'],
  ['preview', 'Preliminary'],
];
export const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['all', 'Any status'],
  ['ok', 'Completed'],
  ['partial', 'Partial'],
  ['cancelled', 'Cancelled'],
  ['failed', 'Failed'],
  ['running', 'Running'],
];

const newestFirst = (a: RunRecord, b: RunRecord) => b.created_utc.localeCompare(a.created_utc);

/** Every saved run that passes the filters, newest first. A queued run counts as running. */
export function filterRuns(records: RunRecord[], f: RunFilter = {}): RunRecord[] {
  return records
    .filter((r) => !f.analysis || r.analysis === f.analysis)
    .filter((r) => !f.scope || f.scope === 'all' || r.scope === f.scope)
    .filter((r) => {
      if (!f.status || f.status === 'all') return true;
      return f.status === 'running' ? isInProgress(r) : r.status === f.status;
    })
    .sort(newestFirst);
}

/** The state of a run in words, for the card. */
export function statusText(r: RunRecord | undefined): string {
  if (!r) return 'No result yet';
  if (isInProgress(r)) return 'Running';
  const text: Record<string, string> = {
    ok: 'Completed',
    partial: 'Partial: some analyses failed',
    cancelled: 'Cancelled: partial results',
    failed: 'Failed',
  };
  return text[r.status] ?? r.status;
}

export interface AnalysisCard {
  analysis: AnalysisId;
  label: string;
  /** All saved runs of this analysis, with or without results. */
  runs: number;
  /** Runs that left something to open. */
  withResults: number;
  full: number;
  preliminary: number;
  failed: number;
  /** The run the card opens: the newest with results, else the newest of any kind. */
  latest?: RunRecord;
  latestWhen: string | null;
  status: string;
  /** A run newer than `latest` that has no results: failed, or still running. */
  newer?: RunRecord;
}

/** One card per analysis, counted from the saved records only. */
export function analysisCards(records: RunRecord[]): AnalysisCard[] {
  const rows = new Map(overviewRows(records).map((row) => [row.analysis, row]));
  return ANALYSIS_IDS.map((analysis) => {
    const mine = records.filter((r) => r.analysis === analysis);
    const done = mine.filter(hasResults);
    const { record: latest, newer } = rows.get(analysis) ?? {};
    return {
      analysis,
      label: analysisLabel(analysis),
      runs: mine.length,
      withResults: done.length,
      full: done.filter((r) => r.scope === 'full').length,
      preliminary: done.filter((r) => r.scope === 'preview').length,
      failed: mine.filter((r) => r.status === 'failed').length,
      latest,
      latestWhen: latest?.created_utc ?? null,
      status: statusText(latest),
      newer,
    };
  });
}

/** "3 runs: 2 full, 1 preliminary", or that there is none. */
export function countsText(c: Pick<AnalysisCard, 'runs' | 'full' | 'preliminary' | 'failed'>) {
  if (!c.runs) return 'No saved runs';
  const parts = [`${c.full} full`, `${c.preliminary} preliminary`];
  if (c.failed) parts.push(`${c.failed} failed`);
  return `${c.runs} ${c.runs === 1 ? 'run' : 'runs'}: ${parts.join(', ')}`;
}
