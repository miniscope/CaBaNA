import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Pill } from '../components/Pill.tsx';
import {
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  rawTrace,
  positionResult,
  annotationResults,
} from '../lib/store.ts';
import { heat, pos, rows, SOURCE_LABEL } from '../lib/viz-tracks.ts';
import { arenaShow, trajMode } from '../lib/viz-display.ts';
import { BOX_TITLE, type VizBox } from '../lib/viz-pills.ts';
import { ArenaEditor } from './ArenaEditor.tsx';
import { ChangesDrawer, changesSummary, openChanges } from './ChangesDrawer.tsx';
import { FootprintViewer } from './FootprintViewer.tsx';
import { InfoTip } from './InfoTip.tsx';
import { flaggedCells, overlapPairs } from './NeuralQcShared.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PlotCard } from './QcParts.tsx';
import { RevertChanges } from './RevertChanges.tsx';
import { arena, pxPerCm } from '../lib/arena.ts';
import { BehaviorRows, NeuralRows } from './SessionView.tsx';
import { SessionNavigator } from './SessionNavigator.tsx';
import { placed, Trajectory } from './Trajectory.tsx';
import { boxPills, pillTarget } from './VizChecks.tsx';
import { QcPopups } from './QcPopups.tsx';
import { HELP } from './VizHelp.tsx';
import { BoxActions } from './VizMenus.tsx';
import { CellBar, nCells, WindowControls } from './VizControls.tsx';

const hasPosition = () => !!positionResult() && 'x' in positionResult()!;

/** One line under each box title: what it shows, in counts. */
const footprintSummary = () =>
  `${nCells()} cells · ${flaggedCells().length} flagged in Neural data · click a cell to select it`;
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

/** The pills of a box; each opens that box's QC or Preprocess pop-up. */
function Pills(props: { box: VizBox }): JSX.Element {
  return (
    <For each={boxPills(props.box)}>
      {(p) => (
        <Pill
          tone={p.tone}
          onClick={pillTarget(props.box, p)}
          title={`Open ${p.kind === 'prep' ? 'Preprocess' : 'QC'} for ${BOX_TITLE[props.box]}`}
        >
          {p.text}
        </Pill>
      )}
    </For>
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
      row has a checkbox to show or hide it and its own help marker. Actions, Display settings
      chooses the heat map's signal and the shaded behaviors.
    </p>
  </>
);
const BEHAVIOR_HELP = (
  <p>
    Behavior labels, zones, time markers, frame labels, position and speed on the same time axis as
    the neural data. Hover over any plot to place the dashed cursor on all of them; the line at the
    bottom of the page reads out the time, position and behavior there. The checkboxes show or hide
    a row.
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
  const [arenaEditor, setArenaEditor] = createSignal(false);
  const marks = {
    flagged: createMemo(() => new Set(flaggedCells().map((x) => x.c))),
    overlapping: createMemo(() => new Set(overlapPairs().flatMap((p) => [p.a, p.b]))),
  };
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-viz" ref={root}>
      <div class="cb-viz__bar">
        <h2>Data visualization</h2>
        <InfoTip label="About Data visualization">
          The loaded data on one shared time window. Selecting a cell (footprints, heat map row or
          the cell field), moving the window (navigator or Earlier and Later) and hovering a time
          plot update every plot. The pills in each box sum up its quality checks, corrections and
          preprocessing; each opens that file's checks, the same as in Data setup. Actions on each
          box hold its display settings and change history.
        </InfoTip>
        <span class="cb-spacer" />
        <Show when={anything()}>
          <Show when={nCells() > 0}>
            <CellBar />
          </Show>
          <WindowControls />
          <button
            type="button"
            class="btn-secondary btn-small cb-viz__hist"
            aria-haspopup="dialog"
            title={
              changesSummary().reruns
                ? `${changesSummary().reruns} saved result(s) need a rerun`
                : 'Corrections and preprocessing applied in this session'
            }
            onClick={() => openChanges()}
          >
            Change history · {changesSummary().applied}
          </button>
        </Show>
      </div>
      <Show
        when={anything()}
        fallback={<div class="cb-empty">Load neural or behavior data to see it here.</div>}
      >
        <div class="cb-viz__grid">
          <PlotCard
            title="Footprints"
            help={HELP.footprints.text}
            box
            expandInMenu
            summary={footprintSummary()}
            pills={<Pills box="footprints" />}
            actions={(expand) => <BoxActions box="footprints" expand={expand} />}
            bigControls={
              <>
                <CellBar />
              </>
            }
            bigActions={<BoxActions box="footprints" />}
          >
            {(size) => (
              <Show
                when={footprints()}
                fallback={<div class="cb-note">Load footprints to see the cells' shapes.</div>}
              >
                <div class="cb-fpcard">
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(size().w - 120, size().h - 4))}px`,
                      height: `${Math.max(0, Math.min(size().w - 120, size().h - 4))}px`,
                    }}
                  >
                    <FootprintViewer marks={marks} />
                  </div>
                  <div class="cb-fpcard__key">
                    <div>
                      <span class="cb-ring cb-ring--flag" />
                      Flagged ({flaggedCells().length})
                    </div>
                    <div>
                      <span class="cb-ring cb-ring--pair" />
                      Overlap ({overlapPairs().length}{' '}
                      {overlapPairs().length === 1 ? 'pair' : 'pairs'})
                    </div>
                    <div>
                      <span class="cb-ring cb-ring--sel" />
                      Selected: cell {cell() + 1}
                    </div>
                  </div>
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
              expandInMenu
              summary={neuralSummary()}
              pills={<Pills box="neural" />}
              actions={(expand) => <BoxActions box="neural" expand={expand} side="left" />}
              bigControls={
                <>
                  <CellBar />
                  <WindowControls inline />
                </>
              }
              bigActions={<BoxActions box="neural" side="left" />}
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
            expandInMenu
            summary={
              <span class="cb-viz__sub">
                <Pills box="arena" />
                <span>{arenaSummaryLine()}</span>
              </span>
            }
            bigControls={<WindowControls inline />}
            bigActions={<BoxActions box="arena" up />}
            actions={(expand) => (
              <>
                <button
                  type="button"
                  class="btn-accent btn-small"
                  onClick={() => setArenaEditor(true)}
                >
                  <span aria-hidden="true">✎</span> Edit arena
                </button>
                <BoxActions box="arena" expand={expand} up />
              </>
            )}
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
                      <Show when={arenaShow.full}>
                        <span class="cb-key cb-key--gray" />
                        Full session
                      </Show>
                      <Show when={arenaShow.window}>
                        <span class="cb-key cb-key--blue" />
                        Selected window
                      </Show>
                      <Show when={arenaShow.cursor}>
                        <span class="cb-key cb-key--dot" />
                        Cursor
                      </Show>
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
            expandInMenu
            summary={behaviorSummary()}
            pills={<Pills box="behavior" />}
            actions={(expand) => <BoxActions box="behavior" expand={expand} side="left" up />}
            bigControls={
              <>
                <WindowControls inline />
              </>
            }
            bigActions={<BoxActions box="behavior" side="left" up />}
          >
            {() => (
              <div class="cb-fill">
                <BehaviorRows />
              </div>
            )}
          </PlotCard>
        </div>
      </Show>
      <Show when={arenaEditor()}>
        <ArenaEditor onClose={() => setArenaEditor(false)} />
      </Show>
      <QcPopups />
      <ChangesDrawer />
      <RevertChanges />
    </div>
  );
}
