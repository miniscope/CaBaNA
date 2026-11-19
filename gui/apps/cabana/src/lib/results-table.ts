// The Results overview: one row per analysis with its latest run, status, headline and run count,
// and the counts above the table. Pure functions of the saved records and of whether the newest
// result still matches the current settings; nothing here changes a setting or a record.

import type { RunRecord } from './bridge-client.ts';
import type { ExplorerData } from './explorer-data.ts';
import { outcomeCounts, placeCells } from './results-saved.ts';
import { TABLE_SPECS } from './results-explorer.ts';
import { analysisLabel, hasResults, isInProgress, overviewRows } from './results-overview.ts';
import type { Match } from './results-match.ts';
import { runType, type RunType } from './preview.ts';
import { runCounts, runRows, type RunCounts } from './results-runs.ts';
import type { AnalysisId } from './runs.ts';

export type RowStatus =
  | 'none'
  | 'running'
  | 'failed'
  | 'needs_rerun'
  /** A preview whose settings differ from the current ones. */
  | 'older'
  | 'current'
  /** Has results but cannot be compared with the settings now (engine off, or an older browser run). */
  | 'saved';

export interface TableRow {
  analysis: AnalysisId;
  label: string;
  record?: RunRecord;
  status: RowStatus;
  /** Under a "needs rerun" pill: what changed since the run. */
  reason?: string;
  /** Full analysis or Preview, with its shuffle count when recorded. */
  type?: RunType;
  /** Every saved run of this analysis, with or without results. */
  runs: number;
}

const joinWords = (words: string[]) =>
  words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/** "rejected cells and analysis settings changed since this run". */
export const reasonText = (diff: string[]) =>
  diff.length
    ? `${joinWords(diff)} changed since this run`
    : 'Settings or inputs changed since this run';

function statusOf(r: RunRecord | undefined, match: Match | undefined): RowStatus {
  if (!r) return 'none';
  if (isInProgress(r)) return 'running';
  if (!hasResults(r)) return 'failed';
  if (match) return match.matches ? 'current' : r.scope === 'preview' ? 'older' : 'needs_rerun';
  return 'saved';
}

/** One row per analysis, in the order of the Analysis page. */
export function tableRows(
  records: RunRecord[],
  matchOf: (r: RunRecord) => Match | undefined,
): TableRow[] {
  return overviewRows(records).map(({ analysis, record }) => {
    const match = record ? matchOf(record) : undefined;
    const status = statusOf(record, match);
    return {
      analysis,
      label: analysisLabel(analysis),
      record,
      status,
      reason: status === 'needs_rerun' ? reasonText(match?.diff ?? []) : undefined,
      type: record && hasResults(record) ? runType(record) : undefined,
      runs: records.filter((r) => r.analysis === analysis).length,
    };
  });
}

/** The four counts above the table (a Preview run counts only under Previews). */
export function tableCounts(
  records: RunRecord[],
  matchOf: (r: RunRecord) => Match | undefined,
): RunCounts {
  return runCounts(runRows(records, matchOf));
}

const responseColumn = (data: ExplorerData, analysis: AnalysisId) => {
  const t = data.tables.find((x) => x.name === TABLE_SPECS[analysis]?.file);
  const i = t?.columns.indexOf('response') ?? -1;
  return t && i >= 0 ? t.rows.map((row) => row[i]) : undefined;
};

/**
 * The result in one line, from what the run saved. Response tables (PETH, auROC) count the
 * significant pairs; other runs state how many saved p-values are below alpha, or only the size.
 */
export function headlineOf(analysis: AnalysisId, data: ExplorerData): string | undefined {
  const responses = responseColumn(data, analysis);
  if (responses?.some((v) => v !== '')) {
    const evaluated = responses.filter((v) => v !== 'Not evaluated').length;
    const sig = responses.filter((v) => v === 'Excited' || v === 'Inhibited').length;
    return `${sig} of ${evaluated} cell-behavior pairs significant`;
  }
  const place =
    analysis === 'place'
      ? placeCells(data.tables.find((t) => t.name === 'place_cells.csv'))
      : undefined;
  if (place?.length) {
    const n = outcomeCounts(place);
    return `${n.both} of ${place.length - n.cannot} cells pass both place-cell tests`;
  }
  const s = data.stats[0];
  if (!s) return undefined;
  // Decoding and the other framework results: the range of the saved statistic when nothing was tested.
  if (!(s.pAdj ?? s.pRaw) && s.range)
    return `${s.name}: ${+s.range[0].toPrecision(3)} to ${+s.range[1].toPrecision(3)}`;
  const p = s.pAdj ?? s.pRaw;
  const what = s.basis ?? 'values';
  return p ? `${p.below} of ${p.n} ${what} below alpha` : `${s.n} ${what}`;
}

/** What deleting a run removes, in words for the confirmation. `others` counts the analysis's other runs with results. */
export function deleteText(label: string, when: string, others: number, size?: string): string[] {
  return [
    `Removes ${label}, ${when} completely: the run record, its settings and all outputs${size ? ` (${size})` : ''}.`,
    others
      ? "Other runs and the project's current settings are not affected. This cannot be undone."
      : `This is the only ${label} run with results; the project's current settings are not affected. This cannot be undone.`,
  ];
}

/** What deleting only a run's outputs removes and keeps, in words for the confirmation. */
export function deleteOutputsText(label: string, when: string, size?: string): string[] {
  return [
    `Removes the result files, tables and figures of ${label}, ${when}${size ? ` (${size})` : ''}.`,
    'Kept: the run record, its settings and history, so it stays listed and can be run again with the same settings. Its results cannot be viewed until then.',
  ];
}
