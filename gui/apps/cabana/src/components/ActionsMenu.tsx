// A button that opens a menu. Actions close it; option rows (one-of, many-of) leave it open so
// view settings update live. Hovering a category row opens a second panel that touches the menu;
// a click pins it open. The panel closes 300 ms after the pointer leaves both, and a bridge strip
// (parts.css) keeps diagonal moves from closing it. A category inside the second panel replaces
// its contents on click or → (never a third panel). Timing rules: hoverStep in lib/actions-menu.ts.

import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  HOVER_START,
  hoverStep,
  pendingDelay,
  resolvePanel,
  stepFocus,
  type HoverEvent,
  type MenuItem,
  type MenuSource,
} from '../lib/actions-menu.ts';

const ROWS = '[role^="menuitem"]:not([aria-disabled="true"])';
const EDGE = 8;

export function ActionsMenu(props: {
  items: MenuSource;
  label?: string;
  class?: string;
  /** Open the second panel to the left even when there is room on the right. */
  side?: 'left' | 'right';
  /** Open the menu upward even when there is room below. */
  up?: boolean;
}): JSX.Element {
  let button!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let secondPanel: HTMLDivElement | undefined;
  let timer: number | undefined;
  const [open, setOpen] = createSignal(false);
  const [path, setPath] = createSignal<string[]>([]);
  const [pos, setPos] = createSignal({ left: 0, top: 0, up: false });
  // Second panel placement, measured after it renders: side, and a lift when it runs off the bottom.
  const [side2, setSide2] = createSignal({ lt: false, top: -5 });
  const [hover, setHover] = createSignal(HOVER_START);
  const items = () => (typeof props.items === 'function' ? props.items() : props.items);
  const second = createMemo(() => resolvePanel(items(), path()));

  // Runs the reducer, then keeps the second panel's path and the single timer in step with it.
  const send = (event: HoverEvent) => {
    const next = hoverStep(hover(), event);
    setHover(next);
    clearTimeout(timer);
    if (next.pending)
      timer = window.setTimeout(() => send({ type: 'timer-fired' }), pendingDelay(next));
    if (next.open !== path()[0]) setPath(next.open ? [next.open] : []);
  };
  onCleanup(() => clearTimeout(timer));

  const close = (returnFocus = true) => {
    clearTimeout(timer);
    setHover(HOVER_START);
    setOpen(false);
    setPath([]);
    if (returnFocus) button.focus();
  };
  const place = () => {
    if (!menu) return;
    const a = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.min(Math.max(8, a.right - w), innerWidth - w - 8);
    const up = props.up ?? (innerHeight - a.bottom < h + 12 && a.top > innerHeight - a.bottom);
    setPos({
      left,
      up,
      top: up ? Math.max(8, a.top - 4 - h) : a.bottom + 4,
    });
    placeSecond();
  };
  const placeSecond = () => {
    if (!menu || !secondPanel) return;
    const m = menu.getBoundingClientRect();
    const w = secondPanel.offsetWidth;
    const h = secondPanel.offsetHeight;
    // Level with its category row, lifted when it would run off the bottom.
    const owner = menu.querySelector<HTMLElement>(
      `[data-category="${CSS.escape(second().owner ?? '')}"]`,
    );
    const top = (owner?.offsetTop ?? 0) - 5;
    setSide2({
      lt: props.side ? props.side === 'left' : m.right + w > innerWidth - EDGE,
      top: Math.min(top, innerHeight - EDGE - (m.top + h)),
    });
  };
  // The panel's size depends on its contents, so measure after each change of path.
  createEffect(() => {
    second();
    requestAnimationFrame(placeSecond);
  });
  const outside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!menu?.contains(t) && !button.contains(t)) close(false);
  };
  const toggle = () => {
    if (open()) return close();
    setOpen(true);
    requestAnimationFrame(() => {
      place();
      menu?.querySelector<HTMLElement>(ROWS)?.focus();
    });
  };
  createEffect(() => {
    if (!open()) return;
    document.addEventListener('pointerdown', outside, true);
    addEventListener('resize', place);
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true);
      removeEventListener('resize', place);
    });
  });

  const back = () => {
    setPath(path().slice(0, -1));
    requestAnimationFrame(() =>
      menu?.querySelector<HTMLElement>('.cb-menu__panel--second ' + ROWS)?.focus(),
    );
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (second().canGoBack) back();
      else {
        send({ type: 'escape' });
        close();
      }
      return;
    }
    const panel = (e.target as HTMLElement).closest('.cb-menu__panel');
    if (!panel) return;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(ROWS));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = stepFocus(at, rows.length, e.key);
    if (next !== null) {
      e.preventDefault();
      rows[next]?.focus();
    } else if (e.key === 'ArrowLeft' && panel.classList.contains('cb-menu__panel--second')) {
      // Back out of the second panel to its category item in the menu.
      e.preventDefault();
      if (second().canGoBack) back();
      else {
        const owner = second().owner;
        send({ type: 'escape' });
        requestAnimationFrame(() =>
          menu?.querySelector<HTMLElement>(`[data-category="${CSS.escape(owner ?? '')}"]`)?.focus(),
        );
      }
    } else if (e.key === 'ArrowRight' && (e.target as HTMLElement).dataset.category !== undefined) {
      e.preventDefault();
      (e.target as HTMLElement).click();
    }
  };

  const row = (item: MenuItem, level: 0 | 1): JSX.Element => {
    switch (item.kind) {
      case 'separator':
        return <hr class="cb-menu__sep" />;
      case 'header':
        return <div class="cb-menu__header">{item.label}</div>;
      case 'category':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="cb-menu__row"
            classList={{ 'cb-menu__row--open': level === 0 && second().owner === item.label }}
            aria-haspopup="menu"
            aria-expanded={second().items !== null && path()[level] === item.label}
            data-category={item.label}
            onPointerEnter={() =>
              send(
                level === 0
                  ? { type: 'enter-category', label: item.label }
                  : { type: 'enter-submenu' },
              )
            }
            onPointerLeave={() => level === 0 && send({ type: 'leave' })}
            onClick={() => {
              if (level === 0) send({ type: 'click-category', label: item.label });
              else setPath([...path(), item.label]);
            }}
          >
            {item.label}
            <span class="cb-menu__caret" aria-hidden="true">
              ▸
            </span>
          </button>
        );
      case 'action':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="cb-menu__row"
            classList={{ 'cb-menu__row--danger': item.danger }}
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.disabled}
            onPointerEnter={() => level === 0 && send({ type: 'enter-action' })}
            onClick={() => {
              if (item.disabled) return;
              if (!item.keepOpen) close();
              item.onSelect();
            }}
          >
            {item.label}
            <Show when={(!item.tipOnly && item.disabled) || item.sub}>
              <span class="cb-menu__sub">{(!item.tipOnly && item.disabled) || item.sub}</span>
            </Show>
          </button>
        );
      case 'one':
        return (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={item.checked}
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.disabled}
            tabIndex={-1}
            class="cb-menu__row cb-menu__row--option"
            onClick={() => !item.disabled && item.onSelect()}
          >
            <span class="cb-menu__mark" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            {item.label}
            <Show when={item.disabled}>
              <span class="cb-menu__sub">{item.disabled}</span>
            </Show>
          </button>
        );
      case 'many':
        return (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.checked}
            tabIndex={-1}
            class="cb-menu__row cb-menu__row--option"
            onClick={() => item.onToggle(!item.checked)}
          >
            <input type="checkbox" checked={item.checked} tabIndex={-1} aria-hidden="true" />
            {item.label}
          </button>
        );
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class={props.class ?? 'btn-secondary btn-small'}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open()) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {props.label ?? 'Actions'} ▾
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="cb-menu"
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
            onKeyDown={key}
          >
            <div class="cb-menu__panel" role="menu" aria-label={props.label ?? 'Actions'}>
              <For each={items()}>{(item) => row(item, 0)}</For>
            </div>
            <Show when={second().items}>
              {(panelItems) => (
                <div
                  ref={secondPanel}
                  class="cb-menu__panel cb-menu__panel--second"
                  classList={{ 'cb-menu__panel--lt': side2().lt, 'cb-menu__panel--up': pos().up }}
                  style={pos().up ? undefined : { top: `${side2().top}px` }}
                  onPointerEnter={() => send({ type: 'enter-submenu' })}
                  onPointerLeave={() => send({ type: 'leave' })}
                  role="menu"
                  aria-label={second().title ?? second().owner ?? ''}
                >
                  <Show when={second().canGoBack}>
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      class="cb-menu__row cb-menu__back"
                      onClick={back}
                    >
                      ‹ Back
                    </button>
                    <div class="cb-menu__header">{second().title}</div>
                  </Show>
                  <For each={panelItems()}>{(item) => row(item, 1)}</For>
                </div>
              )}
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
}
