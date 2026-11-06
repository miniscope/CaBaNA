// Behavioral QC position tracking: the trajectory, speed and flagged-segment plots.
import { createMemo, Match, Show, Switch, type JSX } from 'solid-js';
import type { Epoch } from '../lib/behavior.ts';
import type { PositionQc } from '../lib/qc.ts';
import { maxSpeed, positionResult, source } from '../lib/store.ts';
import { positionIssue } from '../lib/prepared.ts';
import { positionUnitsPerCm } from '../lib/arena.ts';
import { posRange, setShowFlagged, setShowPath, showFlagged, showPath } from '../lib/qc-view.ts';
import { Help, PlotCard, StepButtons } from './QcParts.tsx';
import {
  Ethogram,
  fmtS,
  PathMap,
  posOk,
  segIndex,
  segLabel,
  segments,
  selectSegment,
  SpeedPlot,
  zoomTo,
} from './BehaviorQc.tsx';

/** "Showing 10.0 s to 20.0 s" and the button that goes back to the whole session. */
function RangeTools(): JSX.Element {
  return (
    <span class="cb-cat-head__tools">
      <Show when={posRange()}>
        <span class="cb-muted">
          Showing {fmtS(posRange()![0])} to {fmtS(posRange()![1])}
        </span>
      </Show>
      <button class="btn-secondary btn-small" onClick={() => zoomTo(undefined)}>
        Show whole session
      </button>
    </span>
  );
}

/** Layers of the trajectory plot. The outline waits for Spatial setup. */
function Layers(): JSX.Element {
  return (
    <div class="cb-layers">
      <label>
        <input
          type="checkbox"
          checked={showPath()}
          onChange={(e) => setShowPath(e.currentTarget.checked)}
        />
        Tracked path
      </label>
      <label>
        <input
          type="checkbox"
          checked={showFlagged()}
          onChange={(e) => setShowFlagged(e.currentTarget.checked)}
        />
        Flagged segments
      </label>
      <label class="cb-layers__off">
        <input type="checkbox" disabled />
        Arena/zone outline
      </label>
      <span class="cb-muted">
        Off: needs the arena and zones from Spatial setup, not available yet.
      </span>
    </div>
  );
}

/** The flagged segment's step buttons and description, under whichever plot is shown. */
function SegmentBar(): JSX.Element {
  const sel = () => segments()[segIndex()];
  return (
    <Show when={sel()}>
      <div class={`cb-segbar cb-segbar--${sel()!.kind}`}>
        <b>
          Segment {segIndex() + 1} of {segments().length}
        </b>
        <span>
          {segLabel(sel()!)}, {fmtS(sel()!.start, 2)} to {fmtS(sel()!.stop, 2)}
        </span>
        <Show when={sel()!.kind === 'jump'}>
          <span class="cb-muted">Threshold {maxSpeed()} cm/s</span>
        </Show>
        <StepButtons n={segments().length} i={segIndex()} go={selectSegment} what="segment" />
      </div>
    </Show>
  );
}

const segmentTools = () => (
  <Show when={segments()[segIndex()]}>
    <span class="cb-muted">
      Segment {segIndex() + 1} of {segments().length}
    </span>
    <StepButtons n={segments().length} i={segIndex()} go={selectSegment} what="segment" />
  </Show>
);

/** Flagged segments as rows on a timeline, one row per kind. The selected segment is outlined. */
function SegmentTimeline(props: { p: PositionQc; h: number }): JSX.Element {
  const epochs = createMemo(() =>
    segments().map((s): Epoch => ({
      label: s.kind === 'jump' ? 'Jump' : 'Lost',
      start: s.start,
      stop: s.stop,
      flags: [],
      notes: [],
    })),
  );
  const end = () => props.p.frameT.filter(Number.isFinite).reduce((m, v) => Math.max(m, v), 0);
  return (
    <Show when={epochs().length} fallback={<div class="cb-muted">No flagged segments.</div>}>
      <Ethogram
        epochs={epochs()}
        duration={end()}
        selected={epochs()[segIndex()]}
        rowH={Math.max(
          24,
          Math.min(64, (props.h - 12) / new Set(epochs().map((e) => e.label)).size),
        )}
      />
    </Show>
  );
}

