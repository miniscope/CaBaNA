import { createEffect, createSignal, on, onMount, onCleanup, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../lib/bridge-client.ts';
import { bridgeReady } from '../lib/bridge-status.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import {
  ANALYSIS_IDS,
  hasResults,
  listedRecords,
  overviewRows,
  type OverviewRow,
} from '../lib/results-overview.ts';
import { cachedRecords, cacheRecords, prefetchRun } from '../lib/results-store.ts';
import { compareToLatest, history, latest, refreshHistory, type AnalysisId } from '../lib/runs.ts';
import { goToAnalysis } from '../lib/results-overview.ts';
import { ANALYSES } from '../lib/analyses.ts';
import { InfoTip } from './InfoTip.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { AnalysisHistory } from './results/AnalysisHistory.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import type { Match } from './results/RunBanner.tsx';
import { ResultsOverview } from './results/ResultsOverview.tsx';

type Tab = 'latest' | 'history';

/** Results: the latest saved result of each analysis, and earlier executions under history. */
export function ResultsPage(): JSX.Element {
  let root!: HTMLDivElement;
  const [tab, setTab] = createSignal<Tab>('latest');
  const [saved, setSaved] = createSignal<RunRecord[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [matches, setMatches] = createSignal<Partial<Record<AnalysisId, Match>>>({});

  onMount(() => {
    onCleanup(fitToWindow(root));
    void cachedRecords().then(setSaved);
  });

  // The engine answers: refresh the list. Each refreshed list is also kept for when it stops.
  createEffect(() => {
    if (bridgeReady())
      void refreshHistory().then(
        () => setLoaded(true),
        () => setLoaded(false),
      );
    else setLoaded(false);
  });
  createEffect(
    on([history, loaded], ([records, ready]) => {
      if (!ready || !bridgeReady()) return;
      void cacheRecords(records);
      for (const r of records)
        if (r.engine === 'framework' && hasResults(r) && r.record_version <= 1)
          void prefetchRun(r.run_id);
      setSaved(records);
    }),
  );

  const records = () => listedRecords(bridgeReady() && loaded(), history(), saved());
  const rows = () => overviewRows(records());

  // Whether the settings now match each analysis's latest run (compared in the page's own effect).
  let seq = 0;
  createEffect(() => {
    if (!bridgeReady() || !loaded()) return setMatches({});
    const mine = ++seq;
    void Promise.all(ANALYSIS_IDS.map((id) => compareToLatest(id).catch(() => undefined))).then(
      (found) => {
        if (mine === seq)
          setMatches(
            Object.fromEntries(ANALYSIS_IDS.flatMap((id, i) => (found[i] ? [[id, found[i]]] : []))),
          );
      },
    );
  });
  // Only the run the comparison was made against shows match information.
  const matchOf = (row: OverviewRow): Match | undefined =>
    row.record && latest[row.analysis]?.run_id === row.record.run_id
      ? matches()[row.analysis]
      : undefined;

  const afterDelete = (r: RunRecord) => {
    const id = r.analysis as AnalysisId;
    if (openedRun(id) === r.run_id) openRunOf(id, undefined);
    setSaved(saved().filter((s) => s.run_id !== r.run_id));
  };

  const empty = () => records().length === 0;
  return (
    <div class="cb-place cb-res" ref={root}>
      <div class="cb-place-head">
        <div class="cb-res__title">
          <h2>Results</h2>
          <InfoTip label="About saved results">
            <p>
              Each analysis shows its latest saved result. Opening a result never changes the
              current settings.
            </p>
            <p>
              Preliminary means the null used 50 shuffles. Settings changed means the setup differs
              from the one the result was made with. They are independent.
            </p>
          </InfoTip>
        </div>
        <div class="cb-seg" role="tablist" aria-label="Results views">
          <button
            type="button"
            role="tab"
            aria-selected={tab() === 'latest'}
            classList={{ 'cb-seg__on': tab() === 'latest' }}
            onClick={() => setTab('latest')}
          >
            Latest results
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab() === 'history'}
            classList={{ 'cb-seg__on': tab() === 'history' }}
            onClick={() => setTab('history')}
          >
            Analysis history
          </button>
        </div>
      </div>
      <Show when={!bridgeReady()}>
        <p class="cb-res__off" role="status">
          Python engine not running. Showing saved results.
        </p>
        <Unavailable engineOff />
      </Show>
      <Show when={tab() === 'latest'}>
        <Show when={empty()}>
          <p class="cb-res__empty" role="status">
            No results yet. Set up and run an analysis.{' '}
            {ANALYSES.map((a) => (
              <button type="button" class="cb-link cb-res__lnk" onClick={() => goToAnalysis(a.id)}>
                {a.label}
              </button>
            ))}
          </p>
        </Show>
        <ResultsOverview rows={rows()} matchOf={matchOf} onDeleted={afterDelete} />
      </Show>
      <Show when={tab() === 'history'}>
        <AnalysisHistory records={records()} onDeleted={afterDelete} />
      </Show>
    </div>
  );
}
