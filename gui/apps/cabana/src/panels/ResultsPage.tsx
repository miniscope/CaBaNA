import { createEffect, createSignal, onMount, onCleanup, Show, type JSX } from 'solid-js';
import { bridgeReady } from '../lib/bridge-status.ts';
import { resultIndex, runOutcome } from '../lib/result-index.ts';
import { matchOfRecord, type Match } from '../lib/results-match.ts';
import { ANALYSIS_IDS, hasResults } from '../lib/results-overview.ts';
import { prefetchRun } from '../lib/results-store.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import type { AnalysisId } from '../lib/runs.ts';
import { fitToWindow } from './QcPanel.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import { ResultsTable } from './results/ResultsTable.tsx';

/**
 * Results: the overview table, one row per analysis. View results opens the Results window
 * (mounted once for the app). Opening a result never changes the current settings.
 */
export function ResultsPage(): JSX.Element {
  let root!: HTMLDivElement;
  const [matches, setMatches] = createSignal<
    Partial<Record<AnalysisId, { runId: string; match?: Match }>>
  >({});

  onMount(() => onCleanup(fitToWindow(root)));

  // One list for this page and the sidebar (`result-index.ts`).
  const records = resultIndex;
  // Keep finished framework results readable after the engine stops.
  createEffect(() => {
    if (!bridgeReady()) return;
    for (const r of records())
      if (r.engine === 'framework' && hasResults(r) && r.record_version <= 1)
        void prefetchRun(r.run_id);
  });

  // Whether the settings and inputs now match each analysis's newest result.
  let seq = 0;
  createEffect(() => {
    const mine = ++seq;
    const newest = ANALYSIS_IDS.map((id) => runOutcome(id).result);
    void Promise.all(
      newest.map((r) => (r ? matchOfRecord(r, true).catch(() => undefined) : undefined)),
    ).then((found) => {
      if (mine !== seq) return;
      setMatches(
        Object.fromEntries(
          ANALYSIS_IDS.flatMap((id, i) =>
            newest[i] ? [[id, { runId: newest[i]!.run_id, match: found[i] }]] : [],
          ),
        ),
      );
    });
  });
  // Only the newest result of an analysis is compared.
  const matchOf = (r: RunRecord): Match | undefined => {
    const m = matches()[r.analysis as AnalysisId];
    return m?.runId === r.run_id ? m.match : undefined;
  };

  return (
    <div class="cb-place cb-res" ref={root}>
      <Show when={!bridgeReady()}>
        <p class="cb-res__off" role="status">
          Python engine not running. Showing saved results.
        </p>
        <Unavailable engineOff />
      </Show>
      <ResultsTable records={records()} matchOf={matchOf} />
    </div>
  );
}
