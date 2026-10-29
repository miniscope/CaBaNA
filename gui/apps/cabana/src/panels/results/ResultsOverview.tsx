import { For, Show, type JSX } from 'solid-js';
import { ANALYSES } from '../../lib/analyses.ts';
import { active, type AnalysisId } from '../../lib/runs.ts';
import {
  failureMessage,
  formatWhen,
  frameworkNote,
  goToAnalysis,
  hasResults,
  isInProgress,
  targetOf,
  type OverviewRow,
} from '../../lib/results-overview.ts';
import { capabilities } from '../../lib/bridge-status.ts';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { RunBadges, type Match } from './RunBanner.tsx';
import { OpenResult, RerunButton, ResultActions } from './ResultActions.tsx';

const labelOf = (id: AnalysisId) => ANALYSES.find((a) => a.id === id)!.label;

/** Progress of the run in flight, only when the engine reports a fraction. */
function progressText(id: AnalysisId): string | undefined {
  const a = active();
  if (a?.id !== id) return undefined;
  const pct = a.fraction > 0 ? ` ${Math.round(a.fraction * 100)}%` : '';
  return `Running${pct}`;
}

function Row(props: {
  row: OverviewRow;
  match?: Match;
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  const id = () => props.row.analysis;
  const note = () =>
    props.row.record && frameworkNote(props.row.record, capabilities()?._info?.commit);
  return (
    <li class="cb-ov__row" data-analysis={id()}>
      <strong class="cb-ov__name">{labelOf(id())}</strong>
      <Show
        when={props.row.record}
        fallback={
          <>
            <span class="cb-muted cb-ov__none">No result yet.</span>
            <button type="button" class="cb-link cb-ov__go" onClick={() => goToAnalysis(id())}>
              Set up {labelOf(id())}
            </button>
          </>
        }
      >
        {(rec) => (
          <>
            <span class="cb-ov__target">
              <span>{hasResults(rec()) ? targetOf(rec()) : ''}</span>
              <Show when={!hasResults(rec()) && !isInProgress(rec())}>
                <span class="cb-ov__fail" role="status">
                  {rec().status === 'failed' ? failureMessage(rec()) : 'No results.'}
                </span>
              </Show>
              <Show when={progressText(id()) ?? (isInProgress(rec()) ? 'Running' : undefined)}>
                {(t) => <span class="cb-muted">{t()}</span>}
              </Show>
              <Show when={props.row.newer}>
                {(n) => (
                  <span class="cb-muted">
                    {isInProgress(n()) ? 'A newer run is in progress.' : 'A newer run failed.'}
                  </span>
                )}
              </Show>
            </span>
            <span class="cb-muted cb-ov__date">{formatWhen(rec().created_utc)}</span>
            <span class="cb-ov__state">
              <RunBadges
                record={rec()}
                match={props.match}
                saved={!props.match && hasResults(rec())}
              />
              <Show when={note()}>
                <span class="cb-muted">{note()}</span>
              </Show>
            </span>
            <span class="cb-ov__act">
              <Show
                when={hasResults(rec()) || isInProgress(rec())}
                fallback={<RerunButton record={rec()} />}
              >
                <OpenResult record={rec()} />
              </Show>
              <ResultActions record={rec()} onDeleted={props.onDeleted} />
            </span>
          </>
        )}
      </Show>
    </li>
  );
}

/** The latest saved result of each analysis. */
export function ResultsOverview(props: {
  rows: OverviewRow[];
  matchOf: (row: OverviewRow) => Match | undefined;
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  return (
    <ul class="cb-ov" aria-label="Latest result of each analysis">
      <For each={props.rows}>
        {(row) => <Row row={row} match={props.matchOf(row)} onDeleted={props.onDeleted} />}
      </For>
    </ul>
  );
}
