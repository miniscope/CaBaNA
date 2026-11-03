// Small pieces shared by several panels.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { shuffleReachIssues } from '../lib/shuffle-reach.ts';
import { PopButton } from './QcParts.tsx';
import { cell, selectCell } from '../lib/store.ts';

/** Previous, next and a number box for the selected cell. `compact` uses arrows, for a plot's title row. */
export function CellPicker(props: {
  n: number;
  compact?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-cellbar" classList={{ 'cb-cellbar--compact': props.compact }}>
      <button
        class="btn-secondary btn-small"
        aria-label="Previous cell"
        onClick={() => selectCell(Math.max(0, cell() - 1))}
      >
        {props.compact ? '‹' : 'Previous'}
      </button>
      <span>
        Cell{' '}
        <input
          type="number"
          min="1"
          max={props.n}
          value={cell() + 1}
          onInput={(e) =>
            selectCell(Math.min(props.n - 1, Math.max(0, +e.currentTarget.value - 1)))
          }
        />{' '}
        of {props.n}
      </span>
      <button
        class="btn-secondary btn-small"
        aria-label="Next cell"
        onClick={() => selectCell(Math.min(props.n - 1, cell() + 1))}
      >
        {props.compact ? '›' : 'Next'}
      </button>
      {props.children}
    </div>
  );
}

/**
 * Opens the explanation as a floating panel next to its summary, above or below depending on the
 * space, so that reading a note never pushes the page content or adds a scrollbar.
 */
export function placePopover(event: Event): void {
  const details = event.currentTarget as HTMLDetailsElement;
  const panel = details.querySelector<HTMLElement>(':scope > div');
  if (!details.open || !panel) return;
  const anchor = details.querySelector('summary')!.getBoundingClientRect();
  const below = innerHeight - anchor.bottom - 12;
  const above = anchor.top - 12;
  const useBelow = below >= Math.min(220, above);
  const width = Math.min(440, innerWidth - 24);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - width - 12))}px`;
  panel.style.maxHeight = `${Math.max(120, useBelow ? below : above)}px`;
  panel.style.top = useBelow ? `${anchor.bottom + 4}px` : '';
  panel.style.bottom = useBelow ? '' : `${innerHeight - anchor.top + 4}px`;
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent ? e.key !== 'Escape' : details.contains(e.target as Node))
      return;
    details.open = false;
    document.removeEventListener('pointerdown', close);
    document.removeEventListener('keydown', close);
  };
  document.addEventListener('pointerdown', close);
  document.addEventListener('keydown', close);
}

/** Explanation that opens as a popover. Titled "Note" unless a section needs a more specific title. */
export function Note(props: { title?: string; children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox cb-notepop" onToggle={placePopover}>
      <summary>{props.title ?? 'Note'}</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}

/** Plot-specific explanation placed under a figure; opens as a popover. */
export function HowToRead(props: { children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox cb-howto cb-notepop" onToggle={placePopover}>
      <summary>How to read this plot</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}

/**
 * The minimum speed (cm/s). One value, `prep.minSpeed`, is shared by Place cells and position
 * decoding, so editing it here changes it for both. auROC has its own value.
 */
export function SpeedFilterField(): JSX.Element {
  return (
    <label
      class="cb-prep-field"
      classList={{ 'cb-prep-field--changed': prep.minSpeed !== DEFAULT_PREP.minSpeed }}
    >
      <input
        type="number"
        min="0"
        step="0.5"
        value={prep.minSpeed}
        onInput={(e) => setPrep('minSpeed', Math.max(0, +e.currentTarget.value || 0))}
      />
      cm/s <span class="cb-muted">default {DEFAULT_PREP.minSpeed}</span>
    </label>
  );
}

/**
 * Why the shuffle test cannot mark anything significant at this shuffle count and alpha, for the
 * full run and, when offered, the Quick preview. Nothing when both can. Observed values are still
 * computed, so the run is not blocked.
 */
export function ShuffleReach(props: { shuffles: number; alpha: number; preview?: boolean }) {
  return (
    <For each={shuffleReachIssues(props.shuffles, props.alpha, props.preview ?? true)}>
      {(text) => <span class="cb-pe-warn">⚠ {text}</span>}
    </For>
  );
}

/**
 * Advanced options with the random seed: the same control on every analysis page. Only a whole
 * number from 0 is stored; anything else is marked and the button keeps showing the seed in use.
 */
export function AdvancedSeed(props: {
  seed: number;
  def: number;
  onSet: (v: number) => void;
  children?: JSX.Element;
}): JSX.Element {
  const [bad, setBad] = createSignal(false);
  return (
    <PopButton
      label="Advanced options"
      title="Advanced options"
      width={340}
      class="btn-secondary btn-small cb-as-adv"
      button={
        <>
          Advanced options… <span class="cb-muted">seed {props.seed}</span>
        </>
      }
    >
      <div class="cb-setting">
        <label
          class="cb-prep-field"
          classList={{
            'cb-prep-field--changed': props.seed !== props.def,
            'cb-pe-bad': bad(),
          }}
        >
          Random seed
          <input
            type="number"
            min="0"
            step="1"
            aria-label="Random seed"
            aria-invalid={bad() || undefined}
            value={props.seed}
            onInput={(e) => {
              const t = e.currentTarget.value;
              const v = +t;
              const ok = t !== '' && Number.isInteger(v) && v >= 0;
              setBad(!ok);
              if (ok) props.onSet(v);
            }}
          />
        </label>
        <Show when={bad()}>
          <p class="cb-error">
            The seed must be a whole number from 0; the seed in use is {props.seed}.
          </p>
        </Show>
        <p class="cb-muted">
          Controls the random shuffles: the same seed, settings and data give the same shuffles and
          results. Saved with every run.
        </p>
      </div>
      {props.children}
    </PopButton>
  );
}
