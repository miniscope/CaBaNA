// Cards for the target and the decoder, and the picker for how behavior classes are formed.

import { For, Show, type JSX } from 'solid-js';
import { populationContext } from '../../lib/analysis-registry.ts';
import {
  behaviorDecoding,
  decodeTarget,
  setBehaviorDecoding,
  setDecodeTarget,
  type DecodeTarget,
  type Decoder,
} from '../../lib/decoding-settings.ts';
import { classMode, withClassMode, type ClassMode } from './engines.ts';
import { Choice, Row } from './Parts.tsx';
import { isPosition, selectedBehaviors } from './state.ts';

/** Several behaviors, or one behavior against Other: derived from the behavior and Other settings. */
export const classKind = (): ClassMode => classMode(selectedBehaviors(), behaviorDecoding.other);

function Card(props: {
  checked: boolean;
  title: string;
  text: string;
  icon?: JSX.Element;
  onPick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      class="cb-dg-card"
      classList={{ 'cb-dg-card--on': props.checked }}
      onClick={() => props.onPick()}
    >
      <span class="cb-dg-card__head">
        <span class="cb-dg-card__radio" aria-hidden="true" />
        {props.icon}
        <b>{props.title}</b>
      </span>
      <span class="cb-dg-card__text">{props.text}</span>
    </button>
  );
}

const PositionIcon = () => (
  <svg viewBox="0 0 28 18" width="28" height="18" aria-hidden="true" class="cb-dg-icon">
    <path
      d="M2 14 C6 2, 10 2, 14 9 S22 16, 26 4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
    <circle cx="26" cy="4" r="2.5" fill="currentColor" />
  </svg>
);
const BehaviorIcon = () => (
  <svg viewBox="0 0 28 18" width="28" height="18" aria-hidden="true" class="cb-dg-icon">
    <rect x="2" y="9" width="9" height="5" fill="#9ca3af" />
    <rect x="11" y="9" width="8" height="5" fill="currentColor" />
    <rect x="19" y="9" width="7" height="5" fill="#9ca3af" />
    <path d="M4 2v5M8 3v4M13 2v5M17 3v4M22 2v5" stroke="currentColor" stroke-width="1.5" />
  </svg>
);

const TARGET_CARDS: [DecodeTarget, string, string, () => JSX.Element][] = [
  [
    'position',
    'Position',
    'Predict where the animal is in the arena from the events of all cells.',
    PositionIcon,
  ],
  [
    'behaviors',
    'Behavior',
    'Predict which annotated behavior is occurring from the events of all cells.',
    BehaviorIcon,
  ],
];

/** What would you like to predict: Position or Behavior. */
export function TargetCards(): JSX.Element {
  return (
    <div class="cb-dg-cards" role="radiogroup" aria-label="Decoding target">
      <For each={TARGET_CARDS}>
        {([t, title, text, Icon]) => (
          <Card
            checked={decodeTarget.type === t}
            title={title}
            text={text}
            icon={<Icon />}
            onPick={() => setDecodeTarget('type', t)}
          />
        )}
      </For>
    </div>
  );
}

const DECODER_CARDS: [Decoder, string, string][] = [
  [
    'bayesian',
    'Bayesian',
    'Each frame is assigned the most probable class given the events of all cells in a window around it, using maps learned from the training folds.',
  ],
  [
    'logistic',
    'Logistic regression',
    'A logistic regression on the standardized event counts of all cells in each time bin, trained on the training folds and scored on the held-out fold. Behaviors only.',
  ],
];

/** Decoder cards: only the decoders the chosen target supports. */
export function DecoderCards(): JSX.Element {
  return (
    <div class="cb-dg-cards" role="radiogroup" aria-label="Decoder">
      <For each={DECODER_CARDS}>
        {([d, title, text]) => (
          <Show when={!isPosition() || d === 'bayesian'}>
            <Card
              checked={isPosition() ? d === 'bayesian' : behaviorDecoding.decoder === d}
              title={title}
              text={text}
              onPick={() => !isPosition() && setBehaviorDecoding('decoder', d)}
            />
          </Show>
        )}
      </For>
    </div>
  );
}

/** How classes are formed: several behaviors, or one behavior against Other (all other included frames). */
export function ClassModeRow(): JSX.Element {
  return (
    <Row
      label="Classes"
      tip="Several behaviors: each selected behavior is a class. One behavior vs Other: the chosen behavior against every other included frame, those covered by none of the selected behaviors."
    >
      <Choice
        label="Classes"
        value={classKind()}
        options={[
          { value: 'several', label: 'Several behaviors' },
          { value: 'one_vs_other', label: 'One behavior vs Other' },
        ]}
        onSet={(m) => {
          const next = withClassMode(m, selectedBehaviors(), populationContext().labels.behaviors);
          setBehaviorDecoding('labels', next.labels);
          setBehaviorDecoding('other', next.other);
        }}
      />
    </Row>
  );
}
