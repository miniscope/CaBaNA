// The Preprocess help drawer: one panel beside the plots, with a tab for each plot of the current
// step and one for the step itself.

import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { StepId } from '../lib/prep-deps.ts';
import { STEP_HELP } from '../lib/prep-help.ts';
import { helpTab, PLOT_TITLE, setHelpTab, STEP_PLOTS, type PlotId } from '../lib/prep-view.ts';
import { STEPS } from '../lib/prep-deps.ts';
import { Help } from './QcParts.tsx';

let opener: HTMLElement | null = null;

/** Opens the drawer on a tab. Closing returns focus to the control that opened it. */
export function openHelp(tab: 'about' | PlotId) {
  if (!helpTab()) opener = document.activeElement as HTMLElement | null;
  setHelpTab(tab);
}

function closeHelp() {
  setHelpTab(undefined);
  opener?.focus();
  opener = null;
}

const TIME = 'Time in s on the session clock.';
const POS =
  'Position in cm, in the arena frame when the arena is set up in Experimental Setup, otherwise in cm from the position file.';
const ZOOM = 'Scroll to zoom and drag to pan. Window, Previous and Next set the time range.';

const NOTES: Record<PlotId, Record<'shows' | 'axes' | 'lines' | 'interact' | 'limits', string>> = {
  events: {
    shows:
      'The deconvolved events of the selected cell in the preview window, before and after event smoothing.',
    axes: `${TIME} Events in the deconvolved file's units.`,
    lines: 'Gray: events as loaded. Orange: events after smoothing.',
    interact: `${ZOOM} The cell controls change the cell.`,
    limits: 'One cell at a time. With smoothing off, the two lines are the same.',
  },
  fillPos: {
    shows:
      'The x position on the neural frames in the preview window, as it is before gap filling, and the frames that filling adds. Position is shown before position smoothing.',
    axes: `${TIME} x position: ${POS}`,
    lines:
      'Gray: position before filling, with a break wherever it is missing. Blue dashed: the filled frames, joined to the tracked frame on each side.',
    interact: `${ZOOM} Previous gap and Next gap center the window on a missing stretch.`,
    limits:
      'Only x is drawn; the trajectory shows x and y. A missing stretch that is not filled stays a break in the gray line.',
  },
  traj: {
    shows:
      'The path in the preview window, x against y. Position is shown before position smoothing.',
    axes: `x and y in cm, drawn at the same scale. ${POS}`,
    lines:
      'Gray: position before filling, with a break at each missing frame. Blue: the segments that filling adds.',
    interact:
      'Window, Previous and Next set the time range. Previous gap and Next gap center the window on a missing stretch.',
    limits: 'Lines that overlap do not show how long the animal stayed in a place.',
  },
  smoothPos: {
    shows:
      'The x position on the neural frames in the preview window, before and after position smoothing. Before is after gap filling, when that step is on.',
    axes: `${TIME} x position: ${POS}`,
    lines: 'Gray: before smoothing. Blue: after smoothing.',
    interact: `${ZOOM} The cursor is shared with the speed plot.`,
    limits:
      'Only x is drawn. Missing frames are breaks in the line. With smoothing off, the two lines are the same.',
  },
  smoothSpeed: {
    shows:
      'Speed on the neural frames in the preview window, computed from position before smoothing and from position after it.',
    axes: `${TIME} Speed in cm/s.`,
    lines:
      'Gray: speed from position before smoothing. Green: speed from position after smoothing.',
    interact: `${ZOOM} The cursor is shared with the position plot.`,
    limits: 'Speed is missing where either frame it is computed from has no position.',
  },
  labels: {
    shows:
      'For each behavior, the frames inside its scored bouts in the preview window, and, with bout padding, the frame labels after widening.',
    axes: `${TIME} One row per behavior; a filled block is a frame inside a bout.`,
    lines:
      'One color per behavior. With padding, the top row is as scored and the bottom row is as frame labels.',
    interact: 'Window, Previous and Next set the time range.',
    limits:
      'Only the preview window is drawn. Overlapping bouts of different behaviors appear in separate rows.',
  },
  onFrames: {
    shows:
      'The x position on the neural frames in the preview window, after interpolation from the camera times. Position is shown before gap filling and smoothing.',
    axes: `${TIME} x position: ${POS}`,
    lines: 'Blue: x position. A break is a frame with no position.',
    interact: ZOOM,
    limits: 'Only x is drawn.',
  },
  speed: {
    shows:
      'Speed on the neural frames in the preview window, from position after any gap filling and smoothing.',
    axes: `${TIME} Speed in cm/s.`,
    lines: 'Green: speed. Red dashed: the shared speed filter, drawn when it is above 0.',
    interact: ZOOM,
    limits: 'Speed is missing where either frame it is computed from has no position.',
  },
};

