// Logic of the Results page: which saved result represents each analysis, what it is about, how
// it can be opened, and the history list. No display code; nothing here changes a setting.

import type { RunRecord } from './bridge-client.ts';
import { ANALYSES, setAnalysisId } from './analyses.ts';
import { openRunOf } from './results-nav.ts';
import { goToStep } from './store.ts';
import type { AnalysisId } from './runs.ts';

export const MIN_HISTORY_ROWS = 5;
export const NEWER_VERSION_TEXT = 'Saved by a newer framework or GUI; update to open.';
export const ANALYSIS_IDS: AnalysisId[] = ANALYSES.map((a) => a.id);
export const analysisLabel = (id: string) => ANALYSES.find((a) => a.id === id)?.label ?? id;

const HAS_RESULTS = new Set(['ok', 'partial', 'cancelled']);
const IN_PROGRESS = new Set(['queued', 'running']);
export const hasResults = (r: RunRecord) => HAS_RESULTS.has(r.status) && r.results_file !== null;
export const isInProgress = (r: RunRecord) => IN_PROGRESS.has(r.status);

const newestFirst = (a: RunRecord, b: RunRecord) => b.created_utc.localeCompare(a.created_utc);

/** The settings of an analysis as saved: framework records wrap them as `{analysis, prep, ...}`. */
function analysisSettings(r: RunRecord): Record<string, unknown> {
  const s = (r.gui?.settings ?? {}) as Record<string, unknown>;
  const inner = s.analysis;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : s;
}
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const labelCount = (labels: unknown) =>
  Array.isArray(labels) && labels.length ? count(labels.length, 'behavior') : 'all behaviors';

/** What a result is about, in words, from the settings it was saved with. */
export function targetOf(r: RunRecord): string {
  const s = analysisSettings(r);
  switch (r.analysis) {
    case 'place':
      return 'position bins';
    case 'auroc':
      return s.compare === 'behavior' && s.pairA && s.pairB
        ? `${String(s.pairA)} vs ${String(s.pairB)}`
        : 'behaviors vs all other frames';
    case 'peth': {
      const marker = typeof s.marker === 'string' && s.marker ? s.marker : undefined;
      const what = marker ?? 'behavior';
      const ends: Record<string, string> = {
        onset: `${what} onsets`,
        offset: `${what} offsets`,
        both: `${what} onsets and offsets`,
      };
      return ends[String(s.align)] ?? `${what} onsets`;
    }
    case 'population':
      return s.target === 'position' ? 'position bins' : labelCount(s.labels);
    case 'decoding':
      return s.type === 'position' ? 'position' : labelCount(s.labels);
    default:
      return r.result_names?.join(', ') ?? '';
  }
}

export interface OverviewRow {
  analysis: AnalysisId;
  /** The newest result that can be opened, else the newest record of any kind. */
  record?: RunRecord;
  /** A newer run that did not produce results (failed, still running) than `record`. */
  newer?: RunRecord;
}

/** One row per analysis: its latest saved result, and a newer failed or running run if any. */
export function overviewRows(records: RunRecord[]): OverviewRow[] {
  return ANALYSIS_IDS.map((analysis) => {
    const mine = records.filter((r) => r.analysis === analysis).sort(newestFirst);
    const record = mine.find(hasResults) ?? mine[0];
    const newer = mine.find((r) => r !== record && newestFirst(record!, r) > 0 && !hasResults(r));
    return { analysis, record, newer: record && hasResults(record) ? newer : undefined };
  });
}

/** Earlier executions: everything except the records the overview shows, grouped by analysis, newest first. */
export function historyRecords(records: RunRecord[], filter?: AnalysisId): RunRecord[] {
  const shown = new Set(overviewRows(records).flatMap((r) => (r.record ? [r.record.run_id] : [])));
  return ANALYSIS_IDS.filter((id) => !filter || id === filter).flatMap((id) =>
    records.filter((r) => r.analysis === id && !shown.has(r.run_id)).sort(newestFirst),
  );
}

export function pageOf<T>(items: T[], page: number, size = 8) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(at * size, (at + 1) * size), page: at, pages, total: items.length };
}

/** "Made with framework <commit>; current is <commit>" when the two differ. */
export function frameworkNote(r: RunRecord, currentCommit: string | null | undefined) {
  const made = r.framework?.commit;
  if (r.engine !== 'framework' || !made || !currentCommit) return undefined;
  if (made.startsWith(currentCommit) || currentCommit.startsWith(made)) return undefined;
  return `Made with framework ${made.slice(0, 7)}; current is ${currentCommit.slice(0, 7)}`;
}

export type Openness =
  | { kind: 'full' }
  /** Browser-engine record: summary and stored files only. */
  | { kind: 'files' }
  | { kind: 'blocked'; reason: string };

/** How a record can be opened. */
export function openness(r: RunRecord): Openness {
  if (r.record_version > 1) return { kind: 'blocked', reason: NEWER_VERSION_TEXT };
  if (isInProgress(r)) return { kind: 'blocked', reason: 'Still running.' };
  if (!hasResults(r)) return { kind: 'blocked', reason: 'This run produced no results.' };
  return r.engine === 'browser-ts' ? { kind: 'files' } : { kind: 'full' };
}

/** What the engine-dependent actions need, and why one is unavailable. */
export function unavailableReason(engineReady: boolean, blockers: string[] = []) {
  if (!engineReady) return 'Needs the Python engine.';
  return blockers[0];
}

/** The records to list: live ones while the engine answers, the saved copy otherwise. */
export const listedRecords = (engineReady: boolean, live: RunRecord[], cached: RunRecord[]) =>
  engineReady ? live : cached;

/** Show a saved result on its analysis page. Only changes which run the page shows. */
export function openResult(analysis: AnalysisId, runId: string): void {
  openRunOf(analysis, runId);
  setAnalysisId(analysis);
  goToStep('analyze');
}

/** Open an analysis page itself (for an analysis with no result yet). */
export function goToAnalysis(analysis: AnalysisId): void {
  setAnalysisId(analysis);
  goToStep('analyze');
}

/** First line of the last error, for a failed run. */
export const failureMessage = (r: RunRecord) =>
  r.errors.at(-1)?.message?.split('\n').filter(Boolean).at(-1) ?? 'The run failed.';

export const formatWhen = (utc: string | null) =>
  utc ? new Date(utc).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
