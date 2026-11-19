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
import { runType, type RunType } from './preview.ts';
import type { AnalysisId } from './runs.ts';

/**
 * The Settings status of a run (its Type, Full analysis or Preview, is `runType`). The first four
 * are states of the run itself rather than of its settings.
 */
export type RunKind =
  | 'running'
  | 'failed'
  | 'partial'
  | 'cancelled'
  /** Its settings and inputs match the current ones. */
  | 'current'
  /** The newest full run, and its settings or inputs have changed since. */
  | 'needs_rerun'
  /** Its settings differ from the current ones, or a newer run of the same Type exists. */
  | 'older'
  /** Cannot be compared (Python engine off, or a browser-engine run that is not the newest). */
  | 'saved';

export const RUN_KIND_TEXT: Record<RunKind, string> = {
  running: 'Running',
  failed: 'Failed',
  partial: 'Partial',
  cancelled: 'Cancelled',
  current: 'Current',
  needs_rerun: 'Needs rerun',
  older: 'Older settings',
  saved: 'Not compared',
};

export { runType, type RunType };

/** Whether the newest result of an analysis still matches the current settings, when known. */
export type MatchOf = (r: RunRecord) => { matches: boolean; diff?: string[] } | undefined;

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

export interface SettingsStatus {
  kind: RunKind;
  /** "Current", "Needs rerun", "Older settings", ... */
  text: string;
  /** What changed, under Needs rerun, when the comparison says. */
  reason?: string;
}

/**
 * The Settings status of one run. `newestOfType` is whether it is the newest run with results of
 * its analysis and its Type (a Preview is not made older by a newer Full analysis, nor the
 * reverse). Only the newest full run can need a rerun; a preview whose settings differ is older.
 */
export function settingsStatus(
  r: RunRecord,
  newestOfType: boolean,
  match?: ReturnType<MatchOf>,
): SettingsStatus {
  const kind = ((): RunKind => {
    if (isInProgress(r)) return 'running';
    if (r.status === 'failed') return 'failed';
    if (r.status === 'partial') return 'partial';
    if (r.status === 'cancelled') return 'cancelled';
    if (match?.matches) return 'current';
    if (match) return newestOfType && r.scope !== 'preview' ? 'needs_rerun' : 'older';
    return newestOfType ? 'saved' : 'older';
  })();
  const diff = match && !match.matches ? match.diff : undefined;
  return {
    kind,
    text: RUN_KIND_TEXT[kind],
    reason: kind === 'needs_rerun' && diff?.length ? diff.join(', ') : undefined,
  };
}

/** Whether `r` is the newest run with results of its analysis and Type among `records`. */
export function isNewestOfType(r: RunRecord, records: RunRecord[]): boolean {
  const top = records
    .filter((x) => x.analysis === r.analysis && x.scope === r.scope && x.status === 'ok' && hasResults(x))
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];
  return top?.run_id === r.run_id;
}

export interface RunRow {
  record: RunRecord;
  analysis: AnalysisId;
  label: string;
  /** What the run compared or aligned to, in words; empty when it left no results. */
  target: string;
  signal: string;
  cells: string;
  /** Type: Full analysis or Preview, with the shuffle count when recorded. */
  type: RunType;
  /** Settings status. */
  settings: SettingsStatus;
  kind: RunKind;
  /** The settings status in words. */
  status: string;
}

/** One row per saved run, newest first, optionally of one analysis. */
export function runRows(records: RunRecord[], matchOf: MatchOf, analysis?: AnalysisId): RunRow[] {
  // The newest run with results of each analysis and Type.
  const newest = new Set<string>();
  for (const id of ANALYSIS_IDS)
    for (const scope of ['full', 'preview']) {
      const top = records
        .filter((r) => r.analysis === id && r.scope === scope && r.status === 'ok' && hasResults(r))
        .sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];
      if (top) newest.add(top.run_id);
    }
  return records
    .filter((r) => !analysis || r.analysis === analysis)
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc))
    .map((record) => {
      const settings = settingsStatus(record, newest.has(record.run_id), matchOf(record));
      return {
        record,
        analysis: record.analysis as AnalysisId,
        label: analysisLabel(record.analysis),
        target: hasResults(record) ? targetOf(record) : '',
        signal: signalOf(record),
        cells: cellsOf(record),
        type: runType(record),
        settings,
        kind: settings.kind,
        status: settings.text,
      };
    });
}

export interface RunCounts {
  saved: number;
  /** Full analyses whose settings match now. */
  current: number;
  /** Full analyses that need a rerun. */
  needRerun: number;
  /** Preview runs, whatever their Settings status. */
  previews: number;
  /** Running, failed, partial or cancelled: not counted in the three above. */
  other: number;
}

export function runCounts(rows: RunRow[]): RunCounts {
  const ended = (r: RunRow) => !['running', 'failed', 'partial', 'cancelled'].includes(r.kind);
  const n = (kinds: RunKind[], type: 'full' | 'preview') =>
    rows.filter((r) => ended(r) && r.type.kind === type && kinds.includes(r.kind)).length;
  return {
    saved: rows.length,
    current: n(['current'], 'full'),
    needRerun: n(['needs_rerun'], 'full'),
    previews: rows.filter((r) => ended(r) && r.type.kind === 'preview').length,
    other: rows.filter((r) => !ended(r)).length,
  };
}
