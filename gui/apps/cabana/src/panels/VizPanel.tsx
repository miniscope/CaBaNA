import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  rawTrace,
  positionResult,
  annotationResults,
  selectCell,
} from '../lib/store.ts';
import { setWinLen, setWinStartClamped, WINDOW_CHOICES, win, winLen } from '../lib/viz.ts';
import {
  colorOf,
  heat,
  isOn,
  pos,
  rows,
  setChoice,
  setHeatSrc,
  setTracksAnchor,
  openTracks,
  SOURCE_LABEL,
  sources,
  tracksAnchor,
  type Source,
} from '../lib/viz-tracks.ts';
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
import { FootprintViewer } from './FootprintViewer.tsx';
import { Popover } from './Popover.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PlotCard } from './QcParts.tsx';
import { ChecksRow, InputsPop, PARTS, Parts, REVIEW } from './VizChecks.tsx';
import { EntryPopup } from './data-setup/EntryView.tsx';
import { InfoTip } from './InfoTip.tsx';
import { arena, pxPerCm } from '../lib/arena.ts';
import { BehaviorRows, NeuralRows } from './SessionView.tsx';
import { SessionNavigator } from './SessionNavigator.tsx';
import { placed, Trajectory } from './Trajectory.tsx';
import { HELP } from './VizHelp.tsx';

const nCells = () =>
  (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? footprints()?.cells ?? 0;
const hasPosition = () => !!positionResult() && 'x' in positionResult()!;

/** Cell number box with arrows: ‹ [number] / N ›. */
function CellBar(): JSX.Element {
  const go = (c: number) => selectCell(Math.min(nCells() - 1, Math.max(0, c)));
  return (
    <div class="cb-cellbar cb-cellbar--compact">
      Cell
      <button
        class="btn-secondary btn-small"
        aria-label="Previous cell"
        onClick={() => go(cell() - 1)}
      >
        Prev
      </button>
      <input
        type="number"
        min="1"
        max={nCells()}
        aria-label="Cell number"
        value={cell() + 1}
        onInput={(e) => go(+e.currentTarget.value - 1)}
      />
      / {nCells()}
      <button class="btn-secondary btn-small" aria-label="Next cell" onClick={() => go(cell() + 1)}>
        Next
      </button>
    </div>
  );
}

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

/** The tracks of the session timeline, each with a checkbox. */
function TracksMenu(props: { anchor: HTMLElement }): JSX.Element {
  const kinds = () => [...new Set(rows().map((r) => r.kind))];
  return (
    <Popover anchor={props.anchor} onClose={() => setTracksAnchor()} width={260} label="Tracks">
      <div class="cb-pop__head">
        <strong>Tracks shown in the session timeline</strong>
      </div>
      <For each={kinds()}>
        {(k) => (
          <div class="cb-trackgroup">
            <div class="cb-muted">{k === 'Zone' ? 'Zones' : 'Behavior'}</div>
            <For each={rows()}>
              {(r, i) => (
                <Show when={r.kind === k}>
                  <Check k={r.key} rank={i()} name={r.name} color={r.color} />
                </Show>
              )}
            </For>
          </div>
        )}
      </For>
      <Show when={pos()}>
        <div class="cb-trackgroup">
          <div class="cb-muted">Position</div>
          <Check k="position" name="Position (x, y)" />
          <Check k="speed" name="Speed" />
        </div>
      </Show>
    </Popover>
  );
}

const [overlaysAnchor, setOverlaysAnchor] = createSignal<HTMLElement>();
const [inputsAnchor, setInputsAnchor] = createSignal<HTMLElement>();

const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'strong', label: 'Strong' },
];

/**
 * How the neural data is shown: the heat map's signal, and which behaviors are shaded over the
 * plots, grouped by annotation file. View only: hiding a behavior changes the shading only.
 */
function DisplayMenu(props: { anchor: HTMLElement }): JSX.Element {
  return (
    <Popover
      anchor={props.anchor}
      onClose={() => setOverlaysAnchor()}
      width={340}
      label="Neural display"
    >
      <Show when={sources().length}>
        <label class="cb-plot__tool cb-disp__row">
          Heat map
          <select value={heat()} onChange={(e) => setHeatSrc(e.currentTarget.value as Source)}>
            <For each={sources()}>{(s) => <option value={s}>{SOURCE_LABEL[s]}</option>}</For>
          </select>
        </label>
      </Show>
      <div class="cb-pop__head">
        <strong>Behavior overlays</strong>
        <span class="cb-ovl__all">
          <button type="button" class="cb-link" onClick={() => showAll(true)}>
            Show all
          </button>
          <button type="button" class="cb-link" onClick={() => showAll(false)}>
            Hide all
          </button>
        </span>
      </div>
      <div class="cb-ovl__intensity" role="radiogroup" aria-label="Overlay intensity">
        Intensity
        <For each={INTENSITIES}>
          {(o) => (
            <label>
              <input
                type="radio"
                name="overlay-intensity"
                checked={intensity() === o.value}
                onChange={() => setIntensity(o.value)}
              />
              {o.label}
            </label>
          )}
        </For>
      </div>
      <Show when={behaviorCount() === 0}>
        <p class="cb-muted">Load behavior annotations to shade bouts over the plots.</p>
      </Show>
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
    </Popover>
  );
}

