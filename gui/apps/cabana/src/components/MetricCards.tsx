// A row of summary cards: a value, what it counts and out of what. Shared by the QC, results and
// dashboard pages. The tone only colors the edge; the label always says what the card is.

import { For, Show, type JSX } from 'solid-js';
import { InfoTip } from '../panels/InfoTip.tsx';

export type CardTone = 'neutral' | 'blue' | 'orange' | 'purple' | 'gray' | 'ok' | 'warn' | 'fail';

export interface MetricCard {
  label: string;
  value: string;
  /** What the value is out of, written out ("of 148 cells evaluated"). */
  denom?: string;
  tone?: CardTone;
  /** A short explanation in a tooltip. */
  help?: JSX.Element;
}

export function MetricCards(props: { cards: MetricCard[]; label?: string }): JSX.Element {
  return (
    <div class="cb-mc" role="group" aria-label={props.label ?? 'Summary'}>
      <For each={props.cards}>
        {(c) => (
          <div class={`cb-mc__card cb-mc__card--${c.tone ?? 'neutral'}`}>
            <div class="cb-mc__value">{c.value}</div>
            <div class="cb-mc__label">
              {c.label}
              <Show when={c.help}>
                <InfoTip label={`About ${c.label.toLowerCase()}`}>{c.help}</InfoTip>
              </Show>
            </div>
            <Show when={c.denom}>
              <div class="cb-mc__denom">{c.denom}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
