// The Plot type drop-down of the Visualizations view. A custom list instead of a native select so
// the current entry carries a ✓, the plots of the analysis's page sit under their own label, and an
// entry that cannot be drawn for this run is greyed out with its reason shown. Arrow keys, Home,
// End, Enter and Escape work from the button; focus stays on the button while the list is open.

import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { PlotChoice } from './plot-choice.ts';

let nextId = 1;

export function PlotTypeSelect(props: {
  /** Id for the button, so a label can point at it. */
  id: string;
  choices: PlotChoice[];
  current: PlotChoice | undefined;
  onPick: (id: string) => void;
}): JSX.Element {
  const listId = `cb-plot-list-${nextId++}`;
  let root!: HTMLDivElement;
  let list: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [place, setPlace] = createSignal({ top: 0, left: 0 });

  const views = () => props.choices.filter((c) => c.view);
  const pages = () => props.choices.filter((c) => c.page);
  /** Both groups in the order they are drawn, which is the order the arrow keys follow. */
  const ordered = () => [...views(), ...pages()];
  const optionId = (c: PlotChoice) => `${listId}-${c.id}`;

  const show = () => {
    const r = root.getBoundingClientRect();
    setPlace({ top: r.bottom + 4, left: r.left });
    const at = ordered().findIndex((c) => c.id === props.current?.id);
    setActive(at >= 0 ? at : Math.max(0, ordered().findIndex((c) => !c.disabled)));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choose = (c: PlotChoice) => {
    if (c.disabled) return;
    close();
    props.onPick(c.id);
  };
  /** The next entry that can be chosen, stepping `by` from the active one without wrapping. */
  const step = (by: 1 | -1) => {
    const items = ordered();
    for (let i = active() + by; i >= 0 && i < items.length; i += by)
      if (!items[i].disabled) return setActive(i);
  };
  const edge = (last: boolean) => {
    const items = ordered();
    const at = last ? items.findLastIndex((c) => !c.disabled) : items.findIndex((c) => !c.disabled);
    if (at >= 0) setActive(at);
  };

  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node) && !list?.contains(e.target as Node)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  onCleanup(() => document.removeEventListener('pointerdown', outside, true));

  // Keep the active entry visible when the list is longer than its box.
  createEffect(() => {
    const c = ordered()[active()];
    if (open() && c) document.getElementById(optionId(c))?.scrollIntoView({ block: 'nearest' });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return step(1);
      case 'ArrowUp':
        e.preventDefault();
        return step(-1);
      case 'Home':
        e.preventDefault();
        return edge(false);
      case 'End':
        e.preventDefault();
        return edge(true);
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const c = ordered()[active()];
        if (c) choose(c);
        return;
      }
      case 'Escape':
        e.preventDefault(); // the window behind does not close with it
        return close();
      case 'Tab':
        return close();
    }
  };

  const option = (c: PlotChoice) => (
    <div
      id={optionId(c)}
      role="option"
      class="cb-menu__row cb-pt__row"
      classList={{ 'cb-menu__row--open': ordered()[active()]?.id === c.id }}
      aria-selected={c.id === props.current?.id}
      aria-disabled={c.disabled ? 'true' : undefined}
      title={c.disabled}
      onMouseEnter={() => !c.disabled && setActive(ordered().findIndex((x) => x.id === c.id))}
      onClick={() => choose(c)}
    >
      <span class="cb-menu__mark" aria-hidden="true">
        {c.id === props.current?.id ? '✓' : ''}
      </span>
      {c.label}
      <Show when={c.disabled}>
        <span class="cb-menu__sub cb-pt__why">Not available: {c.disabled}</span>
      </Show>
    </div>
  );

  return (
    <div class="cb-pt" ref={root}>
      <button
        type="button"
        id={props.id}
        class="cb-pt__btn"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={listId}
        aria-activedescendant={open() && ordered()[active()] ? optionId(ordered()[active()]) : undefined}
        disabled={!props.choices.length}
        onClick={() => (open() ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span class="cb-pt__value">{props.current?.label ?? 'No plot available'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div
          ref={list}
          id={listId}
          class="cb-menu__panel cb-pt__list"
          role="listbox"
          aria-label="Plot type"
          style={{ top: `${place().top}px`, left: `${place().left}px` }}
        >
          <For each={views()}>{option}</For>
          <Show when={pages().length}>
            <Show when={views().length}>
              <hr class="cb-menu__sep" />
            </Show>
            <div class="cb-menu__header" role="presentation">
              More plots of this analysis
            </div>
            <For each={pages()}>{option}</For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
