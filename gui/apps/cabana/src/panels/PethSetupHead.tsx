// The PETH setup page's header and its Run stage.
import { For, Show, type JSX } from 'solid-js';
import { HowItWorks } from '../components/GuidedReview.tsx';
import { MetricCards } from '../components/MetricCards.tsx';
import { pethOutcome, pethStatus, setPethShowResults } from '../lib/peth-run.ts';
import { alignsRun, inputSignalText, pethCards } from '../lib/peth-setup.ts';
import { prep } from '../lib/preprocess.ts';
import { openData } from '../lib/data-setup-view.ts';
import { goToStep } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import type { PethSetupState } from './PethSetupState.ts';
import { PopButton } from './QcParts.tsx';
import { RunProgress } from './results/EngineNotice.tsx';
/** What PETH does, for the How it works button. */
function PethMethodText(): JSX.Element {
  return (
    <>
      <p>
        <strong>Align:</strong> Each bout of a behavior gives one aligned frame, its first frame
        (onset) or the first frame after it (offset). Bouts that are too short, too close to the
        neighboring bout, or too near the recording edge are left out.
      </p>
      <p>
        <strong>Average:</strong> The deconvolved events of each cell are cut out around every
        included bout and averaged, giving a mean curve over the window.
      </p>
      <p>
        <strong>Test:</strong> The response is the mean in the response interval minus the mean in
        the baseline interval, averaged over bouts. It is compared with the same value after
        circular shifts of the cell's trace, which keep the cell's own rhythm but break its link to
        the bouts. A cell is higher or lower when the p-value is below α. Max-stat correction
        accounts for the number of behaviors tested within each cell, not for the number of cells.
      </p>
      <p>
        <strong>Descriptive only:</strong> The null band, latency and Wilcoxon p-value do not change
        which cells are labeled.
      </p>
    </>
  );
}

/** Title, data summary and the View results button. */
export function PethHead(props: { s: PethSetupState; changes: string[] }): JSX.Element {
  const ok = () => props.s.ok();
  const changes = () => props.changes;
  return (
    <div class="cb-place-head">
      <div>
        <h2>
          PETH analysis
          <InfoTip label="About the PETH analysis">
            <p>
              Peri-event time histograms: the time course of each cell's neural data around the
              onsets or offsets of annotated behavior bouts.
            </p>
          </InfoTip>
          <HowItWorks title="How the PETH analysis works">
            <div class="cb-muted">
              <PethMethodText />
            </div>
          </HowItWorks>
        </h2>
        <p class="cb-muted">
          {inputSignalText(prep.eventSigmaS)} (
          <button class="cb-link" onClick={() => openData('neural_deconvolved', 'prep')}>
            Deconvolved events → Preprocess
          </button>
          )
        </p>
      </div>
      <Show when={ok()}>
        <div class="cb-place-head__side">
          <span>
            {ok()!.cells} cells · {ok()!.labels.length} behaviors · {+ok()!.fs.toFixed(2)} Hz
          </span>
          <Show when={ok()!.cellsMissing.length}>
            <PopButton
              label="Cells that cannot be evaluated"
              title="Cells that cannot be evaluated"
              width={380}
              class="cb-link"
              button={`${ok()!.cellsMissing.length} of ${ok()!.cells} cells cannot be evaluated`}
            >
              <p>
                These cells have a non-finite neural value somewhere in the session, so the response
                is undefined for every behavior. They are kept in the results as Not evaluated and
                are left out of the counts of evaluated cells.
              </p>
              <p>
                Cells:{' '}
                {ok()!
                  .cellsMissing.map((c) => ok()!.cellIds[c] + 1)
                  .join(', ')}
              </p>
            </PopButton>
          </Show>
        </div>
      </Show>
      <div class="cb-controls">
        <Show when={pethOutcome()}>
          <button class="btn-secondary" onClick={() => setPethShowResults(true)}>
            {changes().length ? 'View previous results' : 'View results'}
          </button>
        </Show>
      </div>
    </div>
  );
}

/** Run stage: progress while running, then what the last run found, per alignment, and a link to its results. */
export function PethRunStage(props: {
  s: PethSetupState;
  running?: Extract<ReturnType<typeof pethStatus>, { kind: 'running' }>;
  error?: string;
  changes: string[];
}): JSX.Element {
  return (
    <div class="cb-gs-run">
      <Show when={props.running}>
        {(r) => (
          <div>
            <p>{r().step}…</p>
            <RunProgress done={r().done} total={r().total} />
          </div>
        )}
      </Show>
      <Show when={!props.running && !props.error && !pethOutcome()}>
        <p class="cb-muted">No run yet. Choose Run full analysis in Review and preview.</p>
      </Show>
      <Show when={!props.running && pethOutcome()}>
        <h3>Last run</h3>
        <For each={alignsRun(pethOutcome()!)}>
          {(a) => {
            const both = () => alignsRun(pethOutcome()!).length > 1;
            return (
              <>
                <Show when={both()}>
                  <h4>Aligned to bout {a}</h4>
                </Show>
                <MetricCards
                  label={both() ? `Last run, ${a}` : 'Last run'}
                  cards={pethCards(pethOutcome()!, both() ? a : undefined)}
                />
              </>
            );
          }}
        </For>
        <Show when={props.changes.length}>
          <div class="cb-note">
            Earlier settings: since this run, {props.changes.join(', ')} changed. Run again to
            update the results.
          </div>
        </Show>
        <div class="cb-controls">
          <button class="btn-primary" onClick={() => setPethShowResults(true)}>
            Open results
          </button>
          <button class="cb-link" onClick={() => goToStep('results')}>
            All results
          </button>
        </div>
      </Show>
    </div>
  );
}
