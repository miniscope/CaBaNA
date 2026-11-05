// The six Experimental Setup cards (the page's navigation) and the heading of the workspace each one opens.

import { For, Show, type JSX } from 'solid-js';
import {
  CARDS,
  cardLabel,
  remainingFor,
  setSetupCard,
  setupCard,
  setupSnapshot,
  statusOf,
  type CardId,
  type CardLabel,
} from '../lib/setup-status.ts';

/** Line icons, 24 x 24, drawn with the current text color. */
const ICONS: Record<CardId, JSX.Element> = {
  spatial: <rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2" />,
  experiment: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M15.5 14.2c2.6-.3 4.6 1.3 5 4.3" />
    </>
  ),
  session: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="1.5" />
      <path d="M4 9.5h16M8.5 3v4M15.5 3v4M8 13h2M11 13h2M14 13h2M8 16.5h2M11 16.5h2" />
    </>
  ),
  tracking: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  stimuli: (
    <>
      <path d="M4 10v4h3.5L12 18V6L7.5 10z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </>
  ),
  neural: <path d="M2.5 12h4l2-5 3 11 3-14 2.5 8h4.5" />,
};

const MARK: Record<CardLabel, string> = {
  Complete: '✓',
  'Needs attention': '!',
  'Not configured': '○',
  Optional: '○',
};

/**
 * The card's label. `spatialBlocked` is the Spatial setup's own verdict (lib/spatial-checks.ts),
 * stricter than the status analyses use, so filled-in fields alone never show Complete.
 */
export function labelOf(id: CardId, spatialBlocked: boolean): CardLabel {
  const card = CARDS.find((c) => c.id === id)!;
  return cardLabel(
    card.priority,
    statusOf(id, setupSnapshot()),
    id === 'spatial' && spatialBlocked,
  );
}

export function SetupCards(props: { spatialBlocked: () => boolean }): JSX.Element {
  return (
    <div class="cb-es-cards" role="tablist" aria-label="Setup components">
      <For each={CARDS}>
        {(c) => {
          const label = () => labelOf(c.id, props.spatialBlocked());
          return (
            <button
              role="tab"
              class="cb-es-card"
              aria-selected={setupCard() === c.id}
              classList={{ 'cb-es-card--on': setupCard() === c.id }}
              title={`${c.purpose} ${c.priority}.`}
              onClick={() => setSetupCard(c.id)}
            >
              <span
                class="cb-es-card__prio"
                classList={{ 'cb-es-card__prio--req': c.priority === 'Required' }}
              >
                {c.priority}
              </span>
              <svg
                class="cb-es-card__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                {ICONS[c.id]}
              </svg>
              <span class="cb-es-card__title">{c.title}</span>
              <span class={`cb-es-status cb-es-status--${label().replace(' ', '-').toLowerCase()}`}>
                <i aria-hidden="true">{MARK[label()]}</i> {label()}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** Title, purpose and what is still needed, above a component's controls. Spatial setup lists its own checks. */
export function WorkspaceHead(props: { id: CardId }): JSX.Element {
  const card = () => CARDS.find((c) => c.id === props.id)!;
  const remaining = () => remainingFor(props.id, setupSnapshot());
  const status = () => statusOf(props.id, setupSnapshot());
  return (
    <div class="cb-es-head">
      <h3>{card().title}</h3>
      <span class="cb-muted">{card().purpose}</span>
      <Show when={props.id !== 'spatial'}>
        <span class="cb-es-remaining">
          <Show
            when={remaining().length}
            fallback={
              status() === 'Empty' && card().priority === 'Optional'
                ? 'Optional: leave empty if it does not apply.'
                : status() === 'Complete'
                  ? 'Everything required here is filled in.'
                  : 'Nothing here is required; fill in what applies.'
            }
          >
            Still needed: {remaining().join(', ')}.
          </Show>
        </span>
      </Show>
    </div>
  );
}
