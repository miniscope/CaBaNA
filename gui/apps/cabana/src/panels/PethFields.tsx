import { type JSX } from 'solid-js';

/** A number box. A value is stored only while the text is a finite number, so half-typed input is ignored. */
export function NumField(props: {
  label: string;
  value: number;
  /** The starting value: the box is highlighted when it differs. */
  def?: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  bad?: boolean;
  disabled?: boolean;
  onSet: (v: number) => void;
}): JSX.Element {
  return (
    <label
      class="cb-prep-field"
      classList={{
        'cb-prep-field--changed': props.def !== undefined && props.value !== props.def,
        'cb-pe-bad': props.bad,
      }}
    >
      <input
        type="number"
        aria-label={props.label}
        aria-invalid={props.bad || undefined}
        step={props.step ?? 'any'}
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        value={props.value}
        onInput={(e) => {
          const t = e.currentTarget.value;
          if (t !== '' && Number.isFinite(+t)) props.onSet(+t);
        }}
      />
      {props.unit}
    </label>
  );
}
