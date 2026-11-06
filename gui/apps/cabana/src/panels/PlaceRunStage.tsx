// The Run stage of the Place cells page: progress while running, then what the last run found.

import { Show, type JSX } from 'solid-js';
import { MetricCards } from '../components/MetricCards.tsx';
import { placeOutcome, placeStatus, progressText, setPlaceShowResults } from '../lib/place-run.ts';
import { placeChanges } from '../lib/place-ui.ts';
import { preliminaryText } from '../lib/preview.ts';
import { buildRows, countOutcomes } from '../lib/place-table.ts';
import { goToStep } from '../lib/store.ts';
import { RunProgress } from './results/EngineNotice.tsx';

/** Run stage: progress while running, then what the last run found and a link to its results. */
export function PlaceRunStage(props: {
  running?: Extract<ReturnType<typeof placeStatus>, { kind: 'running' }>;
  error?: string;
}): JSX.Element {
  const counts = () => {
    const o = placeOutcome();
    return o ? countOutcomes(buildRows(o)) : undefined;
  };
  const total = () => placeOutcome()?.data.cellIds.length ?? 0;
  return (
    <div class="cb-gs-run">
      <Show when={props.running}>
        {(r) => (
          <div>
            <p>
              {r().step}
              {progressText(r()) ? ` (${progressText(r())})` : '…'}
            </p>
            <RunProgress done={r().done} total={r().total} />
          </div>
        )}
      </Show>
      <Show when={props.error}>
        <div class="cb-note">{props.error}</div>
      </Show>
      <Show
        when={!props.running && placeOutcome()}
        fallback={
          <Show when={!props.running && !props.error}>
            <p class="cb-muted">
              No run yet. Choose Quick preview or the full analysis in Review and preview.
            </p>
          </Show>
        }
      >
        {(o) => (
          <>
            <h3>
              Last run
              <Show when={o().record?.scope === 'preview'}>
                <span class="cb-badge cb-badge--warn">{preliminaryText(o().record!)}</span>
              </Show>
            </h3>
            <MetricCards
              label="Last run"
              cards={[
                {
                  label: 'Place cells (both tests)',
                  value: String(counts()!.both),
                  denom: `of ${total()} cells analyzed`,
                  tone: 'blue',
                },
                {
                  label: 'One test only',
                  value: String(counts()!.info + counts()!.stab),
                  denom: `of ${total()} cells analyzed`,
                },
                {
                  label: 'Neither test',
                  value: String(counts()!.neither),
                  denom: `of ${total()} cells analyzed`,
                  tone: 'gray',
                },
                {
                  label: 'Not evaluated',
                  value: String(counts()!.cannot),
                  denom: `of ${total()} cells analyzed; not a failed test`,
                  tone: 'gray',
                },
              ]}
            />
            <Show when={placeChanges().length}>
              <div class="cb-note">
                Earlier settings: since this run, {placeChanges().join(', ')} changed. Run again to
                update the results.
              </div>
            </Show>
            <div class="cb-controls">
              <button class="btn-primary" onClick={() => setPlaceShowResults(true)}>
                Open results
              </button>
              <button class="cb-link" onClick={() => goToStep('results')}>
                All results
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
