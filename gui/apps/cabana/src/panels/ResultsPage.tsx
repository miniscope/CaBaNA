import { createEffect, createSignal, onMount, onCleanup, Show, type JSX } from 'solid-js';
import { PlotEditorEntry } from './results/PlotEditor.tsx';
import type { RunRecord } from '../lib/bridge-client.ts';
import { bridgeReady } from '../lib/bridge-status.ts';
import { explorerTarget, openedRun, openRunOf } from '../lib/results-nav.ts';
import { ANALYSIS_IDS, hasResults } from '../lib/results-overview.ts';
import { analysisCards, type AnalysisCard } from '../lib/results-hub.ts';
import { prefetchRun } from '../lib/results-store.ts';
import { compareToRecord, type AnalysisId } from '../lib/runs.ts';
import { resultIndex, runOutcome } from '../lib/result-index.ts';
import { forgetBrowserRecord } from '../lib/browser-records.ts';
import { goToAnalysis } from '../lib/results-overview.ts';
import { ANALYSES } from '../lib/analyses.ts';
import { InfoTip } from './InfoTip.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { AnalysisHistory } from './results/AnalysisHistory.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import type { Match } from './results/RunBanner.tsx';
import { ResultsHub } from './results/ResultsHub.tsx';
import { ResultsExplorer } from './results/ResultsExplorer.tsx';
import { PREVIEW_TEXT } from '../lib/preview.ts';

type Tab = 'explore' | 'history';

/**
 * Results: the Hub (a card per analysis, and the history of every run) and, once a card or a run
 * is opened, that analysis's Explorer. `plotEditor` fills the Hub's Plot editor (preview) entry.
 */
export function ResultsPage(props: { plotEditor?: JSX.Element } = {}): JSX.Element {
  let root!: HTMLDivElement;
  const [tab, setTab] = createSignal<Tab>('explore');
  const [matches, setMatches] = createSignal<Partial<Record<AnalysisId, Match>>>({});

  onMount(() => onCleanup(fitToWindow(root)));

  // One list for this page, its history and the sidebar (`result-index.ts`).
  const records = resultIndex;
  const cards = () => analysisCards(records());
  // Keep finished framework results readable after the engine stops.
  createEffect(() => {
    if (!bridgeReady()) return;
    for (const r of records())
      if (r.engine === 'framework' && hasResults(r) && r.record_version <= 1)
        void prefetchRun(r.run_id);
  });

  // Whether the settings now match each analysis's newest framework result.
  let seq = 0;
  createEffect(() => {
    if (!bridgeReady()) return setMatches({});
    const mine = ++seq;
    const newest = ANALYSIS_IDS.map((id) => runOutcome(id).result);
    void Promise.all(
      ANALYSIS_IDS.map((id, i) =>
        newest[i]?.engine === 'framework'
          ? compareToRecord(id, newest[i]!).catch(() => undefined)
          : undefined,
      ),
    ).then((found) => {
      if (mine === seq)
        setMatches(
          Object.fromEntries(ANALYSIS_IDS.flatMap((id, i) => (found[i] ? [[id, found[i]]] : []))),
        );
    });
  });
  // Only the run the comparison was made against shows match information.
  const matchOf = (card: AnalysisCard): Match | undefined =>
    card.latest && runOutcome(card.analysis).result?.run_id === card.latest.run_id
      ? matches()[card.analysis]
      : undefined;

  const afterDelete = (r: RunRecord) => {
    const id = r.analysis as AnalysisId;
    if (openedRun(id) === r.run_id) openRunOf(id, undefined);
    void forgetBrowserRecord(r.run_id);
  };

  const empty = () => records().length === 0;
  return (
    <div class="cb-place cb-res" ref={root}>
      <Show when={!bridgeReady()}>
        <p class="cb-res__off" role="status">
          Python engine not running. Showing saved results.
        </p>
        <Unavailable engineOff />
      </Show>
      <Show
        when={explorerTarget()}
        fallback={
          <>
            <div class="cb-place-head">
              <div class="cb-res__title">
                <h2>Results</h2>
                <InfoTip label="About saved results">
                  <p>
                    Each card counts the saved runs of one analysis and opens its latest result in
                    the Explorer. Opening a result never changes the current settings.
                  </p>
                  <p>
                    Preliminary means a Quick preview: {PREVIEW_TEXT}. Each result shows the count
                    it ran. Settings changed means the setup differs from the one the result was
                    made with. They are independent.
                  </p>
                </InfoTip>
              </div>
              <div class="cb-seg" role="tablist" aria-label="Results views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'explore'}
                  classList={{ 'cb-seg__on': tab() === 'explore' }}
                  onClick={() => setTab('explore')}
                >
                  Explore results
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
            <Show when={tab() === 'explore'}>
              <Show when={empty()}>
                <p class="cb-res__empty" role="status">
                  No results yet. Set up and run an analysis.{' '}
                  {ANALYSES.map((a) => (
                    <button
                      type="button"
                      class="cb-link cb-res__lnk"
                      onClick={() => goToAnalysis(a.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </p>
              </Show>
              <ResultsHub
                cards={cards()}
                matchOf={matchOf}
                onDeleted={afterDelete}
                plotEditor={props.plotEditor ?? <PlotEditorEntry />}
              />
            </Show>
            <Show when={tab() === 'history'}>
              <AnalysisHistory records={records()} onDeleted={afterDelete} />
            </Show>
          </>
        }
      >
        {(target) => <ResultsExplorer target={target()} records={records()} />}
      </Show>
    </div>
  );
}
