// Reads what a saved run holds for the Results Explorer: its tables, statistics and test
// settings. A framework run is read from its results (the bridge, or the copy cached in this
// browser); a browser-engine run only has the CSV and metadata files saved with it. Nothing here
// recomputes an analysis.

import { bridge, type RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import { keptFile } from './browser-records.ts';
import { dumpSource, type EngineDump } from './decoding-engine-results.ts';
import {
  browserTestSettings,
  categoryCounts,
  frameworkStatRow,
  parseSavedCsv,
  tableStatRows,
  TABLE_SPECS,
  type SavedTable,
  type StatRow,
  type SummaryInput,
  type TestSettings,
} from './results-explorer.ts';
import { loadResult, type ResultSource } from './results-load.ts';
import { runSource } from './results-store.ts';
import type { AnalysisId } from './runs.ts';

export interface ExplorerData {
  tables: SavedTable[];
  /** Why the tables are missing or incomplete. */
  tablesNote?: string;
  stats: StatRow[];
  /** Why the statistics are missing or incomplete. */
  statsNote?: string;
  summary: Omit<SummaryInput, 'record'>;
  /** Names of the results (framework) or files (browser engine) the run holds. */
  resultNames: string[];
  /** The decoding target saved with the settings, when there is one. */
  target?: string;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const settingsOf = (r: RunRecord): Record<string, unknown> => {
  const s = (r.gui.settings ?? {}) as Record<string, unknown>;
  const inner = s.analysis;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : s;
};

const decodingTarget = (r: RunRecord) =>
  settingsOf(r).type === 'position' ? 'position' : 'behaviors';

/** The text of a file kept with a browser-engine run: this browser's copy, else the project's. */
async function savedFile(r: RunRecord, name: string): Promise<string | undefined> {
  const kept = keptFile(r.run_id, name);
  if (kept !== undefined) return kept;
  if (!bridgeReady()) return undefined;
  return bridge.runFile(r.run_id, name).catch(() => undefined);
}

/** Statistics of every result a results source holds. */
async function sourceStats(src: ResultSource): Promise<StatRow[]> {
  const manifest = await src.manifest();
  const rows: StatRow[] = [];
  for (const m of manifest.results)
    rows.push(frameworkStatRow(await loadResult(src, manifest, m.name, [])));
  return rows;
}

const topTest = (stats: StatRow[]): TestSettings => stats.find((s) => s.test)?.test ?? {};

async function frameworkData(r: RunRecord): Promise<ExplorerData> {
  const src = runSource(r.run_id);
  const manifest = await src.manifest();
  const names = manifest.results.map((m) => m.name);
  const stats = await sourceStats(src).catch(() => [] as StatRow[]);
  const tables: SavedTable[] = [];
  let tablesNote: string | undefined;
  if (!bridgeReady()) tablesNote = 'Tables are read from the Python engine, which is not running.';
  else
    for (const name of names) {
      try {
        tables.push(parseSavedCsv(name, await bridge.tableCsv(r.run_id, name)));
      } catch (e) {
        tablesNote = `Some tables could not be read: ${errorText(e)}`;
      }
    }
  return {
    tables,
    tablesNote,
    stats,
    statsNote: stats.length ? undefined : 'The saved results hold no statistics.',
    summary: { settings: topTest(stats), stats },
    resultNames: names,
    target: r.analysis === 'decoding' ? decodingTarget(r) : undefined,
  };
}

async function browserData(r: RunRecord, analysis: AnalysisId): Promise<ExplorerData> {
  const files = r.files ?? [];
  const resultNames = files;
  const settings = settingsOf(r);
  // Decoding keeps its whole result dump, which reads like a framework result.
  if (analysis === 'decoding') {
    const text = await savedFile(r, 'results.json');
    if (text === undefined)
      return {
        tables: [],
        tablesNote: 'The stored result file is not available here.',
        stats: [],
        statsNote: 'The stored result file is not available here.',
        summary: { settings: {}, stats: [] },
        resultNames,
      };
    const dump = JSON.parse(text) as EngineDump;
    const stats = await sourceStats(dumpSource(dump));
    return {
      tables: [],
      tablesNote: 'Decoding saves its result arrays as one file, not as tables.',
      stats,
      summary: { settings: topTest(stats), stats },
      resultNames: dump.manifest.results.map((m) => m.name),
      target: decodingTarget(r),
    };
  }
  const tables: SavedTable[] = [];
  let metadata: unknown;
  let missing = false;
  for (const f of files) {
    const text = await savedFile(r, f);
    if (text === undefined) missing = true;
    else if (f.endsWith('.csv')) tables.push(parseSavedCsv(f, text));
    else if (f === 'metadata.json') metadata = JSON.parse(text);
  }
  const note = missing ? 'Some stored files need the Python engine and are not shown.' : undefined;
  const spec = TABLE_SPECS[analysis];
  const main = spec && tables.find((t) => t.name === spec.file);
  const test = browserTestSettings(analysis, settings, metadata);
  const stats = main && spec ? tableStatRows(main, spec, test) : [];
  return {
    tables,
    tablesNote: note,
    stats,
    statsNote: stats.length ? note : (note ?? 'The stored tables hold no statistics.'),
    summary: {
      settings: test,
      stats,
      categories:
        main && spec?.category
          ? { title: spec.category.title, counts: categoryCounts(main, spec) }
          : undefined,
    },
    resultNames,
  };
}

/** Everything the Explorer shows for a saved run. */
export function loadExplorerData(r: RunRecord): Promise<ExplorerData> {
  return r.engine === 'framework' ? frameworkData(r) : browserData(r, r.analysis as AnalysisId);
}
