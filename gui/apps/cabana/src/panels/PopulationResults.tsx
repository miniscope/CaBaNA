import { createMemo, createResource, For, Match, Show, Switch, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { reconcile } from 'solid-js/store';
import { BridgeError } from '../lib/bridge-client.ts';
import { bridgeState } from '../lib/bridge-status.ts';
import { populationContext } from '../lib/analysis-registry.ts';
import {
  POPULATION_METHODS,
  populationSettings,
  readPopulationSettings,
  setPopulationSettings,
  type PopulationMethod,
} from '../lib/population-settings.ts';
import { POPULATION_RESULT } from '../lib/population-results.ts';
import { prep } from '../lib/preprocess.ts';
import { openedRun } from '../lib/results-nav.ts';
import { rejected } from '../lib/store.ts';
import { cachedRecords, runSource } from '../lib/results-store.ts';
import { compareToLatest, history, lastError, latest } from '../lib/runs.ts';
import { setOffLabels } from './population/data.ts';
import { Dimensionality } from './population/Dimensionality.tsx';
import { PairwiseCorr } from './population/PairwiseCorr.tsx';
import { PvSimilarity } from './population/PvSimilarity.tsx';
import { PvStability } from './population/PvStability.tsx';
import { StateSeparation } from './population/StateSeparation.tsx';
import { resultMethod, setResultMethod } from './population/view-store.ts';
import type { ViewProps } from './population/shared.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import { RunDetails } from './results/RunDetails.tsx';
import { RunBanner } from './results/RunBanner.tsx';
import { SavedRunBar } from './results/SavedRunBar.tsx';

const VIEWS: Record<PopulationMethod, (p: ViewProps) => JSX.Element> = {
  similarity: PvSimilarity,
  stability: PvStability,
  separation: StateSeparation,
  dimensionality: Dimensionality,
  pairwise: PairwiseCorr,
};
const NAV_LABEL: Record<PopulationMethod, string> = {
  similarity: 'Population vector similarity',
  stability: 'Population vector stability',
  separation: 'State separation',
  dimensionality: 'Dimensionality',
  pairwise: 'Pairwise correlations',
};

/** Copies the settings a saved run used into the setup; the labels follow. */
export function loadSavedSettings(saved: unknown): string | undefined {
  const s = readPopulationSettings((saved as { analysis?: unknown })?.analysis ?? saved);
  if ('error' in s) return s.error;
  setPopulationSettings(reconcile(s));
  setOffLabels(s.target, s.labels, populationContext().labels);
  return undefined;
}

/** Population results: one local entry per method that was run, one large figure at a time. */
export function PopulationResults(props: { onSetup: () => void }): JSX.Element {
  const offline = () => bridgeState().kind !== 'ready';
  // With the engine stopped, the records saved in this browser stand in for the project's.
  const [cached] = createResource(offline, async (off) =>
    off ? (await cachedRecords()).filter((r) => r.analysis === 'population') : [],
  );
  const newest = <T extends { created_utc: string }>(rs: T[]) =>
    [...rs].sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];
  const record = createMemo(() => {
    const open = openedRun('population');
    if (open) return [...history(), ...(cached() ?? [])].find((r) => r.run_id === open);
    return latest.population ?? (cached()?.length ? newest(cached()!) : undefined);
  });
  const isOlder = () => !!openedRun('population');
  const src = createMemo(() => (record() ? runSource(record()!.run_id) : undefined));
  // A run cancelled or failed before any analysis finished has no manifest: no results, not an error.
  const [manifest] = createResource(src, async (s) => {
    try {
      return await s.manifest();
    } catch (e) {
      if (e instanceof BridgeError && e.status === 404) return undefined;
      throw e;
    }
  });
  const [match] = createResource(
    // Re-checked whenever a setting that feeds the run changes.
    () =>
      !isOlder() && record()
        ? JSON.stringify([record()!.run_id, populationSettings, prep, [...rejected()]])
        : undefined,
    async () => compareToLatest('population'),
  );
  const available = createMemo(() =>
    POPULATION_METHODS.filter((m) =>
      manifest()?.results.some((r) => r.name === POPULATION_RESULT[m.id]),
    ),
  );
  const current = () =>
    available().some((m) => m.id === resultMethod()) ? resultMethod() : available()[0]?.id;
  const failedMessage = () =>
    record()
      ?.errors.map((e) => e.message)
      .join(' ') ||
    lastError()?.message ||
    'The run failed.';

  return (
    <div class="cb-pn-results">
      <Switch>
        <Match when={!record()}>
          <div class="cb-empty">
            No population analysis has been run yet.{' '}
            <button class="cb-link" onClick={props.onSetup}>
              Choose a target and methods
            </button>{' '}
            and run a quick preview or the full analysis.
          </div>
        </Match>
        <Match when={record()}>
          {(rec) => (
            <>
              <Show
                when={isOlder()}
                fallback={
                  <RunBanner record={rec()} match={match()} offline={src()?.offline()}>
                    <RunDetails record={rec()} />
                    <button class="btn-secondary" onClick={props.onSetup}>
                      Edit setup
                    </button>
                  </RunBanner>
                }
              >
                <SavedRunBar
                  analysis="population"
                  record={rec()}
                  onLoadSettings={() => {
                    const err = loadSavedSettings(rec().gui.settings);
                    if (!err) props.onSetup();
                  }}
                />
                <Show when={src()?.offline()}>
                  <span class="cb-badge">Viewing the saved copy</span>
                </Show>
              </Show>
              <Switch>
                <Match when={rec().status === 'failed'}>
                  <div class="cb-note" role="alert">
                    The run failed: {failedMessage()} <RunDetails record={rec()} />
                  </div>
                </Match>
                <Match when={manifest.error}>
                  <div class="cb-note" role="alert">
                    {(manifest.error as Error).message}
                    <Show when={offline()}>
                      <Unavailable engineOff />
                    </Show>
                  </div>
                </Match>
                <Match when={manifest.loading}>
                  <div class="cb-pn-msg">Loading the saved result</div>
                </Match>
                <Match when={available().length === 0}>
                  <div class="cb-note">
                    This run holds no population results
                    {rec().status === 'cancelled'
                      ? ' (it was cancelled before any analysis finished)'
                      : ''}
                    .
                  </div>
                </Match>
                <Match when={current()}>
                  <div class="cb-pn-resbody">
                    <nav class="cb-pn-nav" aria-label="Population analyses in this run">
                      <div class="cb-muted">Analyses in this run</div>
                      <For each={available()}>
                        {(m) => (
                          <button
                            type="button"
                            class="cb-pn-nav__item"
                            aria-current={current() === m.id}
                            classList={{ 'cb-pn-nav__item--on': current() === m.id }}
                            onClick={() => setResultMethod(m.id)}
                          >
                            {NAV_LABEL[m.id]}
                          </button>
                        )}
                      </For>
                      <Show when={rec().status === 'partial'}>
                        <p class="cb-muted">
                          Some analyses failed and are not listed. See Result details.
                        </p>
                      </Show>
                    </nav>
                    <div class="cb-pn-main">
                      <Show when={manifest()} keyed>
                        {(mf) => (
                          <Show when={current()} keyed>
                            {(method) => (
                              <Dynamic
                                component={VIEWS[method]}
                                src={src()!}
                                manifest={mf}
                                record={rec()}
                              />
                            )}
                          </Show>
                        )}
                      </Show>
                    </div>
                  </div>
                </Match>
              </Switch>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
