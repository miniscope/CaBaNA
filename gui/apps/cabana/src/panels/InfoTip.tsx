import { createSignal, Show, type JSX } from 'solid-js';

let nextId = 1;

/** An ⓘ button that opens a short explanation. Escape or moving focus away closes it. */
export function InfoTip(props: { label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const id = `cb-tip-${nextId++}`;
  return (
    <span
      class="cb-tip"
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        class="cb-tip__btn"
        aria-label={props.label}
        aria-expanded={open()}
        aria-controls={id}
        onClick={() => setOpen(!open())}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <Show when={open()}>
        <span id={id} role="note" class="cb-tip__body">
          {props.children}
        </span>
      </Show>
    </span>
  );
}
