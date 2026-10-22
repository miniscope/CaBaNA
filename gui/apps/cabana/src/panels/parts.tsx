// Pieces shared by the Data QC sections.

import { createSignal, For, Show, untrack, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Check } from '../lib/qc.ts';
import {
  DEFAULT_TOL,
  cell,
  proceed,
  selectCell,
  setProceed,
  setTol,
  tol,
  type Section,
} from '../lib/store.ts';

const ICON = { pass: '✓', warn: '!', fail: '✕' };

export function Checks(props: { title?: string; checks: Check[]; id?: string }): JSX.Element {
  return (
    <Show when={props.checks.length}>
      <section class="cb-group" id={props.id}>
        <Show when={props.title}>
          <h3>{props.title}</h3>
        </Show>
        <For each={props.checks}>
          {(c) => (
            <div class={`cb-check cb-check--${c.status}`}>
              <span class="cb-check__icon" aria-hidden="true">
                {ICON[c.status]}
              </span>
              <div>
                <div class="cb-row__title">{c.title}</div>
                <div class="cb-row__sub">{c.detail}</div>
                <Show when={c.pairs?.length}>
                  <div class="cb-pairs">
                    <For each={c.pairs}>
                      {(p) => (
                        <span>
                          <button onClick={() => jumpTo(p.a, p.b)}>{p.a + 1}</button>
                          {' and '}
                          <button onClick={() => jumpTo(p.b, p.a)}>{p.b + 1}</button> ({p.note})
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}

function jumpTo(a: number, partner: number): void {
  selectCell(a, partner);
  document.getElementById('cb-cells')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export type TolKey = keyof typeof tol;

/** What each QC parameter is, why it is checked, and what a failure does to results. */
export const TOL_INFO: Record<
  TolKey,
  { label: string; unit: string; step: number; why: string; ifFails: string }
> = {
  lostPct: {
    label: 'Lost position frames',
    unit: '% of frames',
    step: 1,
    why: 'Position places the animal in the arena at every neural frame. A frame the tracker lost has no position.',
    ifFails:
      'Place and speed measures use fewer frames. If the losses cluster in one part of the arena or one part of the session, those places or times are under-sampled, which biases occupancy maps and place fields.',
  },
  jumpPct: {
    label: 'Jump steps',
    unit: '% of steps',
    step: 0.01,
    why: 'An animal cannot move faster than about 60 cm/s between frames. A faster step means the tracker lost the animal, locked onto a reflection, or swapped identity.',
    ifFails:
      'One jump draws a false path across the arena. It inflates speed and distance and smears place fields over places the animal never visited.',
  },
  annotPct: {
    label: 'Problem epochs',
    unit: '% of epochs',
    step: 1,
    why: 'Epochs that end before they start, fall outside the session, or overlap another epoch with the same label are mistakes in the annotation file.',
    ifFails:
      'CaBaNA turns epochs into a label for every frame. Mistakes put the label on the wrong frames, which blurs or shifts the neural response to that behavior.',
  },
  poorCellPct: {
    label: 'Flagged cells',
    unit: '% of cells',
    step: 1,
    why: 'Cells are flagged for low signal to noise, strong correlation with a neighbor, or too few or too many events. Flagged cells can be rejected one by one, so this is the share of cells at which the whole dataset is judged poor.',
    ifFails:
      'Noisy cells add random variation that weakens real effects. A cell split in two counts one neuron twice, which makes responses look more common and population results more consistent than they are. Cells with no events, or events on most frames, give unreliable tuning.',
  },
  overlapPct: {
    label: 'Overlapping footprint pairs',
    unit: '% of cells',
    step: 1,
    why: 'Footprints that share most of their pixels usually mean one cell was split in two, or that two cells contaminate each other.',
    ifFails:
      'Cells that share pixels share signal, so the same activity is counted twice. This biases correlations, population analyses and decoding.',
  },
  riseLowPct: {
    label: 'Cells whose events sit at noise level',
    unit: '% of cells',
    step: 1,
    why: 'After a real event the fluorescence rises. For these cells it barely does, so their events line up with noise.',
    ifFails:
      'Events that are really noise make a cell look active at random times, which dilutes tuning and inflates event counts.',
  },
  minBoutS: {
    label: 'Shortest bout kept',
    unit: 's',
    step: 0.05,
    why: 'A bout this short covers only a few frames (at 30 Hz, 0.1 s is 3 frames). Some behaviors really are brief, so the default is small.',
    ifFails:
      'A slip of a frame or two in manual scoring is a large share of a very short bout, so its label may sit on the wrong frames. The neural average over so few frames is also hard to tell from noise, so short bouts add noise to the response for that behavior.',
  },
  mergeGapS: {
    label: 'Shortest gap between bouts of one label',
    unit: 's',
    step: 0.1,
    why: 'Two bouts with the same label that overlap or sit this close together are usually one bout split by a pause in scoring.',
    ifFails:
      'One response is cut in two, and the frames in the gap count as not showing the behavior. Overlapping epochs would count the same frames twice.',
  },
  minPve: {
    label: 'Least variance explained',
    unit: '%',
    step: 5,
    why: 'Reconvolving the events with the indicator kernel should rebuild the trace. If it explains little, the events do not match the data: the kernel is wrong or the events are fitting noise.',
    ifFails:
      'Event timing and size are unreliable. Anything built on events, such as tuning and decoding, is less accurate, and a wrong kernel shifts event times.',
  },
};

/** The numbers a QC section uses to decide pass or fail, with the reason for each and a reset to the defaults. */
function QcParameters(props: { keys: TolKey[] }): JSX.Element {
  const [draft, setDraft] = createStore<Partial<Record<TolKey, number>>>(
    untrack(() => Object.fromEntries(props.keys.map((k) => [k, tol[k]]))),
  );
  const [saved, setSaved] = createSignal(false);
  const changed = () => props.keys.some((k) => tol[k] !== DEFAULT_TOL[k]);
  const apply = (values: Partial<Record<TolKey, number>>) => {
    props.keys.forEach((k) => setTol(k, values[k] ?? tol[k]));
    setSaved(true);
  };
  return (
    <details class="cb-params">
      <summary>QC parameters {changed() ? '(changed from the defaults)' : '(defaults)'}</summary>
      <p class="cb-muted">
        These numbers set what the checks flag and when a section fails. Change a number, then press
        Set parameters.
      </p>
      <For each={props.keys}>
        {(k) => (
          <div class="cb-param">
            <label>
              {TOL_INFO[k].label}
              <input
                type="number"
                min="0"
                step={TOL_INFO[k].step}
                value={draft[k]}
                onInput={(e) => {
                  setDraft(k, Math.max(0, +e.currentTarget.value));
                  setSaved(false);
                }}
              />
              {TOL_INFO[k].unit}
              <span class="cb-muted"> default {DEFAULT_TOL[k]}</span>
            </label>
            <details>
              <summary>Why this is checked, and what a failure does</summary>
              <p>
                <b>Why:</b> {TOL_INFO[k].why}
              </p>
              <p>
                <b>If the data fails:</b> {TOL_INFO[k].ifFails}
              </p>
            </details>
          </div>
        )}
      </For>
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => apply(draft)}>
          Set parameters
        </button>
        <button
          class="btn-secondary btn-small"
          onClick={() => {
            props.keys.forEach((k) => setDraft(k, DEFAULT_TOL[k]));
            apply(DEFAULT_TOL);
          }}
        >
          Reset to defaults
        </button>
        <Show when={saved()}>
          <span class="cb-muted">Applied.</span>
        </Show>
      </div>
    </details>
  );
}

/**
 * The result of a QC section, shown first: passed, passed with notes, or failed and why, then what to do.
 * `children` holds the fixes CaBaNA can make itself. The user can always continue without one.
 */
export function QcVerdict(props: {
  section: Section;
  title: string;
  checks: Check[];
  allowed: TolKey[];
  children?: JSX.Element;
}): JSX.Element {
  const failing = () => props.checks.filter((c) => c.status === 'fail');
  const notes = () => props.checks.filter((c) => c.status === 'warn');
  const state = () => (failing().length ? 'fail' : notes().length ? 'warn' : 'pass');
  const advice = () => [...failing(), ...notes()].filter((c) => c.fix);
  return (
    <Show when={props.checks.length}>
      <div class={`cb-verdict cb-verdict--${state()}`} id={`qc-${props.section}`}>
        <div class="cb-verdict__head">
          <span class="cb-check__icon" aria-hidden="true">
            {ICON[state()]}
          </span>
          <strong>{props.title}:</strong>{' '}
          {state() === 'fail' ? 'Failed' : state() === 'warn' ? 'Passed, with notes' : 'Passed'}
        </div>
        <QcParameters keys={props.allowed} />
        <Show when={failing().length}>
          <div class="cb-verdict__label">Why it failed</div>
          <ul>
            <For each={failing()}>
              {(c) => (
                <li>
                  <b>{c.title}.</b> {c.detail}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={notes().length}>
          <div class="cb-verdict__label">Notes</div>
          <ul>
            <For each={notes()}>
              {(c) => (
                <li>
                  <b>{c.title}.</b> {c.detail}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={advice().length || props.children}>
          <div class="cb-verdict__label">
            {state() === 'pass' ? 'Optional fixes' : 'What to do'}
          </div>
          <ol>
            <For each={advice()}>{(c) => <li>{c.fix}</li>}</For>
          </ol>
          {props.children}
        </Show>
        <Show when={failing().length}>
          <div class="cb-verdict__actions">
            <Show
              when={proceed[props.section]}
              fallback={
                <button class="btn-secondary" onClick={() => setProceed(props.section, true)}>
                  Continue without correction
                </button>
              }
            >
              <span class="cb-muted">Continuing with these issues.</span>{' '}
              <button class="cb-link" onClick={() => setProceed(props.section, false)}>
                Undo
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** Previous, next and a number box for the selected cell. */
export function CellPicker(props: { n: number; children?: JSX.Element }): JSX.Element {
  return (
    <div class="cb-cellbar">
      <button class="btn-secondary btn-small" onClick={() => selectCell(Math.max(0, cell() - 1))}>
        Previous
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
        onClick={() => selectCell(Math.min(props.n - 1, cell() + 1))}
      >
        Next
      </button>
      {props.children}
    </div>
  );
}

/** Collapsed explanation. Every section uses the same title so notes are easy to spot. */
export function Note(props: { children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox">
      <summary>Note</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}

/** Marks a required field. */
export const Req = (): JSX.Element => (
  <span class="cb-star" title="Required">
    *
  </span>
);

/** Collapsed, plot-specific explanation placed under a figure. */
export function HowToRead(props: { children: JSX.Element }): JSX.Element {
  return (
    <details class="cb-notebox cb-howto">
      <summary>How to read this plot</summary>
      <div class="cb-muted">{props.children}</div>
    </details>
  );
}
