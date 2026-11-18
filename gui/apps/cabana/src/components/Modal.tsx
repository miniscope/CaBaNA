// A pop-up window over the page: dimmed backdrop, a title row with Close, an optional bar under
// it, and a body that takes the rest of the window. Escape and Close close it; focus stays
// inside while it is open and returns to where it was when it closes.

import { onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal(props: {
  /** The accessible name of the window. */
  label: string;
  title: JSX.Element;
  /** Beside the title: help marker, tags, tabs. */
  head?: JSX.Element;
  /** Under the title row, across the window. */
  bar?: JSX.Element;
  onClose: () => void;
  /** Files dropped anywhere on the window. */
  onDropFiles?: (files: File[]) => void;
  children: JSX.Element;
}): JSX.Element {
  let box!: HTMLDivElement;
  let close!: HTMLButtonElement;
  const before = document.activeElement as HTMLElement | null;
  // Only the topmost window answers Escape: an expanded plot opened from inside closes first.
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const open = document.querySelectorAll('[aria-modal="true"]');
    if (open[open.length - 1] === box) props.onClose();
  };
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  onMount(() => {
    close.focus();
    document.addEventListener('keydown', key);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', key);
    if (before?.isConnected) before.focus();
  });
  return (
    <Portal>
      <div class="cb-modal-bg" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div
          ref={box}
          class="cb-modal"
          role="dialog"
          aria-modal="true"
          aria-label={props.label}
          onKeyDown={trap}
          onDragOver={(e) => {
            if (!props.onDropFiles) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            if (!props.onDropFiles) return;
            e.preventDefault();
            e.stopPropagation();
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) props.onDropFiles(files);
          }}
        >
          <div class="cb-modal__head">
            <h2 class="cb-modal__title">{props.title}</h2>
            {props.head}
            <span class="cb-spacer" />
            <span class="cb-muted cb-modal__esc">Esc to close</span>
            <button
              ref={close}
              type="button"
              class="btn-secondary btn-small"
              onClick={() => props.onClose()}
            >
              Close
            </button>
          </div>
          <Show when={props.bar}>
            <div class="cb-modal__bar">{props.bar}</div>
          </Show>
          <div class="cb-modal__body">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}
