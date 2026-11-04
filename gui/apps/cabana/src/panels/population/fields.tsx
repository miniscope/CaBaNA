// Setting controls shared by the Population setup sections.

import { For, Show, type JSX } from 'solid-js';
import {
  DEFAULT_POPULATION,
  POPULATION_RANGES,
  populationSettings as s,
  setPopulationSettings as set,
  type PopulationNumKey,
  type PopulationSettings,
} from '../../lib/population-settings.ts';
import { inRange } from '../../lib/ranges.ts';
import { InfoTip } from '../InfoTip.tsx';
import { NumField } from '../PethFields.tsx';

const D = DEFAULT_POPULATION;

/** A labeled setting with an optional explanation, laid out in a row. */
export function Field(props: {
  label: string;
  tip?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-pn-field">
      <span>
        {props.label}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.tip}</InfoTip>
        </Show>
      </span>
      {props.children}
    </div>
  );
}

export function Select<K extends keyof PopulationSettings>(props: {
  k: K;
  label: string;
  options: [PopulationSettings[K], string][];
}): JSX.Element {
  return (
    <select
      aria-label={props.label}
      value={String(s[props.k])}
      onChange={(e) => set(props.k, e.currentTarget.value as PopulationSettings[K])}
    >
      <For each={props.options}>{([v, text]) => <option value={String(v)}>{text}</option>}</For>
    </select>
  );
}

/** A number box; an out-of-range value is kept and marked, and the run says why it is blocked. */
export function Num(p: {
  k: PopulationNumKey;
  label: string;
  unit?: string;
  step?: number;
  whole?: boolean;
}): JSX.Element {
  return (
    <NumField
      label={p.label}
      value={s[p.k]}
      def={D[p.k]}
      min={POPULATION_RANGES[p.k].min}
      max={POPULATION_RANGES[p.k].max}
      bad={!inRange(s[p.k], POPULATION_RANGES[p.k])}
      step={p.step ?? ('any' as unknown as number)}
      unit={p.unit}
      onSet={(v) => set(p.k, p.whole ? Math.round(v) : v)}
    />
  );
}
