// Every saved run in one list, newest first, read by the sidebar, the Results page and its
// history: the project's records from the bridge (or this browser's copy of them while the
// engine is off) and the browser-engine records kept in this browser. Freshness and the last
// attempt of each analysis come from here too.

import { createEffect, createMemo, createRoot, createSignal, on } from 'solid-js';
import type { RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import { browserRecords, loadBrowserRecords, syncBrowserRecords } from './browser-records.ts';
import { hasResults } from './results-overview.ts';
import { cachedRecords, cacheRecords } from './results-store.ts';
import { history, latest, refreshHistory, type AnalysisId } from './runs.ts';

const [saved, setSaved] = createSignal<RunRecord[]>([]);
const [live, setLive] = createSignal(false);

const newestFirst = (a: RunRecord, b: RunRecord) => b.created_utc.localeCompare(a.created_utc);

/** All saved runs, each once, newest first. */
export const resultIndex = createRoot(() =>
  createMemo(() => {
    const project = live() ? history() : saved();
    const byId = new Map<string, RunRecord>();
    for (const r of [...project, ...browserRecords()])
      if (!byId.has(r.run_id)) byId.set(r.run_id, r);
    return [...byId.values()].sort(newestFirst);
  }),
);

/** Start keeping the index: read this browser's copies, then follow the engine. Idempotent. */
let started = false;
export function startResultIndex(): void {
  if (started) return;
  started = true;
  void cachedRecords().then(setSaved);
  void loadBrowserRecords();
  createRoot(() => {
    createEffect(() => {
      if (!bridgeReady()) return setLive(false);
      void syncBrowserRecords()
        .then(refreshHistory)
        .then(
          () => setLive(true),
          () => setLive(false),
        );
    });
    // Each list the engine returns is kept for when it stops.
    createEffect(
      on(history, (records) => {
        if (!live()) return;
        void cacheRecords(records);
        setSaved(records);
      }),
    );
  });
}

/** What the sidebar needs about one analysis's saved runs. */
export interface RunOutcome {
  /** The newest run with results: what freshness is judged on. */
  result?: RunRecord;
  /** A newer run that produced no usable result (failed, partial or cancelled). */
  lastAttempt?: RunRecord;
}

/** The newest usable result of `id`, and any newer attempt that did not succeed. */
export function runOutcome(id: AnalysisId, records = resultIndex()): RunOutcome {
  const mine = [latest[id], ...records]
    .filter((r): r is RunRecord => !!r && r.analysis === id)
    .sort(newestFirst);
  const result = mine.find((r) => r.status === 'ok' && hasResults(r));
  const newer = mine.find(
    (r) => r !== result && ['failed', 'partial', 'cancelled'].includes(r.status),
  );
  const lastAttempt =
    newer && (!result || newer.created_utc > result.created_utc) ? newer : undefined;
  return { result, lastAttempt };
}

/** At least one saved run has results. */
export const hasSavedResults = () => resultIndex().some(hasResults);