const KEYS = {
  shows: 'Shows',
  axes: 'Axes',
  lines: 'Lines',
  interact: 'Interact',
  limits: 'Limits',
} as const;

/** The "How to read this plot" text of one plot. */
export function PlotNote(props: { id: PlotId }): JSX.Element {
  return (
    <For each={Object.keys(KEYS) as (keyof typeof KEYS)[]}>
      {(k) => <Help k={KEYS[k]}>{NOTES[props.id][k]}</Help>}
    </For>
  );
}

const SECTIONS: {
  key: 'what' | 'why' | 'leaveOff' | 'adjust' | 'tradeoffs' | 'default';
  title: string;
}[] = [
  { key: 'what', title: 'What it does' },
  { key: 'why', title: 'Consider it when' },
  { key: 'leaveOff', title: 'Leave it off when' },
  { key: 'adjust', title: 'How to adjust' },
  { key: 'tradeoffs', title: 'Tradeoffs' },
  { key: 'default', title: 'Default' },
];
const GUIDANCE = new Set(['why', 'leaveOff', 'adjust']);

export function HelpDrawer(props: { step: StepId }): JSX.Element {
  let close!: HTMLButtonElement;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('.cb-overlay')) closeHelp();
  };
  onMount(() => {
    close.focus();
    document.addEventListener('keydown', key);
  });
  onCleanup(() => document.removeEventListener('keydown', key));
  const tabs = () => [
    { id: 'about' as const, label: 'About this step' },
    ...(STEP_PLOTS[props.step] ?? []).map((id) => ({ id, label: PLOT_TITLE[id] })),
  ];
  const help = () => STEP_HELP[props.step];
  return (
    <aside class="cb-prep-help" role="dialog" aria-label={`Help: ${STEPS[props.step].label}`}>
      <div class="cb-prep-help__head">
        <strong>{STEPS[props.step].label}</strong>
        <button ref={close} type="button" class="cb-ib" aria-label="Close help" onClick={closeHelp}>
          ✕
        </button>
      </div>
      <div class="cb-prep-help__tabs" role="tablist" aria-label="Help topics">
        <For each={tabs()}>
          {(t) => (
            <button
              type="button"
              role="tab"
              aria-selected={helpTab() === t.id}
              classList={{ 'cb-prep-help__tab--on': helpTab() === t.id }}
              onClick={() => setHelpTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div class="cb-prep-help__body" role="tabpanel">
        <Show
          when={helpTab() !== 'about' && (helpTab() as PlotId | undefined)}
          fallback={
            <Show when={help()}>
              <For each={SECTIONS}>
                {(s) => (
                  <Show when={help()![s.key]}>
                    <h4>{s.title}</h4>
                    <Show when={GUIDANCE.has(s.key)}>
                      <div class="cb-muted cb-prep-help__guide">Guidance, not a rule</div>
                    </Show>
                    <p>{help()![s.key]}</p>
                  </Show>
                )}
              </For>
            </Show>
          }
        >
          {(id) => <PlotNote id={id()} />}
        </Show>
      </div>
    </aside>
  );
}
