import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  goToStep,
  rawTrace,
  positionResult,
  annotationResults,
  selectCell,
} from '../lib/store.ts';
import { mss, setWinLen, setWinStartClamped, WINDOW_CHOICES, win, winLen } from '../lib/viz.ts';
import {
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
import { FootprintViewer } from './FootprintViewer.tsx';
import { Popover } from './Popover.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { HowTo, PlotCard } from './QcParts.tsx';
import { SelectedCellRows, Timeline } from './SessionView.tsx';
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
        ‹
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
        ›
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
      <span class="cb-muted cb-viz__range">
        {mss(win()[0])} – {mss(win()[1])}
      </span>
    </>
  );
};

export function VizPanel(): JSX.Element {
  const anything = () =>
    rawTrace() ||
    denoisedTrace() ||
    deconvolved() ||
    footprints() ||
    positionResult() ||
    annotationResults().length;
  const [trajMode, setTrajMode] = createSignal<'path' | 'time'>('path');
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-viz" ref={root}>
      <div class="cb-viz__bar">
        <h2>Data visualization</h2>
        <Show when={anything()}>
          <Show when={nCells() > 0}>
            <CellBar />
          </Show>
          <WindowControls />
          <Show when={sources().length}>
            <label class="cb-plot__tool">
              Heat map
              <select value={heat()} onChange={(e) => setHeatSrc(e.currentTarget.value as Source)}>
                <For each={sources()}>{(s) => <option value={s}>{SOURCE_LABEL[s]}</option>}</For>
              </select>
            </label>
          </Show>
          <button
            type="button"
            class="btn-secondary btn-small"
            aria-haspopup="dialog"
            aria-expanded={!!tracksAnchor()}
            onClick={(e) => openTracks(e.currentTarget)}
          >
            Tracks ▾
          </button>
        </Show>
      </div>
      <Show
        when={anything()}
        fallback={<div class="cb-empty">Load neural or behavior data to see it here.</div>}
      >
        <div class="cb-viz__body">
          <div class="cb-viz__col">
            <PlotCard title="Cell footprints" help={HELP.footprints.text} class="cb-plot--grow2">
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
            <PlotCard
              title="Trajectory"
              help={HELP.trajectory.text}
              class="cb-plot--grow3"
              tools={
                <Show when={hasPosition() && placed()}>
                  <label class="cb-plot__tool">
                    <select
                      aria-label="Trajectory view"
                      value={trajMode()}
                      onChange={(e) => setTrajMode(e.currentTarget.value as 'path' | 'time')}
                    >
                      <option value="path">Path</option>
                      <option value="time">Time in bin</option>
                    </select>
                  </label>
                </Show>
              }
              legend={
                <Show when={hasPosition()}>
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
                </Show>
              }
            >
              {() => (
                <div class="cb-fill">
                  <Show
                    when={hasPosition()}
                    fallback={
                      <div class="cb-note">
                        Load position and behavior camera timestamps to see the path.
                      </div>
                    }
                  >
                    <Trajectory bare linked mode={trajMode()} />
                  </Show>
                </div>
              )}
            </PlotCard>
          </div>
          <div class="cb-viz__col">
            <PlotCard
              title={`Selected cell · Cell ${cell() + 1}`}
              help={
                <p>
                  The raw, denoised and deconvolved signals of the selected cell over the shared
                  window. Pick the cell with the arrows, the footprints or a row of the heat map.
                  Each row has its own help button.
                </p>
              }
              class="cb-plot--grow2"
            >
              {() => (
                <div class="cb-fill">
                  <SelectedCellRows />
                </div>
              )}
            </PlotCard>
            <PlotCard
              title="Session timeline"
              help={
                <p>
                  Neural data and behavior on one time axis, aligned with the selected cell above.
                  Hover over any plot to place the dashed cursor on all of them. Each track has its
                  own help button. Choose tracks under Tracks.
                </p>
              }
              class="cb-plot--grow3"
            >
              {() => (
                <div class="cb-fill">
                  <Timeline />
                </div>
              )}
            </PlotCard>
          </div>
        </div>
        <div class="cb-viz__foot">
          <strong>Session navigator</strong>
          <HowTo title={HELP.navigator.title}>{HELP.navigator.text}</HowTo>
          <SessionNavigator />
          <button class="btn-primary" onClick={() => goToStep('qc')}>
            Continue to Data QC →
          </button>
        </div>
      </Show>
      <Show when={tracksAnchor()}>{(a) => <TracksMenu anchor={a()} />}</Show>
    </div>
  );
}
