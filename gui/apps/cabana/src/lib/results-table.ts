// The Results overview: one row per analysis with its latest run, status, headline and run count,
// and the counts above the table. Pure functions of the saved records and of whether the newest
// result still matches the current settings; nothing here changes a setting or a record.

import type { RunRecord } from './bridge-client.ts';
import type { ExplorerData } from './explorer-data.ts';
import { outcomeCounts, placeCells } from './results-saved.ts';
import { TABLE_SPECS } from './results-explorer.ts';
import { analysisLabel, hasResults, isInProgress, overviewRows } from './results-overview.ts';
import type { Match } from './results-match.ts';
import { runCounts, runRows, type RunCounts } from './results-runs.ts';
import type { AnalysisId } from './runs.ts';

export type RowStatus =
  | 'none'
  | 'running'
  | 'failed'
  | 'needs_rerun'
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
  preliminary: boolean;
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
  if (match) return match.matches ? 'current' : 'needs_rerun';
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
      preliminary: record?.scope === 'preview' && hasResults(record),
      runs: records.filter((r) => r.analysis === analysis).length,
    };
  });
}

/** The four counts above the table (pass 1's rule: a preliminary run counts only as preliminary). */
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

/** Why the storage actions are unavailable until the engine saves projects and has the endpoints. */
export const STORAGE_NEEDS = 'Needs saved projects (engine)';
export const DELETE_OUTPUTS_NEEDS = 'Needs the engine to delete outputs';

/** What deleting a run removes, in words for the confirmation. `others` counts the analysis's other runs with results. */
export function deleteText(label: string, when: string, others: number): string[] {
  return [
    `This removes the ${label} run of ${when}: its record, the settings it used and its result files. It cannot be undone.`,
    others
      ? `The ${others} other ${label} ${others === 1 ? 'run stays' : 'runs stay'} listed.`
      : `This is the only ${label} run with results; ${label} needs a rerun to have a result again.`,
  ];
}
