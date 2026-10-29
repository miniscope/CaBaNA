import { For, Show, type JSX } from 'solid-js';
import { InfoTip } from '../InfoTip.tsx';
import { NumField } from '../PethFields.tsx';
import type { Gate } from './logic.ts';

/** One setting: label with help, the control, and its valid range. */
export function Row(props: {
  label: string;
  tip?: JSX.Element;
  range?: string;
  children: JSX.Element;
  note?: string;
}): JSX.Element {
  return (
    <div class="cb-dec-row">
      <span class="cb-dec-row__label">
        {props.label}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.tip}</InfoTip>
        </Show>
      </span>
      <span class="cb-dec-row__control">{props.children}</span>
      <Show when={props.range || props.note}>
        <span class="cb-dec-row__range cb-muted">{props.note ?? props.range}</span>
      </Show>
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Greyed, with the reason shown under the control. */
  gate?: Gate;
}

/** A segmented choice. Gated options are greyed; their reason is written below, not in a tooltip. */
export function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onSet: (v: T) => void;
}): JSX.Element {
  const gated = () => props.options.filter((o) => o.gate?.disabled);
  return (
    <span class="cb-dec-choice">
      <div class="cb-seg" role="group" aria-label={props.label}>
        <For each={props.options}>
          {(o) => (
            <button
              type="button"
              classList={{
                'cb-seg__on': props.value === o.value,
                'cb-dec-gated': !!o.gate?.disabled,
              }}
              aria-pressed={props.value === o.value}
              aria-disabled={o.gate?.disabled || undefined}
              disabled={o.gate?.disabled && props.value !== o.value}
              onClick={() => !o.gate?.disabled && props.onSet(o.value)}
            >
              {o.label}
            </button>
          )}
        </For>
      </div>
      <For each={gated()}>
        {(o) => (
          <span class="cb-dec-why">
            {o.label}: {o.gate!.reason}
          </span>
        )}
      </For>
    </span>
  );
}

/** A whole-number or decimal setting with its unit; out-of-range values are marked and not stored. */
export function Num(props: {
  label: string;
  value: number;
  def: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  disabled?: boolean;
  onSet: (v: number) => void;
}): JSX.Element {
  const bad = () => props.value < (props.min ?? -Infinity) || props.value > (props.max ?? Infinity);
  return (
    <NumField
      label={props.label}
      value={props.value}
      def={props.def}
      min={props.min}
      max={props.max}
      step={props.step}
      unit={props.unit}
      disabled={props.disabled}
      bad={bad()}
      onSet={(v) => props.onSet(props.integer ? Math.round(v) : v)}
    />
  );
}
