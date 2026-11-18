// The body of a Configure settings window: the analysis's setting groups on the left, each with its
// one-line summary, and the open group's fields on the right. A group named `advanced` sits under
// a rule as "Advanced options". Reset to defaults is a checkbox that takes effect on Save.

import { For, Show, type JSX } from 'solid-js';
import type { Guided } from '../lib/guided.ts';
import type { GuidedSection } from './GuidedSetup.tsx';

function GroupRow(props: { g: Guided; s: GuidedSection; advanced?: boolean }): JSX.Element {
  const on = () => props.g.section() === props.s.id;
  return (
    <button
      type="button"
      class="cb-cfg__group"
      classList={{ 'cb-cfg__group--on': on(), 'cb-cfg__group--adv': props.advanced }}
      aria-current={on() ? 'page' : undefined}
      onClick={() => props.g.open(props.s.id)}
    >
      <span class="cb-cfg__title">
        {props.advanced ? 'Advanced options' : props.s.title}
        <Show when={props.advanced}>
          <span class="cb-cfg__caret">{on() ? ' ▾' : ' ▸'}</span>
        </Show>
        <Show when={props.s.optional && !props.advanced}>
          <span class="cb-muted"> · optional</span>
        </Show>
      </span>
      <Show when={props.s.attention ?? props.s.summary}>
        <span class="cb-cfg__sum" classList={{ 'cb-warn': !!props.s.attention }}>
          {props.s.attention ? `Needs attention: ${props.s.attention}` : props.s.summary}
        </span>
      </Show>
    </button>
  );
}

/** What the Configure window hands each analysis's setup: the Reset to defaults checkbox. */
export interface ConfigureControl {
  reset: () => boolean;
  setReset: (on: boolean) => void;
}

export function ConfigureBody(props: {
  g: Guided;
  label: string;
  sections: GuidedSection[];
  control: ConfigureControl;
  children: (id: string) => JSX.Element;
}): JSX.Element {
  const main = () => props.sections.filter((s) => s.id !== 'advanced');
  const advanced = () => props.sections.find((s) => s.id === 'advanced');
  return (
    <div class="cb-cfg">
      <nav class="cb-cfg__nav" aria-label={props.label}>
        <For each={main()}>{(s) => <GroupRow g={props.g} s={s} />}</For>
        <Show when={advanced()}>{(s) => <GroupRow g={props.g} s={s()} advanced />}</Show>
        <label class="cb-cfg__reset">
          <input
            type="checkbox"
            checked={props.control.reset()}
            onChange={(e) => props.control.setReset(e.currentTarget.checked)}
          />
          Reset to defaults
          <Show when={props.control.reset()}>
            <span class="cb-muted"> on Save</span>
          </Show>
        </label>
      </nav>
      <div class="cb-cfg__main">
        <For each={props.sections}>
          {(s) => <Show when={props.g.section() === s.id}>{props.children(s.id)}</Show>}
        </For>
      </div>
    </div>
  );
}