const WindowControls = (): JSX.Element => {
  const half = () => (win()[1] - win()[0]) / 2;
  return (
    <>
      <label class="cb-plot__tool">
        Window
        <select value={String(winLen())} onChange={(e) => setWinLen(+e.currentTarget.value)}>
          <For each={WINDOW_CHOICES}>
            {(w) => (
              <option value={String(w.s)} selected={w.s === winLen()}>
                {w.label}
              </option>
            )}
          </For>
          <Show when={!WINDOW_CHOICES.some((w) => w.s === winLen())}>
            <option value={String(winLen())} selected>
              {Math.round(winLen())} s (custom)
            </option>
          </Show>
        </select>
      </label>
      <button class="btn-secondary btn-small" onClick={() => setWinStartClamped(win()[0] - half())}>
        Earlier
      </button>
      <button class="btn-secondary btn-small" onClick={() => setWinStartClamped(win()[0] + half())}>
        Later
      </button>
    </>
  );
};

/** Path or time in bin; kept while other pages are visited. */
const [trajMode, setTrajMode] = createSignal<'path' | 'time'>('path');

/** One line under each box title: what it shows, in counts. */
const footprintSummary = (): JSX.Element => (
  <>
    {nCells()} cells · <Parts parts={PARTS.cells()} />
  </>
);
const neuralSummary = () =>
  heat()
    ? `heat map: ${SOURCE_LABEL[heat()!]}, 5th to 99.5th percentile per cell · cell ${cell() + 1} below`
    : 'no neural data';
const arenaSummaryLine = () =>
  arena.box
    ? `${arena.shape} · ${pxPerCm() ? `${pxPerCm()!.toFixed(2)} px/cm` : 'no scale'} · ${arena.zones.length} ${arena.zones.length === 1 ? 'zone' : 'zones'}`
    : 'arena not drawn';
const behaviorSummary = () => {
  const b = rows().filter((r) => r.kind === 'Behavior').length;
  const z = rows().filter((r) => r.kind === 'Zone').length;
  return [
    b && `${b} ${b === 1 ? 'label' : 'labels'}`,
    z && `${z} ${z === 1 ? 'zone' : 'zones'}`,
    pos() && 'position · speed',
  ]
    .filter(Boolean)
    .join(' · ');
};

/** A box's review button; disabled with the reason when the file it opens is not loaded. */
function ReviewButton(props: { kind: keyof typeof REVIEW; label: string }): JSX.Element {
  const open = () => REVIEW[props.kind]();
  return (
    <button
      type="button"
      class="btn-secondary btn-small"
      disabled={!open()}
      title={open() ? undefined : 'The file this review opens is not loaded.'}
      onClick={() => open()?.()}
    >
      {props.label}
    </button>
  );
}

const NEURAL_HELP = (
  <>
    <p>
      Top: every cell over the selected window, one row per cell, colored from each cell's 5th
      (dark) to 99.5th (yellow) percentile over the session. Click a row to select that cell; the
      white tick at the left edge marks it.
    </p>
    <p>
      Below: the selected cell's raw, denoised and deconvolved signals over the same window. Each
      row has its own help marker. Display chooses the heat map's signal and the shaded behaviors.
    </p>
  </>
);
const BEHAVIOR_HELP = (
  <p>
    Behavior labels, zones, time markers, frame labels, position and speed on the same time axis as
    the neural data. Hover over any plot to place the dashed cursor on all of them; the line under
    the plots reads out the time, position and behavior there. Tracks chooses the rows.
  </p>
);

