// Explorer parts for Decoding and Population: the existing result views, read from the run's saved
// arrays, as the main plot.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { hasCapability } from '../../lib/bridge-status.ts';
import { loadBehaviorDecoding, loadPositionDecoding } from '../../lib/decoding-results.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import type { FrameworkExtra } from '../../lib/results-framework.ts';
import { summarySentences } from '../../lib/results-explorer.ts';
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

function DecodingMain(props: { record: RunRecord; extra: FrameworkExtra }): JSX.Element {
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
  return {
    title: () => 'Decoded vs actual',
    tested: true,
    mainLabel: 'Decoding results',
    help: () => undefined,
    main: () => <DecodingMain record={record} extra={extra} />,
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
  const [method, setMethod] = createSignal(0);
  return {
    title: () => NAV_LABEL[methods[method()]],
    tested: true,
    mainLabel: 'Population analyses',
    switcher: {
      label: 'Analysis',
      options: methods.map((m) => NAV_LABEL[m]),
      index: method,
      set: setMethod,
    },
    help: () => undefined,
    main: () => (
      <div class="cb-rx__embed">
        <Dynamic
          component={VIEWS[methods[method()]]}
          src={extra.src}
          manifest={extra.manifest}
          record={record}
        />
      </div>
    ),
    summary: summary(record, data),
  };
}
