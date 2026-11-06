// The Run stage of the guided Population page: progress, errors and a summary of the last run.
import { Show, type JSX } from 'solid-js';
import { MetricCards } from '../../components/MetricCards.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { populationSettings as s } from '../../lib/population-settings.ts';
import { lastError, type Active } from '../../lib/runs.ts';
import { RunBadges, type Match } from '../results/RunBanner.tsx';
import { RunDetails } from '../results/RunDetails.tsx';
import { methodCount, stateTotal } from './SetupSummary.tsx';
import { setShowResults } from './view-store.ts';

export function RunStage(props: {
  running?: Active;
  failed?: RunRecord;
  last?: RunRecord;
  match?: Match;
}): JSX.Element {
  const running = () => props.running;
  const failed = () => props.failed;
  const last = () => props.last;
  const match = () => props.match;
  return (
    <div class="cb-gs-run">
      <Show when={running()}>
        {(r) => (
          <div>
            <p>
              {r().shuffles
                ? `Shuffles ${r().shuffles![0]} of ${r().shuffles![1]}`
                : r().message || 'Running…'}
              {r().phase === 'cancelling' ? ' · cancelling' : ''}
            </p>
            <Show when={r().fraction > 0 || r().shuffles}>
              <progress class="cb-progress" value={r().fraction} max={1} />
            </Show>
            <p class="cb-muted">
              {methodCount()} methods · {stateTotal()} states · {r().shuffles?.[1] ?? s.shuffles}{' '}
              shuffles. Results open when the run finishes.
            </p>
          </div>
        )}
      </Show>
      <Show when={!running() && lastError()?.id === 'population'}>
        <div class="cb-note" role="alert">
          {lastError()!.message}
        </div>
      </Show>
      <Show when={!running() && failed()}>
        <div class="cb-note" role="alert">
          Last run failed. <RunDetails record={failed()!} />
        </div>
      </Show>
      <Show
        when={!running() && last() && last()!.status !== 'failed' && last()}
        fallback={
          <Show when={!running() && !last()}>
            <p class="cb-muted">
              No run yet. Choose Quick preview or the full analysis in Review and preview.
            </p>
          </Show>
        }
      >
        {(rec) => (
          <>
            <h3>
              Last run <RunBadges record={rec()} match={match()} />
            </h3>
            <MetricCards
              label="Last run"
              cards={[
                {
                  label: 'Analyses completed',
                  value: String(rec().result_names?.length ?? 0),
                  denom: `of ${methodCount()} selected in the current setup`,
                  tone: 'blue',
                },
                {
                  label: 'Time bin',
                  value: `${s.binS} s`,
                  tone: 'gray',
                  denom: 'current setup',
                },
                {
                  label: 'Shuffles',
                  value: s.shuffles.toLocaleString(),
                  tone: 'gray',
                  denom:
                    rec().scope === 'preview'
                      ? 'full run; the preview used fewer'
                      : 'current setup',
                },
              ]}
            />
            <Show when={match() && !match()!.matches}>
              <div class="cb-note">
                Earlier settings: since this run, {match()!.diff.join(', ')} changed. Run again to
                update the results.
              </div>
            </Show>
            <div class="cb-controls">
              <button class="btn-primary" onClick={() => setShowResults(true)}>
                Open results
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
