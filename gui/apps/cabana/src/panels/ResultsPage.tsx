import { createEffect, createSignal, onMount, onCleanup, Show, type JSX } from 'solid-js';
import { bridgeReady } from '../lib/bridge-status.ts';
import { forgetBrowserRecord } from '../lib/browser-records.ts';
import { resultIndex, runOutcome } from '../lib/result-index.ts';
import { matchOfRecord, type Match } from '../lib/results-match.ts';
import { explorerTarget, openedRun, openRunOf } from '../lib/results-nav.ts';
import { ANALYSIS_IDS, hasResults } from '../lib/results-overview.ts';
import { prefetchRun } from '../lib/results-store.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import type { AnalysisId } from '../lib/runs.ts';
import { fitToWindow } from './QcPanel.tsx';
import { ExplorerFrame, FRAMED } from './results/ExplorerFrame.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import { ResultsExplorer } from './results/ResultsExplorer.tsx';
import { ResultsTable } from './results/ResultsTable.tsx';

/**
 * Results: the overview table (one row per analysis) and, once a row or a run is opened, that
 * analysis's explorer. Opening a result never changes the current settings.
 */
export function ResultsPage(): JSX.Element {
  let root!: HTMLDivElement;
  const [matches, setMatches] = createSignal<
    Partial<Record<AnalysisId, { runId: string; match?: Match }>>
  >({});
  const [notice, setNotice] = createSignal('');

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

  const afterDelete = (r: RunRecord) => {
    const id = r.analysis as AnalysisId;
    if (openedRun(id) === r.run_id) openRunOf(id, undefined);
    void forgetBrowserRecord(r.run_id);
  };

  return (
    <div class="cb-place cb-res" ref={root}>
      <Show when={!bridgeReady()}>
        <p class="cb-res__off" role="status">
          Python engine not running. Showing saved results.
        </p>
        <Unavailable engineOff />
      </Show>
      <Show when={notice()}>
        <p class="cb-res__off" role="alert">
          {notice()}{' '}
          <button type="button" class="cb-link" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      </Show>
      <Show
        when={explorerTarget()}
        fallback={
          <ResultsTable
            records={records()}
            matchOf={matchOf}
            onDeleted={afterDelete}
            onError={setNotice}
          />
        }
      >
        {(target) => (
          <Show
            when={FRAMED.includes(target().analysis)}
            fallback={<ResultsExplorer target={target()} records={records()} />}
          >
            <ExplorerFrame
              target={target()}
              records={records()}
              onDeleted={afterDelete}
              onError={setNotice}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}
