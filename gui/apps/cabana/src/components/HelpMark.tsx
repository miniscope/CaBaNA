import type { JSX } from 'solid-js';

/** The "i" help marker: a small circle with an italic serif i. Put it inside a labelled button. */
export function HelpMark(): JSX.Element {
  return (
    <span class="cb-help" aria-hidden="true">
      i
    </span>
  );
}
