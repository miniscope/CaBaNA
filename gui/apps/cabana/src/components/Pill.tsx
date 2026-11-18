import { Show, type JSX } from 'solid-js';

export type PillTone = 'flag' | 'ok' | 'prep' | 'corr' | 'neutral';

/** A small status label. Always carries words: color alone never says the status. */
export function Pill(props: {
  tone?: PillTone;
  title?: string;
  onClick?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const cls = () => `cb-pill cb-pill--${props.tone ?? 'neutral'}`;
  return (
    <Show
      when={props.onClick}
      fallback={
        <span class={cls()} title={props.title}>
          {props.children}
        </span>
      }
    >
      <button
        type="button"
        class={`${cls()} cb-pill--button`}
        title={props.title}
        onClick={() => props.onClick?.()}
      >
        {props.children}
      </button>
    </Show>
  );
}
