// A button that opens a menu. Actions close it; option rows (one-of, many-of) leave it open so
// view settings update live. A category item opens a second panel beside the menu; nothing opens
// a third (see lib/actions-menu.ts).

import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { resolvePanel, stepFocus, type MenuItem, type MenuSource } from '../lib/actions-menu.ts';

const ROWS = '[role^="menuitem"]:not([aria-disabled="true"])';
// Room the second panel needs beside the menu before it flips to the left.
const SECOND_PANEL_ROOM = 232;

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
  const [open, setOpen] = createSignal(false);
  const [path, setPath] = createSignal<string[]>([]);
  const [pos, setPos] = createSignal({ left: 0, top: 0, up: false, lt: false });
  const items = () => (typeof props.items === 'function' ? props.items() : props.items);
  const second = createMemo(() => resolvePanel(items(), path()));

  const close = (returnFocus = true) => {
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
      lt: props.side ? props.side === 'left' : left + w + SECOND_PANEL_ROOM > innerWidth - 8,
    });
  };
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
      else close();
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
        setPath([]);
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
            onPointerEnter={() => level === 0 && path()[0] !== item.label && setPath([item.label])}
            onClick={() => setPath(level === 0 ? [item.label] : [...path(), item.label])}
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
            onPointerEnter={() => level === 0 && path().length > 0 && setPath([])}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
          >
            {item.label}
            <Show when={item.disabled || item.sub}>
              <span class="cb-menu__sub">{item.disabled || item.sub}</span>
            </Show>
          </button>
        );
      case 'one':
        return (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={item.checked}
            tabIndex={-1}
            class="cb-menu__row cb-menu__row--option"
            onClick={() => item.onSelect()}
          >
            <span class="cb-menu__mark" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            {item.label}
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
                  class="cb-menu__panel cb-menu__panel--second"
                  classList={{ 'cb-menu__panel--lt': pos().lt, 'cb-menu__panel--up': pos().up }}
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
