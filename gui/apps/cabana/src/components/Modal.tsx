// A pop-up window over the page: dimmed backdrop, a title row ending in ×, an optional bar under
// it, a body that takes the rest of the window, and an optional footer. Escape, × and a click on
// the backdrop close it (or ask first, see confirmClose); focus stays inside while it is open and
// returns to where it was when it closes.

import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { CloseX } from './CloseX.tsx';

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
  /** Window size in px; never larger than 92% of the viewport. Default: nearly the whole page. A width without a height sizes to the content. */
  width?: number;
  height?: number;
  /** In the title row, just before the ×: an Actions menu or a status. */
  actions?: JSX.Element;
  /** A bar along the bottom of the window. */
  footer?: JSX.Element;
  /** Returns a message when closing would lose changes; × / Escape / backdrop then ask first. */
  confirmClose?: () => string | undefined;
  /** Heading and discard button of that question. Default: "Discard changes?" / "Discard changes". */
  confirmTitle?: string;
  discardLabel?: string;
  /** Extra class on the title row, e.g. a tinted band. */
  headClass?: string;
  /** A drawer along the right edge instead of a window in the middle. */
  side?: boolean;
  /** Name and tooltip of the ×, e.g. "Close. Changes are applied as you type". */
  closeLabel?: string;
  /** Files dropped anywhere on the window. */
  onDropFiles?: (files: File[]) => void;
  children: JSX.Element;
}): JSX.Element {
  let box!: HTMLDivElement;
  let close!: HTMLButtonElement;
  const [warning, setWarning] = createSignal<string>();
  const requestClose = () => {
    const message = props.confirmClose?.();
    if (message) setWarning(message);
    else props.onClose();
  };
  const before = document.activeElement as HTMLElement | null;
  // Only the topmost window answers Escape: an expanded plot opened from inside closes first.
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const open = document.querySelectorAll('[aria-modal="true"]');
    if (open[open.length - 1] !== box) return;
    if (warning()) setWarning(undefined);
    else requestClose();
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
      <div
        class="cb-modal-bg"
        classList={{ 'cb-modal-bg--side': props.side }}
        onClick={(e) => e.target === e.currentTarget && requestClose()}
      >
        <div
          ref={box}
          class="cb-modal"
          classList={{ 'cb-modal--side': props.side }}
          role="dialog"
          aria-modal="true"
          aria-label={props.label}
          style={
            props.side
              ? undefined
              : {
                  ...(props.width ? { width: `min(${props.width}px, 92vw)` } : {}),
                  ...(props.height
                    ? { height: `min(${props.height}px, 92vh)` }
                    : props.width
                      ? { height: 'auto', 'max-height': '92vh' } // a dialog with a width only fits its content
                      : {}),
                }
          }
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
          <div class="cb-modal__head" classList={{ [props.headClass ?? '']: !!props.headClass }}>
            <h2 class="cb-modal__title">{props.title}</h2>
            {props.head}
            <span class="cb-spacer" />
            {props.actions}
            <CloseX ref={(el) => (close = el)} label={props.closeLabel} onClick={requestClose} />
          </div>
          <Show when={props.bar}>
            <div class="cb-modal__bar">{props.bar}</div>
          </Show>
          <div class="cb-modal__body">{props.children}</div>
          <Show when={props.footer}>
            <div class="cb-modal__foot">{props.footer}</div>
          </Show>
          <Show when={warning()}>
            {(message) => (
              <div class="cb-modal__warn-bg">
                <div class="cb-modal__warn" role="alertdialog" aria-label="Close with changes">
                  <div class="cb-modal__warn-title">{props.confirmTitle ?? 'Discard changes?'}</div>
                  <p class="cb-muted">{message()}</p>
                  <div class="cb-modal__warn-actions">
                    <button
                      type="button"
                      class="btn-secondary btn-small"
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onClick={() => setWarning(undefined)}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      class="btn-primary btn-small"
                      onClick={() => props.onClose()}
                    >
                      {props.discardLabel ?? 'Discard changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Portal>
  );
}
