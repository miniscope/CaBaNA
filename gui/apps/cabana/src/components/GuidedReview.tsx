// Shared pieces of the guided setups: the settings summary groups and the "How it works" button.

import { createSignal, Show, type JSX } from 'solid-js';
import { Popover } from '../panels/Popover.tsx';

export interface SummaryGroup {
  title: string;
  /** The section the group's settings are edited in. */
  section?: string;
  items: { label: string; value: string; note?: string }[];
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