export function VizPanel(): JSX.Element {
  const anything = () =>
    rawTrace() ||
    denoisedTrace() ||
    deconvolved() ||
    footprints() ||
    positionResult() ||
    annotationResults().length;
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-viz" ref={root}>
      <div class="cb-viz__bar">
        <h2>Data visualization</h2>
        <InfoTip label="About Data visualization">
          The loaded data on one shared time window. Selecting a cell (footprints, heat map row or
          the cell field), moving the window (navigator or Earlier and Later) and hovering a time
          plot update every plot. The checks row sums up the quality checks; each chip and Review
          button opens that file's checks and corrections, the same as in Data setup.
        </InfoTip>
        <span class="cb-spacer" />
        <Show when={anything()}>
          <Show when={nCells() > 0}>
            <CellBar />
          </Show>
          <WindowControls />
        </Show>
      </div>
      <Show
        when={anything()}
        fallback={<div class="cb-empty">Load neural or behavior data to see it here.</div>}
      >
        <ChecksRow
          inputsOpen={!!inputsAnchor()}
          onInputs={(el) => setInputsAnchor((a) => (a === el ? undefined : el))}
        />
        <div class="cb-viz__grid">
          <PlotCard
            title="Footprints"
            help={HELP.footprints.text}
            box
            summary={footprintSummary()}
            actions={<ReviewButton kind="footprints" label="Review cells" />}
          >
            {(size) => (
              <Show
                when={footprints()}
                fallback={<div class="cb-note">Load footprints to see the cells' shapes.</div>}
              >
                <div class="cb-fpcard">
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(size().w, size().h - 22))}px`,
                      height: `${Math.max(0, Math.min(size().w, size().h - 22))}px`,
                    }}
                  >
                    <FootprintViewer />
                  </div>
                  <div class="cb-muted">Click a cell to select it. White = selected.</div>
                </div>
              </Show>
            )}
          </PlotCard>
          <div class="cb-viz__stack">
            <section class="cb-plot cb-viz__nav" aria-label="Session navigator">
              <SessionNavigator />
            </section>
            <PlotCard
              title="Neural data"
              help={NEURAL_HELP}
              box
              summary={neuralSummary()}
              actions={
                <>
                  <button
                    type="button"
                    class="btn-secondary btn-small"
                    aria-haspopup="dialog"
                    aria-expanded={!!overlaysAnchor()}
                    onClick={(e) =>
                      setOverlaysAnchor((a) =>
                        a === e.currentTarget ? undefined : e.currentTarget,
                      )
                    }
                  >
                    Display
                  </button>
                  <ReviewButton kind="neural" label="Review cells" />
                </>
              }
            >
              {() => (
                <div class="cb-fill">
                  <NeuralRows />
                </div>
              )}
            </PlotCard>
          </div>
          <PlotCard
            title="Arena"
            help={HELP.trajectory.text}
            box
            summary={arenaSummaryLine()}
            actions={
              <>
                <ReviewButton kind="arena" label="Edit arena" />
                <ReviewButton kind="position" label="Review position" />
              </>
            }
          >
            {() => (
              <div class="cb-fill cb-viz__arena">
                <Show
                  when={hasPosition()}
                  fallback={
                    <div class="cb-note">
                      Load position and behavior camera timestamps to see the path.
                    </div>
                  }
                >
                  <div class="cb-viz__traj">
                    <Trajectory bare linked mode={trajMode()} />
                  </div>
                  <div class="cb-plot__legend cb-viz__key">
                    <Show when={placed()}>
                      <select
                        aria-label="Trajectory view"
                        value={trajMode()}
                        onChange={(e) => setTrajMode(e.currentTarget.value as 'path' | 'time')}
                      >
                        <option value="path">Path</option>
                        <option value="time">Time in bin</option>
                      </select>
                    </Show>
                    <Show
                      when={trajMode() === 'path' || !placed()}
                      fallback={
                        <>
                          Time in bin: low
                          <span class="cb-legend__bar cb-legend__bar--viridis cb-legend__bar--sm" />
                          high
                        </>
                      }
                    >
                      <span class="cb-key cb-key--gray" />
                      Full session
                      <span class="cb-key cb-key--blue" />
                      Selected window
                      <span class="cb-key cb-key--dot" />
                      Cursor
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </PlotCard>
          <PlotCard
            title="Behavior and position"
            help={BEHAVIOR_HELP}
            box
            summary={behaviorSummary()}
            actions={
              <>
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  aria-haspopup="dialog"
                  aria-expanded={!!tracksAnchor()}
                  onClick={(e) => openTracks(e.currentTarget)}
                >
                  Tracks
                </button>
                <ReviewButton kind="behavior" label="Review behavior" />
              </>
            }
          >
            {() => (
              <div class="cb-fill">
                <BehaviorRows />
              </div>
            )}
          </PlotCard>
        </div>
      </Show>
      <Show when={overlaysAnchor()}>{(a) => <DisplayMenu anchor={a()} />}</Show>
      <Show when={tracksAnchor()}>{(a) => <TracksMenu anchor={a()} />}</Show>
      <Show when={inputsAnchor()}>
        {(a) => <InputsPop anchor={a()} onClose={() => setInputsAnchor()} />}
      </Show>
      <EntryPopup />
    </div>
  );
}