export function PositionPlot(props: { tab: string }): JSX.Element {
  const p = () => posOk();
  return (
    <>
      <Show when={positionResult() && !p()}>
        <div class="cb-error">{(positionResult() as { error: string }).error}</div>
      </Show>
      <Show when={!positionResult()}>
        <div class="cb-empty">{positionIssue() ?? 'No position data.'}</div>
      </Show>
      <Show when={p()}>
        <Switch>
          <Match when={props.tab === 'trajectory'}>
            <PlotCard
              title="Trajectory"
              class="cb-plot--grow3"
              tools={<RangeTools />}
              bigTools={
                <>
                  {segmentTools()}
                  <Layers />
                </>
              }
              legend={
                <>
                  <span class="cb-key" style={{ background: 'rgba(33,113,181,0.6)' }} />
                  Tracked path
                  <span class="cb-key" style={{ background: '#d32f2f' }} />
                  Faster than threshold
                  <span class="cb-key cb-key--ring" />
                  Selected segment
                </>
              }
              help={
                <>
                  <Help k="What is plotted">
                    The tracked position at each behavior camera frame, joined in time order. Only
                    the frames in the time range of the speed plot are drawn, so zooming the speed
                    plot narrows the path. Lost frames leave a break in the line.
                  </Help>
                  <Help k="Axes">
                    x and y in cm, in the arena's frame (origin at its lower left, y up)
                    {source.positionUnit === 'px'
                      ? `, converted from pixels with the arena calibration in Spatial setup (${positionUnitsPerCm()?.toFixed(2)} video pixels per cm)`
                      : ''}
                    . Both axes use the same scale, so the arena keeps its shape.
                  </Help>
                  <Help k="Colors">
                    Blue: the path between consecutive tracked frames. Red: a step faster than the
                    jump threshold. Black with a circle: the segment selected in Flagged segments; a
                    dashed black line spans a lost stretch. The two layers can be turned off under
                    the plot.
                  </Help>
                  <Help k="Limits">
                    This is position as tracked, before any smoothing or gap filling in Preprocess.
                    A tracker that locks onto a reflection and moves smoothly never exceeds the
                    threshold, so it is not flagged. Overlapping lines do not show how long the
                    animal stayed in a place.
                  </Help>
                </>
              }
            >
              {(s) => <PathMap p={p()!} w={s().w} h={s().h} />}
            </PlotCard>
            <Layers />
          </Match>
          <Match when={props.tab === 'speed'}>
            <PlotCard
              title="Speed between tracked frames"
              class="cb-plot--grow3"
              tools={<RangeTools />}
              legend={
                <>
                  <span class="cb-key" style={{ background: '#2171b5' }} />
                  Speed
                  <span class="cb-key cb-key--dash" />
                  Jump threshold ({maxSpeed()} cm/s)
                </>
              }
              help={
                <>
                  <Help k="What is plotted">
                    For each pair of consecutive tracked frames, the distance moved divided by the
                    time between their camera timestamps.
                  </Help>
                  <Help k="Axes">Camera time in seconds; speed in cm/s.</Help>
                  <Help k="Colors">
                    Blue: speed. Red dashed line: the jump threshold. Shaded band: the selected
                    segment (red for a jump, gray for a lost stretch).
                  </Help>
                  <Help k="Linked">
                    Scroll to zoom and drag to pan; the trajectory shows the same time range.
                    Selecting a segment zooms here to it.
                  </Help>
                  <Help k="Limits">
                    Steps next to a lost frame are not computed, so a lost stretch is a gap in the
                    line. This frame-to-frame speed is noisier than the smoothed speed used in
                    analyses, so short peaks below the threshold are expected.
                  </Help>
                </>
              }
            >
              {(s) => <SpeedPlot p={p()!} h={s().h} />}
            </PlotCard>
          </Match>
          <Match when={props.tab === 'timeline'}>
            <PlotCard
              title="Flagged segments over the session"
              class="cb-plot--grow3"
              legend={
                <>
                  <span class="cb-key cb-key--box-gray" />
                  Selected segment
                  <span class="cb-key cb-key--dash-gray" />
                  Session end
                </>
              }
              help={
                <>
                  <Help k="What is plotted">
                    One row for jumps and one for lost stretches, one bar per flagged segment, at
                    its start and stop time. These are the same segments as in Flagged segments.
                  </Help>
                  <Help k="Axes">Camera time across the whole session, left to right.</Help>
                  <Help k="Colors">
                    Bar colors only tell the two kinds apart. Black outline: the selected segment.
                    Dashed line: the last camera timestamp.
                  </Help>
                  <Help k="Limits">
                    A jump lasts a few frames, so its bar is drawn at least 2 pixels wide and can
                    look longer than it is. Lost stretches shorter than 1 s are not listed.
                  </Help>
                </>
              }
            >
              {(s) => <SegmentTimeline p={p()!} h={s().h} />}
            </PlotCard>
          </Match>
        </Switch>
        <SegmentBar />
      </Show>
    </>
  );
}
