// Population results overview: what was run and one card per method with a one-line result.
// Every number is counted from the framework arrays the method views read.

import { createResource, For, Show, type JSX } from 'solid-js';
import type { Manifest } from '../../lib/bridge-client.ts';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import type { ResultSource } from '../../lib/results-load.ts';
import { METHOD_NAME } from './MethodsSection.tsx';
import { lineOf } from './overview-lines.ts';
import { recorded } from './shared.tsx';

function OverviewCard(props: {
  src: ResultSource;
  manifest: Manifest;
  method: PopulationMethod;
  onOpen: () => void;
}): JSX.Element {
  const [line] = createResource(
    () => [props.src, props.manifest, props.method] as const,
    ([s, m, k]) => lineOf(s, m, k),
  );
  return (
    <div class="cb-pn-ovcard">
      <h4>{METHOD_NAME[props.method]}</h4>
      <Show when={!line.loading} fallback={<span class="cb-muted">Loading the saved values</span>}>
        <span>{line.error ? String(line.error) : (line()?.text ?? 'No result saved')}</span>
        <Show when={line()}>
          <span class="cb-badge">{line()!.tested ? 'Tested against a null' : 'Descriptive'}</span>
        </Show>
      </Show>
      <button class="cb-link" onClick={props.onOpen}>
        Open the figures
      </button>
    </div>
  );
}

/** Settings of the run read back from the saved result, then one card per analysis. */
export function Overview(props: {
  src: ResultSource;
  manifest: Manifest;
  methods: PopulationMethod[];
  onOpen: (m: PopulationMethod) => void;
}): JSX.Element {
  const first = () => props.manifest.results.find((r) => recorded(r).n_shuffles != null);
  const rec = () => recorded(first());
  const states = () => first()?.state_names?.length;
  const chips = () =>
    [
      states() ? `${states()} states` : undefined,
      first()?.cell_ids?.length ? `${first()!.cell_ids!.length} cells` : undefined,
      rec().n_shuffles != null ? `${rec().n_shuffles} shuffles` : undefined,
      rec().alpha != null ? `α ${rec().alpha}` : undefined,
      rec().correction
        ? `correction: ${rec().correction === 'none' ? 'none' : 'max-stat'}`
        : undefined,
    ].filter((c): c is string => !!c);
  return (
    <div class="cb-pn-ovwrap">
      <div class="cb-pn-chips" aria-label="Settings of this run">
        <For each={chips()}>{(c) => <span>{c}</span>}</For>
      </div>
      <div class="cb-pn-ov">
        <For each={props.methods}>
          {(m) => (
            <OverviewCard
              src={props.src}
              manifest={props.manifest}
              method={m}
              onOpen={() => props.onOpen(m)}
            />
          )}
        </For>
      </div>
    </div>
  );
}
