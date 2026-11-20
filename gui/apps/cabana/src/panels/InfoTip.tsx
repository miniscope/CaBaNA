import { createSignal, Show, type JSX } from 'solid-js';
import { Popover } from './Popover.tsx';
import { HelpMark } from '../components/HelpMark.tsx';

let nextId = 1;

/**
 * An "i" button with a short explanation. It opens on hover or keyboard focus and closes when the
 * pointer or focus leaves; a click or tap keeps it open until Escape or a click elsewhere.
 */
export function InfoTip(props: {
  label: string;
  /** Replaces the i marker. */
  icon?: JSX.Element;
  class?: string;
  /** Width of the explanation in px (default 280). */
  width?: number;
  children: JSX.Element;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  const id = `cb-tip-${nextId++}`;
  let btn!: HTMLButtonElement;
  const close = () => {
    setOpen(false);
    setPinned(false);
  };
  return (
    <span class="cb-tip">
      <button
        ref={btn}
        type="button"
        class={`cb-tip__btn ${props.class ?? ''}`}
        aria-label={props.label}
        aria-expanded={open()}
        aria-describedby={open() ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned() && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned() && setOpen(false)}
        onClick={() => {
          const pin = !pinned();
          setPinned(pin);
          setOpen(pin);
        }}
      >
        {props.icon ?? <HelpMark />}
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={close}
          id={id}
          role="tooltip"
          width={props.width ?? 280}
          class="cb-tip__body"
        >
          {props.children}
        </Popover>
      </Show>
    </span>
  );
}
