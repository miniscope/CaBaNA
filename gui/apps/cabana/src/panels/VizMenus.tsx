// The Display and Tracks pop-ups of Data visualization. View settings only: they change what is
// drawn, never the data or results. Groups of settings sit under small underlined tabs; small
// choices are segmented controls.

import { createSignal, For, Show, type JSX } from 'solid-js';
import {
  behaviorCount,
  groups,
  intensity,
  isolateBehavior,
  setIntensity,
  setShown,
  shown,
  showAll,
} from '../lib/overlay-state.ts';
import { coverageText, type Intensity } from '../lib/overlays.ts';
import {
  colorOf,
  heat,
  isOn,
  pos,
  rows,
  setChoice,
  setHeatSrc,
  setTracksAnchor,
  SOURCE_LABEL,
  sources,
} from '../lib/viz-tracks.ts';
import { Popover } from './Popover.tsx';

/** Small underlined tabs; nothing is drawn for a single tab. */
function UTabs<T extends string>(props: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}): JSX.Element {
  return (
    <Show when={props.tabs.length > 1}>
      <div class="cb-utabs" role="tablist" aria-label={props.label}>
        <For each={props.tabs}>
          {(t) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.value === t.id}
              classList={{ 'cb-utabs--on': props.value === t.id }}
              onClick={() => props.onPick(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

/** A setting's name in small caps, then its control. */
const Setting = (props: { name: string; children: JSX.Element }): JSX.Element => (
  <div class="cb-dctl">
    <span class="sc">{props.name}</span>
    <div>{props.children}</div>
  </div>
);

function Seg<T extends string>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onPick: (v: T) => void;
}): JSX.Element {
  return (
    <div class="cb-ds-seg" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(o) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            classList={{ 'cb-ds-seg--on': props.value === o.value }}
            onClick={() => props.onPick(o.value)}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}

const Head = (props: { title: string }): JSX.Element => (
  <div class="cb-pop__head cb-dpop__head">
    <strong>{props.title}</strong>
    <span class="cb-muted">View only. Data and results do not change.</span>
  </div>
);

const Check = (props: { k: string; rank?: number; name: string; color?: string }): JSX.Element => (
  <label class="cb-trackopt">
    <input
      type="checkbox"
      checked={isOn(props.k, props.rank)}
      onChange={(e) => setChoice(props.k, e.currentTarget.checked)}
    />
    <Show when={props.color}>
      <i style={{ background: props.color }} />
    </Show>
    {props.name}
  </label>
);

type TrackTab = 'Behavior' | 'Zone' | 'Position';
const [trackTab, setTrackTab] = createSignal<TrackTab>('Behavior');

/** The rows of the behavior and position timeline, each with a checkbox, one tab per kind. */
export function TracksMenu(props: { anchor: HTMLElement }): JSX.Element {
  const tabs = () =>
    [
      rows().some((r) => r.kind === 'Behavior') && { id: 'Behavior' as const, label: 'Behavior' },
      rows().some((r) => r.kind === 'Zone') && { id: 'Zone' as const, label: 'Zones' },
      pos() && { id: 'Position' as const, label: 'Position' },
    ].filter((t) => !!t);
  const tab = () => (tabs().some((t) => t.id === trackTab()) ? trackTab() : tabs()[0]?.id);
  return (
    <Popover anchor={props.anchor} onClose={() => setTracksAnchor()} width={300} label="Tracks">
      <Head title="Tracks" />
      <UTabs label="Kind of track" tabs={tabs()} value={tab()!} onPick={setTrackTab} />
      <Show when={!tabs().length}>
        <p class="cb-muted">Load behavior annotations, zones or position to choose tracks.</p>
      </Show>
      <div class="cb-trackgroup">
        <For each={rows()}>
          {(r, i) => (
            <Show when={r.kind === tab()}>
              <Check k={r.key} rank={i()} name={r.name} color={r.color} />
            </Show>
          )}
        </For>
        <Show when={tab() === 'Position'}>
          <Check k="position" name="Position (x, y)" />
          <Check k="speed" name="Speed" />
        </Show>
      </div>
    </Popover>
  );
}

const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'strong', label: 'Strong' },
];

/** Which behaviors are shaded over the plots, grouped by annotation file. */
function Overlays(): JSX.Element {
  return (
    <Show
      when={behaviorCount() > 0}
      fallback={<p class="cb-muted">Load behavior annotations to shade bouts over the plots.</p>}
    >
      <Setting name="Intensity">
        <Seg
          label="Overlay intensity"
          options={INTENSITIES}
          value={intensity()}
          onPick={setIntensity}
        />
      </Setting>
      <Setting name="Behaviors">
        <span class="cb-ovl__all">
          <button type="button" class="cb-link" onClick={() => showAll(true)}>
            Show all
          </button>
          <button type="button" class="cb-link" onClick={() => showAll(false)}>
            Hide all
          </button>
        </span>
      </Setting>
      <For each={groups()}>
        {(g) => (
          <div class="cb-trackgroup">
            <div class="cb-muted" title={g.name}>
              {g.name} · {coverageText(g.coverage)}
              <Show when={g.startsOff}> · starts hidden, covers most of the session</Show>
            </div>
            <For each={g.behaviors}>
              {(b) => (
                <div class="cb-ovl__row">
                  <label class="cb-trackopt">
                    <input
                      type="checkbox"
                      checked={shown().has(b.name)}
                      onChange={(e) => setShown(b.name, e.currentTarget.checked)}
                    />
                    <i style={{ background: colorOf(b.name) }} />
                    <span class="cb-ovl__name" title={b.name}>
                      {b.name}
                    </span>
                    <span class="cb-muted">
                      {b.bouts} {b.bouts === 1 ? 'bout' : 'bouts'} · {Math.round(b.seconds)} s
                    </span>
                  </label>
                  <button
                    type="button"
                    class="cb-link"
                    aria-label={`Show only ${b.name}`}
                    onClick={() => isolateBehavior(b.name)}
                  >
                    Only
                  </button>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
      <p class="cb-muted cb-ovl__note">
        Shaded regions mark behavioral bouts aligned to the neural data. Hiding a behavior removes
        its shading only; the data, analyses and timeline rows are unchanged.
      </p>
    </Show>
  );
}

type DisplayTab = 'heat' | 'overlays';
const [displayTab, setDisplayTab] = createSignal<DisplayTab>('heat');
const DISPLAY_TABS: { id: DisplayTab; label: string }[] = [
  { id: 'heat', label: 'Heat map' },
  { id: 'overlays', label: 'Behavior overlays' },
];

/** How the neural data is shown: the heat map's signal and the shaded behaviors. */
export function DisplayMenu(props: { anchor: HTMLElement; onClose: () => void }): JSX.Element {
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} width={360} label="Neural display">
      <Head title="Neural display" />
      <UTabs
        label="Display settings"
        tabs={DISPLAY_TABS}
        value={displayTab()}
        onPick={setDisplayTab}
      />
      <Show when={displayTab() === 'heat'} fallback={<Overlays />}>
        <Show
          when={sources().length}
          fallback={<p class="cb-muted">Load neural data to see the heat map.</p>}
        >
          <Setting name="Signal">
            <Seg
              label="Heat map signal"
              options={sources().map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
              value={heat()}
              onPick={setHeatSrc}
            />
          </Setting>
          <p class="cb-muted cb-ovl__note">
            Each cell is colored from its own 5th to 99.5th percentile over the session, so cells
            with different ranges can be compared by timing, not by amplitude.
          </p>
        </Show>
      </Show>
    </Popover>
  );
}
