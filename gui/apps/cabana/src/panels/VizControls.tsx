// The cell and window controls of Data visualization: the page header and the expanded view of a
// box use these, so both read and set the same selected cell and window.

import { For, Show, type JSX } from 'solid-js';
import {
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  rawTrace,
  selectCell,
} from '../lib/store.ts';
import { setWinLen, setWinStartClamped, WINDOW_CHOICES, win, winLen } from '../lib/viz.ts';

export const nCells = (): number =>
  (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? footprints()?.cells ?? 0;

/** Cell number box with arrows: ‹ [number] / N ›. */
export function CellBar(): JSX.Element {
  const go = (c: number) => selectCell(Math.min(nCells() - 1, Math.max(0, c)));
  return (
    <div class="cb-cellbar cb-cellbar--compact">
      Cell
      <button
        class="btn-secondary btn-small"
        aria-label="Previous cell"
        onClick={() => go(cell() - 1)}
      >
        Prev
      </button>
      <input
        type="number"
        min="1"
        max={nCells()}
        aria-label="Cell number"
        value={cell() + 1}
        onInput={(e) => go(+e.currentTarget.value - 1)}
      />
      / {nCells()}
      <button class="btn-secondary btn-small" aria-label="Next cell" onClick={() => go(cell() + 1)}>
        Next
      </button>
    </div>
  );
}

/** Window length as segments on wide screens, a list on narrow ones (see viz.css), then Earlier and Later. */
export const WindowControls = (props: {
  /** "Window: 1 min" as one drop-down below the wide breakpoint, and no Earlier / Later. */
  inline?: boolean;
}): JSX.Element => {
  const half = () => (win()[1] - win()[0]) / 2;
  return (
    <>
      <Show when={!props.inline}>
        <span class="cb-plot__tool">Window</span>
      </Show>
      <div class="cb-seg cb-viz__winseg" role="group" aria-label="Window length">
        <For each={WINDOW_CHOICES}>
          {(w) => (
            <button
              type="button"
              classList={{ 'cb-seg__on': w.s === winLen() }}
              aria-pressed={w.s === winLen()}
              onClick={() => setWinLen(w.s)}
            >
              {w.label}
            </button>
          )}
        </For>
      </div>
      <select
        class="cb-viz__winsel"
        aria-label="Window length"
        value={String(winLen())}
        onChange={(e) => setWinLen(+e.currentTarget.value)}
      >
        <For each={WINDOW_CHOICES}>
          {(w) => (
            <option value={String(w.s)} selected={w.s === winLen()}>
              {props.inline ? `Window: ${w.label}` : w.label}
            </option>
          )}
        </For>
        <Show when={!WINDOW_CHOICES.some((w) => w.s === winLen())}>
          <option value={String(winLen())} selected>
            {props.inline ? 'Window: ' : ''}
            {Math.round(winLen())} s (custom)
          </option>
        </Show>
      </select>
      <Show when={!props.inline}>
        <button
          class="btn-secondary btn-small"
          onClick={() => setWinStartClamped(win()[0] - half())}
        >
          Earlier
        </button>
        <button
          class="btn-secondary btn-small"
          onClick={() => setWinStartClamped(win()[0] + half())}
        >
          Later
        </button>
      </Show>
    </>
  );
};
