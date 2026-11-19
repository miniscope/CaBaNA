import { createSignal, Show, type JSX } from 'solid-js';
import { formatValue, parseEntry } from '../lib/slider-number.ts';

/**
 * A setting as a slider plus a typed number. Dragging calls onInput live; typing is applied (and
 * clamped to the range) on Enter or when the field loses focus.
 */
export function SliderNumber(props: {
  label: string;
  /** Help marker beside the label. */
  help?: JSX.Element;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Shown instead of 0, e.g. "off". */
  zeroLabel?: string;
  /** Shown as "default X". */
  defaultText: string;
  note?: string;
  onInput: (value: number) => void;
}): JSX.Element {
  // While the number field is being typed in, show the typed text instead of the formatted value.
  const [draft, setDraft] = createSignal<string | null>(null);
  const shown = () => draft() ?? 
    formatValue(props.value, props.step, props.zeroLabel, props.unit === 's' && props.step < 1 ? 2 : 0);
  const commit = () => {
    const text = draft();
    if (text === null) return;
    setDraft(null);
    props.onInput(parseEntry(text, props.value, props.min, props.max, props.zeroLabel));
  };
  return (
    <div class="cb-slidernum">
      <div class="cb-slidernum__label">
        <b>{props.label}</b>
        {props.help}
      </div>
      <div class="cb-slidernum__controls">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          aria-label={props.label}
          onInput={(e) => props.onInput(e.currentTarget.valueAsNumber)}
        />
        <input
          type="text"
          inputMode="decimal"
          class="cb-slidernum__num"
          value={shown()}
          aria-label={`${props.label}, number`}
          onFocus={(e) => e.currentTarget.select()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <Show when={props.unit}>
          <span class="cb-slidernum__unit">{props.unit}</span>
        </Show>
      </div>
      <div class="cb-slidernum__def">
        default {props.defaultText}
        {props.note ? ` · ${props.note}` : ''}
      </div>
    </div>
  );
}
