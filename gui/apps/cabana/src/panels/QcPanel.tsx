import { createSignal, For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { experiment, missingRequired } from '../lib/store.ts';
import { BehaviorQc } from './BehaviorQc.tsx';
import { NeuralQc } from './NeuralQc.tsx';

const TABS = [
  { id: 'behavior', label: 'Behavior Data QC', view: BehaviorQc },
  { id: 'neural', label: 'Neural Data QC', view: NeuralQc },
] as const;

export function QcPanel(): JSX.Element {
  const [tab, setTab] = createSignal<(typeof TABS)[number]['id']>('behavior');
  return (
    <div class="cb-panel">
      <h2>Data QC</h2>
      <p class="cb-lead">
        Checks on the files you loaded. Warnings don't stop you from continuing, but look at the
        plots and tell CaBaNA whether each part is usable.
      </p>
      <Show when={missingRequired().length}>
        <div class="cb-note">
          For {experiment().label.toLowerCase()}, these required files are not loaded:{' '}
          {missingRequired()
            .map((s) => s.label.toLowerCase())
            .join(', ')}
          . Checks that need them are skipped.
        </div>
      </Show>
      <div class="cb-tabs" role="tablist">
        <For each={TABS}>
          {(t) => (
            <button
              role="tab"
              aria-selected={tab() === t.id}
              classList={{ 'cb-tab--on': tab() === t.id }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <Dynamic component={TABS.find((t) => t.id === tab())!.view} />
    </div>
  );
}
