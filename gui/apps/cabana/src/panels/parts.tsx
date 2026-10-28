// Small pieces shared by several panels.

import type { JSX } from 'solid-js';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
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

/** Collapsed explanation. Titled "Note" unless a section needs a more specific title. */
export function Note(props: { title?: string; children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox">
      <summary>{props.title ?? 'Note'}</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}

/** Collapsed, plot-specific explanation placed under a figure. */
export function HowToRead(props: { children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox cb-howto">
      <summary>How to read this plot</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}

/**
 * The minimum speed (cm/s). One value, `prep.minSpeed`, is shared by every analysis that filters
 * on speed, so editing it here changes it for all of them. Place cells always apply it; auROC
 * only when its own speed filter is ticked.
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
