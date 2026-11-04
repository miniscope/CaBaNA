import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { capabilities } from '../../lib/bridge-status.ts';
import { countsText, type AnalysisCard } from '../../lib/results-hub.ts';
import {
  failureMessage,
  formatWhen,
  frameworkNote,
  goToAnalysis,
  hasResults,
  isInProgress,
  targetOf,
} from '../../lib/results-overview.ts';
import { openExplorer } from '../../lib/results-nav.ts';
import { active, type AnalysisId } from '../../lib/runs.ts';
import { RunBadges, type Match } from './RunBanner.tsx';
import { RerunButton, ResultActions } from './ResultActions.tsx';

/** Progress of the run in flight, only when the engine reports a fraction. */
function progressText(id: AnalysisId): string | undefined {
  const a = active();
  if (a?.id !== id) return undefined;
  const pct = a.fraction > 0 ? ` ${Math.round(a.fraction * 100)}%` : '';
  return `Running${pct}`;
}

function Card(props: {
  card: AnalysisCard;
  match?: Match;
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  const c = () => props.card;
  const note = () => c().latest && frameworkNote(c().latest!, capabilities()?._info?.commit);
  return (
    <li class="cb-hc" data-analysis={c().analysis}>
      <div class="cb-hc__head">
        <strong>{c().label}</strong>
        <Show when={c().latest}>
          <span class="cb-hc__status" role="status">
            {progressText(c().analysis) ?? c().status}
          </span>
        </Show>
      </div>
      <Show
        when={c().latest}
        fallback={
          <>
            <p class="cb-muted cb-hc__line">No result yet.</p>
            <div class="cb-hc__act">
              <button
                type="button"
                class="btn-secondary btn-small"
                onClick={() => goToAnalysis(c().analysis)}
              >
                Set up {c().label}
              </button>
            </div>
          </>
        }
      >
        {(rec) => (
          <>
            <p class="cb-hc__line">{countsText(c())}</p>
            <p class="cb-muted cb-hc__line">
              <Show when={hasResults(rec())} fallback="No results in the latest run.">
                Latest: {targetOf(rec())}, {formatWhen(c().latestWhen)}
              </Show>
            </p>
            <RunBadges
              record={rec()}
              match={props.match}
              saved={!props.match && hasResults(rec())}
            />
            <Show when={!hasResults(rec()) && !isInProgress(rec())}>
              <p class="cb-hc__fail" role="status">
                {rec().status === 'failed' ? failureMessage(rec()) : 'No results.'}
              </p>
            </Show>
            <Show when={c().newer}>
              {(n) => (
                <p class="cb-muted cb-hc__line">
                  {isInProgress(n()) ? 'A newer run is in progress.' : 'A newer run failed.'}
                </p>
              )}
            </Show>
            <Show when={note()}>
              <p class="cb-muted cb-hc__line">{note()}</p>
            </Show>
            <div class="cb-hc__act">
              <Show
                when={hasResults(rec())}
                fallback={isInProgress(rec()) ? undefined : <RerunButton record={rec()} />}
              >
                <button
                  type="button"
                  class="btn-primary btn-small"
                  onClick={() => openExplorer(c().analysis, rec().run_id)}
                >
                  Explore results
                </button>
              </Show>
              <button
                type="button"
                class="cb-link"
                onClick={() => goToAnalysis(c().analysis)}
                title="Go back to the setup of this analysis"
              >
                Edit analysis
              </button>
              <ResultActions record={rec()} onDeleted={props.onDeleted} />
            </div>
          </>
        )}
      </Show>
    </li>
  );
}

/**
 * Explore results: one card per analysis, counted from the saved records. The Plot editor
 * (preview) entry goes in `plotEditor`; the Hub shows nothing there until it is given.
 */
export function ResultsHub(props: {
  cards: AnalysisCard[];
  matchOf: (card: AnalysisCard) => Match | undefined;
  onDeleted: (r: RunRecord) => void;
  /** Slot for the "Plot editor (preview)" entry (built separately in `PlotEditor.tsx`). */
  plotEditor?: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-hub">
      <ul class="cb-hc__grid" aria-label="Analyses">
        <For each={props.cards}>
          {(card) => <Card card={card} match={props.matchOf(card)} onDeleted={props.onDeleted} />}
        </For>
      </ul>
      <div class="cb-hub__more">
        {/* PLOT EDITOR SLOT: the Plot editor (preview) entry is rendered here when `plotEditor` is passed. */}
        <Show when={props.plotEditor}>
          <section class="cb-hub__entry" aria-label="Plot editor (preview)">
            {props.plotEditor}
          </section>
        </Show>
        <section class="cb-hub__entry cb-hub__entry--off" aria-label="Compare analyses">
          <strong>Compare analyses</strong>
          <span class="cb-badge">Descriptive only, coming later</span>
          <p class="cb-muted">
            Comparison across sessions, animals and conditions is not available yet. Cells, sessions
            and animals will be kept at separate levels.
          </p>
          <button type="button" class="btn-secondary btn-small" disabled>
            Compare analyses
          </button>
        </section>
      </div>
    </div>
  );
}
