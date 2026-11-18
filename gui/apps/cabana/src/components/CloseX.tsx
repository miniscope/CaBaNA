import type { JSX } from 'solid-js';

/** The × that closes a window, popover or panel. */
export function CloseX(props: {
  onClick: () => void;
  /** Accessible name and tooltip, e.g. "Close. Changes are saved automatically". */
  label?: string;
  ref?: (el: HTMLButtonElement) => void;
}): JSX.Element {
  const label = () => props.label ?? 'Close';
  return (
    <button
      ref={props.ref}
      type="button"
      class="cb-closex"
      aria-label={label()}
      title={label()}
      onClick={() => props.onClick()}
    >
      ×
    </button>
  );
}
