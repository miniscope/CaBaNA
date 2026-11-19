// Explorer parts for Decoding and Population: the existing result views, read from the run's saved
// arrays, as the main plot.

import { createResource, For, onCleanup, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { hasCapability } from '../../lib/bridge-status.ts';
import { loadBehaviorDecoding, loadPositionDecoding } from '../../lib/decoding-results.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import type { FrameworkExtra } from '../../lib/results-framework.ts';
import { plotsOf, summarySentences } from '../../lib/results-explorer.ts';
import { clearPlotRequest, requestPlot } from '../../lib/results-nav.ts';
import { POPULATION_RESULT } from '../../lib/population-results.ts';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import { analysisDetails } from '../decoding/review.ts';
import { BehaviorResults, PositionResults } from '../DecodingResults.tsx';
import { NAV_LABEL, VIEWS } from '../PopulationResults.tsx';
import type { ExplorerParts } from './explorer-parts.ts';

const summary = (r: RunRecord, data: ExplorerData) => () => (
  <For each={summarySentences({ record: r, ...data.summary })}>
    {(line) => <p class="cb-rx__p">{line}</p>}
  </For>
);

/** The decoding results, opened on one of their views (position or behavior). */
function DecodingMain(props: {
  record: RunRecord;
  extra: FrameworkExtra;
  view: string;
}): JSX.Element {
  // The views read this request when they mount; one this run does not have is dropped on leaving.
  // eslint-disable-next-line solid/reactivity
  requestPlot('decoding', props.view);
  onCleanup(clearPlotRequest);
  const [loaded] = createResource(async () => {
    const has = hasCapability('decoding_overall_test');
    const { src, manifest } = props.extra;
    const pos = await loadPositionDecoding(src, manifest, has);
    const beh = await loadBehaviorDecoding(src, manifest, has);
    return { pos, beh };
  });
  const config = () => {
    const saved = (props.record.gui.settings as { analysis?: Record<string, unknown> })?.analysis;
    return saved ? analysisDetails(saved, 'framework').map(([k, v]) => `${k}: ${v}`) : [];
  };
  return (
    <div class="cb-dec-results cb-rx__embed">
      <Show when={loaded.error}>
        <p class="cb-ex__warn" role="alert">
          The results could not be read: {String((loaded.error as Error)?.message)}
        </p>
      </Show>
      <Show when={loaded()}>
        {(d) => (
          <>
            <Show when={d().pos}>
              {(v) => (
                <PositionResults
                  v={v()}
                  config={config()}
                  record={props.record}
                  manifest={props.extra.manifest}
                />
              )}
            </Show>
            <Show when={d().beh}>
              {(v) => <BehaviorResults v={v()} config={config()} record={props.record} />}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

export function decodingParts(
  record: RunRecord,
  extra: FrameworkExtra,
  data: ExplorerData,
): ExplorerParts {
  const logistic =
    (record.gui.settings as { analysis?: { decoder?: string } })?.analysis?.decoder === 'logistic';
  const views = plotsOf('decoding', data.resultNames, data.target).filter(
    // The timeline needs the Bayes decoder's per-frame posterior.
    (p) => !(p.id === 'timeline' && logistic),
  );
  return {
    coversPlots: true,
    plots: views.map((p) => ({
      id: p.id,
      label: p.title,
      main: () => <DecodingMain record={record} extra={extra} view={p.view} />,
    })),
    summary: summary(record, data),
  };
}

export function populationParts(
  record: RunRecord,
  extra: FrameworkExtra,
  data: ExplorerData,
): ExplorerParts | undefined {
  const methods = (Object.keys(POPULATION_RESULT) as PopulationMethod[]).filter((m) =>
    extra.manifest.results.some((r) => r.name === POPULATION_RESULT[m]),
  );
  if (!methods.length) return undefined;
  return {
    coversPlots: true,
    plots: methods.map((m) => ({
      id: m,
      label: NAV_LABEL[m],
      main: () => (
        <div class="cb-rx__embed">
          <Dynamic component={VIEWS[m]} src={extra.src} manifest={extra.manifest} record={record} />
        </div>
      ),
    })),
    summary: summary(record, data),
  };
}
