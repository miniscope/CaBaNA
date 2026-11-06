// The number boxes and Auto/Manual choices of the Place cells settings, and the note beside a shared field.

import { For, Show, type JSX } from 'solid-js';
import { DEFAULT_PLACE_SETTINGS, placeSettings, setPlaceSettings } from '../lib/place-run.ts';
import { InfoTip } from './InfoTip.tsx';

type NumKey =
  | 'nShuffles'
  | 'alpha'
  | 'fieldThreshold'
  | 'minFieldBins'
  | 'sigma'
  | 'minShiftS'
  | 'minOccFieldsS';

/** A compact number box with its unit beside it. Boxes holding something other than the default are highlighted. */
export function Num(props: {
  k: NumKey;
  label: string;
  unit?: string;
  step: number;
  min?: number;
  max?: number;
  hint?: string;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <Show when={props.label}>
        <div class="cb-setting__title">
          {props.label}
          <Show when={props.hint}>
            <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.hint}</InfoTip>
          </Show>
        </div>
      </Show>
      <label
        class="cb-prep-field"
        classList={{
          'cb-prep-field--changed': placeSettings[props.k] !== DEFAULT_PLACE_SETTINGS[props.k],
        }}
      >
        <input
          type="number"
          min={props.min ?? 0}
          max={props.max}
          step={props.step}
          value={placeSettings[props.k]}
          onInput={(e) => {
            const v = +e.currentTarget.value;
            if (Number.isFinite(v))
              setPlaceSettings(
                props.k,
                Math.min(props.max ?? Infinity, Math.max(props.min ?? 0, v)),
              );
          }}
        />
        {props.unit}
      </label>
    </div>
  );
}

/** Auto (chosen from the data when the analysis runs) or Manual (a number you set), with what the last run used. */
export function AutoManual(props: {
  title: string;
  auto: 'sigmaAuto' | 'shiftAuto';
  k: 'sigma' | 'minShiftS';
  unit: string;
  step: number;
  used?: string;
  hint: string;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <div class="cb-setting__title">
        {props.title}
        <InfoTip label={`About ${props.title.toLowerCase()}`}>{props.hint}</InfoTip>
      </div>
      <div class="cb-controls">
        <For each={[true, false]}>
          {(a) => (
            <label class="cb-radio">
              <input
                type="radio"
                name={props.auto}
                checked={placeSettings[props.auto] === a}
                onChange={() => setPlaceSettings(props.auto, a)}
              />
              {a ? 'Auto' : 'Manual'}
            </label>
          )}
        </For>
        <Show when={!placeSettings[props.auto]}>
          <Num k={props.k} label="" unit={props.unit} step={props.step} />
        </Show>
      </div>
      <Show when={props.used}>
        <div class="cb-muted">Last run chose {props.used}.</div>
      </Show>
    </div>
  );
}

/** Beside a field whose value other pages read too, so a change here is not a surprise there. */
export const Shared = (props: { children: string }) => (
  <div class="cb-muted cb-shared">{props.children}</div>
);

export const auto = (on: boolean, v: string) => (on ? 'Auto' : v);
