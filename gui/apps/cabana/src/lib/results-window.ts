// Logic of the Results window: the key finding of the Overview, the plots of the Plot type
// drop-down, and which run the window shows. Everything is read from what the run saved.

import type { RunRecord } from './bridge-client.ts';
import type { ExplorerData } from './explorer-data.ts';
import { plotsOf, shuffleTestText, type PlotEntry } from './results-explorer.ts';
import { hasResults } from './results-overview.ts';
import { headlineOf } from './results-table.ts';
import type { AnalysisId } from './runs.ts';

export type WindowView = 'overview' | 'vis' | 'tables' | 'stats';

export interface KeyFinding {
  headline: string;
  /** What the test was, from the saved settings. */
  sentence?: string;
  /** Up to three numbers the run saved, each with what it counts. */
  numbers: { value: string; label: string }[];
}

/** The saved statistics as at most three figures: p-values below alpha when tested, else the count. */
function quickNumbers(data: ExplorerData) {
  return data.stats.slice(0, 3).map((s) => {
    const c = s.pAdj ?? s.pRaw;
    const alpha = s.test?.alpha === undefined ? 'alpha' : String(s.test.alpha);
    return c
      ? {
          value: `${c.below} of ${c.n}`,
          label: `${s.name}: ${s.pAdj ? 'adjusted ' : ''}p below ${alpha}`,
        }
      : { value: String(s.n), label: `${s.name}: ${s.basis ?? 'values'}` };
  });
}

/** The Overview's key finding of a run, from its saved tables and statistics only. */
export function keyFinding(
  r: RunRecord,
  data: ExplorerData | undefined,
  headline?: string,
): KeyFinding {
  if (!data) return { headline: 'Reading the saved run', numbers: [] };
  return {
    headline: headline ?? headlineOf(r.analysis as AnalysisId, data) ?? 'Saved result',
    sentence: shuffleTestText(data.summary.settings),
    numbers: quickNumbers(data),
  };
}

/**
 * The plots of an analysis's own page that the Plot type list adds after the window's views: none
 * when the views already cover them (decoding and population draw all of theirs).
 */
export function pagePlots(
  analysis: AnalysisId,
  data: ExplorerData | undefined,
  record: RunRecord,
  covered: boolean,
): PlotEntry[] {
  if (covered) return [];
  return plotsOf(analysis, data?.resultNames ?? record.result_names ?? [], data?.target);
}

/** The runs of an analysis the window can show, newest first. */
export const windowRuns = (records: RunRecord[], analysis: string): RunRecord[] =>
  records
    .filter((r) => r.analysis === analysis && hasResults(r))
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc));

/** What a page plot is called when a view of the window already has that name. */
export const pagePlotLabel = (title: string, taken: string[]) =>
  taken.includes(title) ? `${title} (detailed)` : title;
