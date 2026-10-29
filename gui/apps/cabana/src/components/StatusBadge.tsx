import { createSignal, For, Show, type JSX } from 'solid-js';
import { Popover } from '../panels/Popover.tsx';
import { STATUS_ICON, TONE_TEXT, type Status, type Tone } from '../lib/readiness.ts';

const PATHS: Record<string, JSX.Element> = {
  circle: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5" />,
  dash: <path d="M4 8h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />,
  alert: (
    <>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M8 4.5v4M8 11v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </>
  ),
  wrench: (
    <path
      d="M10.5 2.5a3 3 0 0 0-2.7 4L2.5 11.8l1.7 1.7 5.3-5.3a3 3 0 0 0 4-2.7l-1.8 1.8-1.7-.4-.4-1.7z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linejoin="round"
    />
  ),
  play: (
    <path
      d="M5.5 3.5v9l7-4.5z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
  ),
  spinner: (
    <path
      d="M8 2a6 6 0 1 0 6 6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  ),
  check: (
    <path
      d="M3.5 8.5l3 3 6-6.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  ),
  refresh: (
    <path
      d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  ),
  x: (
    <path
      d="M4.5 4.5l7 7M11.5 4.5l-7 7"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
    />
  ),
};

/** Status icon (decorative: the text always travels with it). */
export function StatusIcon(props: { kind: Status['kind'] }): JSX.Element {
  return (
    <svg
      class="cb-st__icon"
      classList={{ 'cb-st__icon--spin': props.kind === 'running' }}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
    >
      {PATHS[STATUS_ICON[props.kind]]}
    </svg>
  );
}

/** Icon and words side by side; the color follows the kind but never carries the meaning alone. */
export function StatusBadge(props: { status: Status }): JSX.Element {
  return (
    <span class={`cb-st cb-st--${props.status.kind}`}>
      <StatusIcon kind={props.status.kind} />
      <span class="cb-st__text">{props.status.text}</span>
    </span>
  );
}

/** The sidebar's status mark: a different shape per status, so color is not the only cue. */
export function ToneIcon(props: { tone: Tone }): JSX.Element {
  return (
    <svg
      class={`cb-tone cb-tone--${props.tone}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      {props.tone === 'needs_input' ? (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M8 4.7v4M8 10.8v.4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </>
      ) : props.tone === 'outdated' ? (
        <path
          d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      ) : (
        <circle cx="8" cy="8" r="6" fill="currentColor" />
      )}
    </svg>
  );
}

/** The ? beside the sidebar title: opens a legend of the five statuses. */
export function StatusLegend(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="cb-ib cb-legend__btn"
        aria-label="What the status icons mean"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        ?
      </button>
      <Show when={open()}>
        <Popover anchor={btn} onClose={() => setOpen(false)} width={300} label="Status indicators">
          <div class="cb-legend__head">
            <strong>Status indicators</strong>
            <button type="button" class="cb-ib" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <For each={Object.keys(TONE_TEXT) as Tone[]}>
            {(tone) => (
              <div class="cb-legend__row">
                <ToneIcon tone={tone} />
                <div>
                  <strong>{TONE_TEXT[tone].name}</strong>
                  <div class="cb-muted">{TONE_TEXT[tone].meaning}</div>
                </div>
              </div>
            )}
          </For>
        </Popover>
      </Show>
    </>
  );
}
