// Shared pieces of the guided setups: a summary of every setting and the "How it works" button.

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { Guided } from '../lib/guided.ts';
import { Popover } from '../panels/Popover.tsx';

export interface SummaryGroup {
  title: string;
  /** The section the group's settings are edited in. */
  section?: string;
  items: { label: string; value: string; note?: string }[];
}

/** Every setting a run uses, grouped by section, each group linking back to where it is edited. */
export function SettingsSummary(props: { g: Guided; groups: SummaryGroup[] }): JSX.Element {
  return (
    <div class="cb-gs-summary">
      <For each={props.groups}>
        {(grp) => (
          <section class="cb-gs-summary__grp">
            <h4>
              {grp.title}
              <Show when={grp.section}>
                <button
                  type="button"
                  class="cb-link"
                  onClick={() => {
                    props.g.open(grp.section!);
                    props.g.setStage('configure');
                  }}
                >
                  Edit
                </button>
              </Show>
            </h4>
            <dl>
              <For each={grp.items}>
                {(it) => (
                  <>
                    <dt>{it.label}</dt>
                    <dd>
                      {it.value}
                      <Show when={it.note}>
                        <span class="cb-muted"> · {it.note}</span>
                      </Show>
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </section>
        )}
      </For>
    </div>
  );
}

/** A "How it works" button by a page title, opening the method text in an anchored panel. */
export function HowItWorks(props: { title: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="cb-link cb-gs-how"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        How it works
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={() => setOpen(false)}
          role="dialog"
          label={props.title}
          width={520}
          class="cb-gs-how__body"
        >
          <h4>{props.title}</h4>
          {props.children}
        </Popover>
      </Show>
    </>
  );
}
