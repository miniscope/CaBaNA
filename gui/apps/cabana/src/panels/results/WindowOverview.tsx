// The Overview of the Results window: the key finding, the main figure small, and the right panel
// (Summary, Run information) that stays beside the other views.

import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { summarySentences } from '../../lib/results-explorer.ts';
import { keyFinding } from '../../lib/results-window.ts';
import { InfoTip } from '../InfoTip.tsx';
import type { PlotChoice } from './plot-choice.ts';

/** The key finding: the result in one line, what it was tested against, and up to three saved numbers. */
function KeyFindingCard(props: {
  record: RunRecord;
  data?: ExplorerData;
  headline?: string;
}): JSX.Element {
  const k = () => keyFinding(props.record, props.data, props.headline);
  return (
    <section class="cb-rx__card cb-wo__key" aria-label="Key finding">
      <div class="sc">key finding</div>
      <h3 class="cb-wo__headline">{k().headline}</h3>
      <Show when={k().sentence}>
        <p class="cb-muted">{k().sentence}</p>
      </Show>
      <Show when={k().numbers.length}>
        <div class="cb-wo__nums">
          <For each={k().numbers}>
            {(n) => (
              <div>
                <b>{n.value}</b>
                <span class="cb-muted">{n.label}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

export function OverviewPane(props: {
  record: RunRecord;
  data?: ExplorerData;
  headline?: string;
  main?: PlotChoice;
  onOpenPlots: () => void;
}): JSX.Element {
  const view = () => props.main?.view;
  return (
    <div class="cb-wo">
      <KeyFindingCard record={props.record} data={props.data} headline={props.headline} />
      <Show when={view()}>
        {(v) => (
          <section class="cb-rx__card cb-wo__fig" aria-label="Main figure">
            <div class="cb-rx__head">
              <h3>{v().label}</h3>
              <Show when={v().help}>{(h) => h()()}</Show>
              <span class="cb-spacer" />
              <button type="button" class="cb-link" onClick={props.onOpenPlots}>
                Open in Visualizations ›
              </button>
            </div>
            <Show when={v().subtitle}>{(s) => <p class="cb-muted cb-rx__sub">{s()()}</p>}</Show>
            <div class="cb-wo__figbody">{(v().overview ?? v().main)()}</div>
          </section>
        )}
      </Show>
    </div>
  );
}

/** The Summary card: the analysis's own counts, or the saved numbers as sentences. */
export function SummaryCard(props: {
  record: RunRecord;
  data?: ExplorerData;
  summary?: () => JSX.Element;
}): JSX.Element {
  return (
    <aside class="cb-rx__card cb-rx__summary cb-wsum" aria-label="Summary">
      <div class="cb-rx__head">
        <h3>Summary</h3>
        <InfoTip label="About the summary">
          <p>
            Counts and cells are read from the saved result, with the correction and alpha the run
            used. They are not recomputed here.
          </p>
        </InfoTip>
      </div>
      <div class="cb-wsum__body">
        <Show
          when={props.summary}
          fallback={
            <Show when={props.data} fallback={<p class="cb-muted">Reading the saved run.</p>}>
              {(d) => (
                <For each={summarySentences({ record: props.record, ...d().summary })}>
                  {(line) => <p class="cb-rx__p">{line}</p>}
                </For>
              )}
            </Show>
          }
        >
          {(s) => s()()}
        </Show>
      </div>
    </aside>
  );
}
