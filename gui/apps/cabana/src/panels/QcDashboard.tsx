import { For, Show, type JSX } from 'solid-js';
import type { Check, Status } from '../lib/qc.ts';
import { proceed, type Section } from '../lib/store.ts';

const ICON = { pass: '✓', warn: '!', fail: '✕' };
const WORD = { pass: 'Passed', warn: 'Passed, with notes', fail: 'Failed' };

export interface QcCard {
  title: string;
  checks: Check[];
  /** The section the user can choose to continue with despite a failure. */
  section?: Section;
  /** Runs when the card is clicked: scroll to the section or open its tab. */
  open?: () => void;
}

const worst = (checks: Check[]): Status =>
  checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';

/** One card per QC section: its result, and every check with its number and limit. */
function Card(props: { card: QcCard }): JSX.Element {
  const state = () => worst(props.card.checks);
  return (
    <div
      class={`cb-card cb-card--${state()}`}
      role="button"
      tabindex="0"
      onClick={() => props.card.open?.()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.card.open?.()}
    >
      <div class="cb-card__head">
        <span class="cb-check__icon" aria-hidden="true">
          {ICON[state()]}
        </span>
        <span class="cb-card__title">{props.card.title}</span>
      </div>
      <div class="cb-card__state">{WORD[state()]}</div>
      <Show when={props.card.section && proceed[props.card.section] && state() === 'fail'}>
        <div class="cb-card__proceed">Continuing with these issues</div>
      </Show>
      <For each={props.card.checks}>
        {(c) => (
          <div class={`cb-card__row cb-card__row--${c.status}`}>
            <span class="cb-card__dot" aria-hidden="true" />
            <span class="cb-card__label">{c.title}</span>
            <span class="cb-card__value">
              {c.value ?? (c.status === 'pass' ? 'OK' : 'See below')}
              <Show when={c.limit}>
                <span class="cb-muted"> ({c.limit})</span>
              </Show>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** The result of every QC section in this tab, side by side, at the top. */
export function QcDashboard(props: { cards: QcCard[] }): JSX.Element {
  const shown = () => props.cards.filter((c) => c.checks.length);
  return (
    <Show when={shown().length}>
      <div class="cb-dash">
        <For each={shown()}>{(c) => <Card card={c} />}</For>
      </div>
    </Show>
  );
}
