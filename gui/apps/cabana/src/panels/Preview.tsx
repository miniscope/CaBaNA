import { createSignal, For, Show, type JSX } from 'solid-js';
import {
  annotationResults,
  deconvolved,
  denoisedTrace,
  positionResult,
  rawTrace,
  sessionDuration,
} from '../lib/store.ts';
import { Ethogram } from './BehaviorQc.tsx';
import { CellTraces } from './CellTraces.tsx';
import { CellPicker } from './parts.tsx';
import { Trajectory } from './Trajectory.tsx';

type Tab = 'traces' | 'position' | 'behavior';

/** A quick look at what was loaded, before moving on. */
export function Preview(): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('traces');
  const cells = () => (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? 0;
  const tabs = (): { id: Tab; label: string }[] =>
    [
      {
        id: 'traces' as const,
        label: 'Calcium traces',
        has: !!(rawTrace() || denoisedTrace() || deconvolved()),
      },
      {
        id: 'position' as const,
        label: 'Position',
        has: !!(positionResult() && 'x' in positionResult()!),
      },
      {
        id: 'behavior' as const,
        label: 'Behavior',
        has: annotationResults().some((a) => !a.error),
      },
    ].filter((t) => t.has);
  const current = (): Tab | undefined =>
    tabs().some((t) => t.id === tab()) ? tab() : tabs()[0]?.id;
  return (
    <Show when={tabs().length}>
      <section class="cb-group">
        <h3>Preview</h3>
        <div class="cb-tabs" role="tablist">
          <For each={tabs()}>
            {(t) => (
              <button
                role="tab"
                aria-selected={current() === t.id}
                classList={{ 'cb-tab--on': current() === t.id }}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>
        <Show when={current() === 'traces'}>
          <CellPicker n={cells()} />
          <CellTraces />
        </Show>
        <Show when={current() === 'position'}>
          <Trajectory bare mode="path" />
        </Show>
        <Show when={current() === 'behavior'}>
          <For each={annotationResults().filter((a) => !a.error)}>
            {(a) => (
              <>
                <div class="cb-label">{a.name}</div>
                <Ethogram epochs={a.epochs} duration={sessionDuration() ?? 0} />
              </>
            )}
          </For>
        </Show>
      </section>
    </Show>
  );
}
