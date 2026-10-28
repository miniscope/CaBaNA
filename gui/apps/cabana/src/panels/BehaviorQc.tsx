import { createEffect, createMemo, For, on, Show, untrack, type JSX } from 'solid-js';
import type uPlot from 'uplot';
import { TracePanel } from '@calab/ui/chart';
import { annotationStats, type Epoch } from '../lib/behavior.ts';
import { clockProgress, timingChecks, type PositionQc } from '../lib/qc.ts';
import { positionSegments, type Segment } from '../lib/qc-segments.ts';
import {
  alignmentResults,
  annotationFixCounts,
  annotationLog,
  annotationResults,
  cameraClock,
  editAnnotations,
  frameTimes,
  goToStep,
  maxSpeed,
  positionResult,
  sessionDuration,
  setMaxSpeed,
  source,
  timingResults,
  tol,
  undoAnnotationEdits,
} from '../lib/store.ts';
import { positionIssue } from '../lib/prepared.ts';
import { picked, posRange, setPicked, setPosRange } from '../lib/qc-view.ts';
import type { Category } from './QcPanel.tsx';
import { InfoTip } from './InfoTip.tsx';
import {
  Advice,
  CategoryHead,
  Findings,
  Help,
  Limits,
  PagedList,
  PlotCard,
  RailBox,
  ReviewActions,
  StepButtons,
} from './QcParts.tsx';

export const PALETTE = ['#2171b5', '#e09800', '#2e7d32', '#8e44ad', '#16a085', '#c0392b'];

/** About `n` round-numbered ticks between `a` and `b`. */
export function ticks(a: number, b: number, n = 6): number[] {
  const raw = (b - a) / n;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

const fmtS = (t: number, d = 1) => `${t.toFixed(d)} s`;

/** Position units per cm, for drawing the path in cm. */
const posScale = () => (source.positionUnit === 'px' ? source.pxPerCm : 1);

const posOk = () => {
  const p = positionResult();
  return p && 'checks' in p ? p : undefined;
};

/** Jumps and long lost stretches, for the list and the plots. Display only. */
export const segments = createMemo(() => {
  const p = posOk();
  return p ? positionSegments(p, maxSpeed()) : [];
});
const SEG = 'segments';
const segIndex = () => Math.min(picked[SEG] ?? 0, Math.max(segments().length - 1, 0));

/** Speed plots on screen (the card and, while open, the expanded view), so a segment can zoom them all. */
const speedCharts = new Set<uPlot>();
function zoomTo(range?: [number, number]): void {
  const p = posOk();
  if (!p?.t.length) return;
  const [a, b] = range ?? [p.t[0], p.t[p.t.length - 1]];
  speedCharts.forEach((u) => u.setScale('x', { min: a, max: b }));
  setPosRange(range);
}
function selectSegment(i: number): void {
  const s = segments()[i];
  if (!s) return;
  setPicked(SEG, i);
  const pad = Math.max(5, 2 * (s.stop - s.start));
  zoomTo([s.start - pad, s.stop + pad]);
}

/** The animal's path, in cm, with equal scales on both axes. Steps over the threshold are red. */
function PathMap(props: { p: PositionQc; w: number; h: number }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const { x, y, frameT, idx, speed } = props.p;
    const [W, H] = [props.w, props.h];
    const k = posScale();
    const thr = maxSpeed();
    const range = posRange();
    const sel = segments()[segIndex()];
    const ctx = canvas.getContext('2d');
    if (!ctx || W < 50 || H < 50) return;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i])) continue;
      [x0, x1] = [Math.min(x0, x[i] / k), Math.max(x1, x[i] / k)];
      [y0, y1] = [Math.min(y0, y[i] / k), Math.max(y1, y[i] / k)];
    }
    if (!Number.isFinite(x0)) return;
    const [L, B, T, R] = [48, 36, 8, 12];
    const s = Math.min(
      (W - L - R) / Math.max(x1 - x0, 1e-9),
      (H - T - B) / Math.max(y1 - y0, 1e-9),
    );
    const [pw, ph] = [(x1 - x0) * s, (y1 - y0) * s];
    const ox = L + (W - L - R - pw) / 2;
    const oy = T + (H - T - B - ph) / 2;
    const px = (i: number) => ox + (x[i] / k - x0) * s;
    const py = (i: number) => oy + ph - (y[i] / k - y0) * s;
    const dpr = devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(ox, oy, pw, ph);
    ctx.strokeStyle = '#d0d7de';
    ctx.strokeRect(ox, oy, pw, ph);
    // Axes
    ctx.fillStyle = '#57606a';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const v of ticks(x0, x1)) ctx.fillText(String(v), ox + (v - x0) * s, oy + ph + 14);
    ctx.fillText('x (cm)', ox + pw / 2, oy + ph + 30);
    ctx.textAlign = 'right';
    for (const v of ticks(y0, y1, 4)) ctx.fillText(String(v), ox - 6, oy + ph - (v - y0) * s + 4);
    ctx.save();
    ctx.translate(12, oy + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('y (cm)', 0, 0);
    ctx.restore();
    // Path, only for frames in the time range shown in the speed plot
    const ok = (i: number) =>
      Number.isFinite(x[i]) && (!range || (frameT[i] >= range[0] && frameT[i] <= range[1]));
    ctx.strokeStyle = 'rgba(33,113,181,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < x.length; i++) {
      if (!ok(i) || !ok(i - 1)) continue;
      ctx.moveTo(px(i - 1), py(i - 1));
      ctx.lineTo(px(i), py(i));
    }
    ctx.stroke();
    const step = (i: number) => {
      ctx.beginPath();
      ctx.moveTo(px(i - 1), py(i - 1));
      ctx.lineTo(px(i), py(i));
      ctx.stroke();
    };
    // The selected segment, under the red so the red still shows
    if (sel) {
      const ends = sel.kind === 'jump' ? [sel.first, sel.last] : [sel.first - 1, sel.last + 1];
      const pts = ends.filter((i) => i >= 0 && i < x.length && Number.isFinite(x[i]));
      ctx.strokeStyle = '#1f2328';
      ctx.lineWidth = 4;
      if (sel.kind === 'jump') for (let i = sel.first + 1; i <= sel.last; i++) step(i);
      else if (pts.length === 2) {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px(pts[0]), py(pts[0]));
        ctx.lineTo(px(pts[1]), py(pts[1]));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Circle the middle frame of a jump, or the middle of the gap a lost stretch leaves.
      const mid = Math.round((sel.first + sel.last) / 2);
      const [cx, cy] =
        sel.kind === 'jump' || pts.length < 2
          ? [px(mid), py(mid)]
          : [(px(pts[0]) + px(pts[1])) / 2, (py(pts[0]) + py(pts[1])) / 2];
      if (Number.isFinite(cx + cy)) {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = '#d32f2f';
    ctx.lineWidth = 2;
    speed.forEach((v, n) => {
      const i = idx[n];
      if (v > thr && ok(i) && ok(i - 1)) step(i);
    });
  });
  return (
    <canvas
      ref={canvas}
      style={{ width: `${props.w}px`, height: `${props.h}px`, display: 'block' }}
      role="img"
      aria-label="Path of the animal in the arena. Steps over the jump threshold are red."
    />
  );
}

/** Draws the jump threshold and shades the selected segment. Drawn, not plotted as data, so changing either keeps the zoom. */
const overlay: uPlot.Plugin = {
  // Keep the threshold in view: the y axis reaches at least a little above it.
  opts: (_u, o) => ({
    ...o,
    scales: { ...o.scales, y: { range: (_v, _a, b) => [0, Math.max(b, 1.1 * maxSpeed())] } },
  }),
  hooks: {
    draw(u) {
      const { ctx, bbox } = u;
      const y = u.valToPos(maxSpeed(), 'y', true);
      ctx.save();
      ctx.strokeStyle = '#d32f2f';
      ctx.lineWidth = devicePixelRatio || 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(bbox.left, y);
      ctx.lineTo(bbox.left + bbox.width, y);
      ctx.stroke();
      ctx.restore();
      const s = segments()[segIndex()];
      if (!s) return;
      const pad = Math.max(0.2, s.stop - s.start);
      const a = u.valToPos(s.start - pad / 2, 'x', true);
      const b = u.valToPos(s.stop + pad / 2, 'x', true);
      ctx.save();
      ctx.fillStyle = s.kind === 'jump' ? 'rgba(211,47,47,0.15)' : 'rgba(97,97,97,0.15)';
      ctx.fillRect(Math.max(a, bbox.left), bbox.top, Math.max(b - a, 3), bbox.height);
      ctx.restore();
    },
  },
};

function SpeedPlot(props: { p: PositionQc; h: number }): JSX.Element {
  let chart: uPlot | undefined;
  /** Time of the last wheel or drag on the plot. Only those zooms are saved; loading data also resets the scale. */
  let input = 0;
  const follow: uPlot.Plugin = {
    hooks: {
      ready(u) {
        const mark = () => (input = Date.now());
        u.over.addEventListener('wheel', mark);
        u.over.addEventListener('pointermove', (e) => e.buttons && mark());
      },
      destroy: (u) => void speedCharts.delete(u),
      setData(u) {
        // After uPlot's own reset of the scale has been applied.
        queueMicrotask(() => {
          const r = untrack(posRange);
          if (r) u.setScale('x', { min: r[0], max: r[1] });
        });
      },
      setScale(u, key) {
        if (key !== 'x' || Date.now() - input > 500) return;
        const { t } = props.p;
        const [a, b] = [u.scales.x.min!, u.scales.x.max!];
        setPosRange(a <= t[0] && b >= t[t.length - 1] ? undefined : [a, b]);
      },
    },
  };
  createEffect(() => {
    segIndex();
    chart?.redraw(false);
  });
  // A new threshold changes the y range, which is only recomputed when the x scale is set.
  createEffect(
    on(
      maxSpeed,
      () => chart?.setScale('x', { min: chart.scales.x.min!, max: chart.scales.x.max! }),
      {
        defer: true,
      },
    ),
  );
  return (
    <TracePanel
      data={() => [props.p.t, props.p.speed]}
      series={[{}, { label: 'Speed (cm/s)', stroke: '#2171b5', width: 1 }]}
      height={props.h}
      syncKey="cabana-speed"
      xLabel="Camera time (s). Scroll to zoom, drag to pan."
      plugins={[follow, overlay]}
      onCreate={(u) => {
        chart = u;
        speedCharts.add(u);
      }}
    />
  );
}

const segLabel = (s: Segment) =>
  s.kind === 'jump'
    ? `Jump, ${s.peak!.toFixed(0)} cm/s${s.n > 1 ? ` over ${s.n} steps` : ''}`
    : `Lost for ${(s.stop - s.start).toFixed(1)} s (${s.n} frames)`;

function PositionView(): JSX.Element {
  const p = () => posOk();
  const checks = () => p()?.checks ?? [];
  const sel = () => segments()[segIndex()];
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead
          title="Position tracking"
          checks={checks()}
          flagged={segments().length ? `${segments().length} flagged segments` : undefined}
        >
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
        </CategoryHead>
        <Show when={positionResult() && !p()}>
          <div class="cb-error">{(positionResult() as { error: string }).error}</div>
        </Show>
        <Show when={!positionResult()}>
          <div class="cb-empty">{positionIssue() ?? 'No position data.'}</div>
        </Show>
        <Show when={p()}>
          <PlotCard
            title="Trajectory"
            class="cb-plot--grow3"
            bigTools={
              <Show when={sel()}>
                <span class="cb-muted">
                  Segment {segIndex() + 1} of {segments().length}
                </span>
                <StepButtons
                  n={segments().length}
                  i={segIndex()}
                  go={selectSegment}
                  what="segment"
                />
              </Show>
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
                  The tracked position at each behavior camera frame, joined in time order. Only the
                  frames in the time range of the speed plot are drawn, so zooming the speed plot
                  narrows the path. Lost frames leave a break in the line.
                </Help>
                <Help k="Axes">
                  x and y in cm
                  {source.positionUnit === 'px'
                    ? `, converted from pixels at ${source.pxPerCm} px per cm (set in Experimental Setup)`
                    : ''}
                  . Both axes use the same scale, so the arena keeps its shape.
                </Help>
                <Help k="Colors">
                  Blue: the path between consecutive tracked frames. Red: a step faster than the
                  jump threshold. Black with a circle: the segment selected in Flagged segments; a
                  dashed black line spans a lost stretch.
                </Help>
                <Help k="Limits">
                  This is position as tracked, before any smoothing or gap filling in Preprocess. A
                  tracker that locks onto a reflection and moves smoothly never exceeds the
                  threshold, so it is not flagged. Overlapping lines do not show how long the animal
                  stayed in a place.
                </Help>
              </>
            }
          >
            {(s) => <PathMap p={p()!} w={s().w} h={s().h} />}
          </PlotCard>
          <PlotCard
            title="Speed between tracked frames"
            class="cb-plot--grow2"
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
        </Show>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={checks()} />
        <Show when={p()}>
          <RailBox
            title="Flagged segments"
            grow
            extra={
              <InfoTip label="What is listed">
                Steps faster than the jump threshold, grouped when they are a frame or two apart,
                and lost stretches longer than 1 s. A category can pass with flagged segments when
                they are under the limit.
              </InfoTip>
            }
          >
            <PagedList
              id={SEG}
              items={segments()}
              selected={segIndex()}
              onSelect={selectSegment}
              empty="No jumps over the threshold and no lost stretches over 1 s."
            >
              {(s, i) => (
                <span class="cb-segrow">
                  <span class="cb-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span>{fmtS(s.start)}</span>
                  <span>{s.kind === 'jump' ? 'Jump' : 'Lost'}</span>
                  <span>
                    {s.kind === 'jump'
                      ? `${s.peak!.toFixed(0)} cm/s`
                      : `${(s.stop - s.start).toFixed(1)} s`}
                  </span>
                </span>
              )}
            </PagedList>
          </RailBox>
        </Show>
        <RailBox title="Settings" fold="settings">
          <div class="cb-setting">
            <label for="cb-jump">Jump threshold</label>
            <InfoTip label="About the jump threshold">
              Steps between two tracked frames faster than this speed are flagged as jumps. A jump
              usually means the tracker lost the animal, locked onto a reflection, or swapped
              identity. Changing it updates the flags at once. Whether the section passes depends on
              the Jump steps limit under Pass/fail limits. Default 60 cm/s.
            </InfoTip>
            <input
              id="cb-jump"
              type="number"
              min="1"
              value={maxSpeed()}
              onInput={(e) => setMaxSpeed(+e.currentTarget.value || 60)}
            />
            <span class="cb-muted">cm/s</span>
          </div>
          <Limits keys={['lostPct', 'jumpPct']} />
        </RailBox>
        <RailBox title="Correction" fold="correction">
          <p class="cb-muted">
            Short gaps are filled and position is smoothed with a median filter in Preprocess. The
            tracking file is not changed.
          </p>
          <Advice checks={checks()} />
          <div class="cb-controls">
            <button class="btn-secondary btn-small" onClick={() => goToStep('prep')}>
              Open Preprocess ↗
            </button>
          </div>
          <ReviewActions id="position" section="position" checks={checks()} />
        </RailBox>
      </aside>
    </>
  );
}

/** Each recording's progress against time on the neural clock; the two lines should start and end together. */
function ClockPlot(props: { h: number }): JSX.Element {
  const both = () => {
    const [n, c] = [frameTimes(), cameraClock()];
    return n?.length && c?.length ? clockProgress(n, c) : undefined;
  };
  return (
    <Show
      when={both()}
      fallback={
        <div class="cb-muted">The clock plot needs both neural and behavior camera timestamps.</div>
      }
    >
      <TracePanel
        data={() => both() as unknown as [number[], ...number[][]]}
        series={[
          {},
          { label: 'Miniscope (% of frames)', stroke: '#2171b5', width: 1.5 },
          { label: 'Behavior camera (% of frames)', stroke: '#e09800', width: 1.5, dash: [6, 4] },
        ]}
        height={props.h}
        syncKey="cabana-clocks"
        xLabel="Time on the neural clock (s). Scroll to zoom."
      />
    </Show>
  );
}

const timing = createMemo(() => [
  ...timingResults().flatMap((r) => timingChecks(r.name, r)),
  ...alignmentResults(),
]);

function TimingView(): JSX.Element {
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead title="Timing and alignment" checks={timing()} />
        <Show when={!timing().length}>
          <div class="cb-empty">Timing and alignment need timestamps files.</div>
        </Show>
        <Show when={timingResults().length}>
          <section class="cb-plot cb-plot--table">
            <div class="cb-plot__head">
              <h3>Recordings</h3>
            </div>
            <table class="cb-stats">
              <thead>
                <tr>
                  <th>Recording</th>
                  <th>Frames</th>
                  <th>Mean rate</th>
                  <th>Dropped (limit 1%)</th>
                  <th>Jitter (limit)</th>
                </tr>
              </thead>
              <tbody>
                <For each={timingResults()}>
                  {(r) => (
                    <tr>
                      <td>{r.name}</td>
                      <td>{r.nFrames.toLocaleString()}</td>
                      <td>{r.fsMean.toFixed(2)} Hz</td>
                      <td>
                        {r.nDropped} ({(100 * r.droppedFraction).toFixed(2)}%) in{' '}
                        {r.gapStart.length} {r.gapStart.length === 1 ? 'gap' : 'gaps'}
                      </td>
                      <td>
                        {(1000 * r.jitterS).toFixed(2)} ms (
                        {((1000 * 0.25) / r.fsMedian).toFixed(1)} ms)
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        </Show>
        <Show when={timing().length}>
          <PlotCard
            title="Recording progress on the neural clock"
            class="cb-plot--grow3"
            legend={
              <>
                <span class="cb-key" style={{ background: '#2171b5' }} />
                Miniscope
                <span class="cb-key cb-key--dash-amber" />
                Behavior camera
              </>
            }
            help={
              <>
                <Help k="What is plotted">
                  For each recording, the share of its frames recorded so far, from 0 to 100%,
                  against time. The camera times are moved onto the neural clock by the clock offset
                  from Experimental Setup.
                </Help>
                <Help k="Axes">Time on the neural clock in seconds; percent of frames.</Help>
                <Help k="How to read">
                  The lines should start and end together and rise in parallel. Lines that start or
                  end apart mean one recording started or stopped first. A flat step is a run of
                  dropped frames, and a difference in slope is a difference in frame rate.
                </Help>
                <Help k="Limits">
                  The plot uses the timestamps as written. If both clocks drift together, for
                  example from the same wrong clock, the lines still agree.
                </Help>
              </>
            }
          >
            {(s) => <ClockPlot h={s().h} />}
          </PlotCard>
        </Show>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={timing()} />
        <RailBox title="Settings" fold="settings">
          <div class="cb-setting">
            <span>Behavior clock offset</span>
            <InfoTip label="About the clock offset">
              Seconds added to the camera timestamps to put them on the neural clock. Set it in
              Experimental Setup when the camera started before or after the miniscope.
            </InfoTip>
            <b>{source.clockOffsetS} s</b>
          </div>
        </RailBox>
        <RailBox title="Correction" fold="correction">
          <p class="cb-muted">
            CaBaNA does not change timestamps. A clock offset is entered in Experimental Setup.
          </p>
          <Advice checks={timing()} />
          <div class="cb-controls">
            <button class="btn-secondary btn-small" onClick={() => goToStep('setup')}>
              Open Experimental Setup ↗
            </button>
          </div>
          <ReviewActions id="timing" checks={timing()} />
        </RailBox>
      </aside>
    </>
  );
}

/** One row per label, one bar per epoch. Problem epochs are outlined in red, and `selected` in black. */
export function Ethogram(props: {
  epochs: Epoch[];
  duration: number;
  selected?: Epoch;
  /** Height of one row in px. */
  rowH?: number;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const labels = () => [...new Set(props.epochs.map((e) => e.label))];
  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ROW = props.rowH ?? 24;
    const W = 1000;
    canvas.width = W;
    canvas.height = labels().length * ROW;
    const span = Math.max(props.duration, ...props.epochs.map((e) => e.stop));
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, canvas.height);
    for (const e of props.epochs) {
      const row = labels().indexOf(e.label);
      const x = (Math.max(e.start, 0) / span) * W;
      const w = Math.max(((Math.max(e.stop, e.start) - Math.max(e.start, 0)) / span) * W, 2);
      ctx.fillStyle = PALETTE[row % PALETTE.length];
      ctx.fillRect(x, row * ROW + 4, w, ROW - 8);
      if (e === props.selected || e.flags.length || e.notes.length) {
        ctx.strokeStyle = e === props.selected ? '#1f2328' : e.flags.length ? '#d32f2f' : '#e09800';
        ctx.lineWidth = e === props.selected ? 3 : 2;
        ctx.strokeRect(x - 1, row * ROW + 2, w + 2, ROW - 4);
      }
    }
    // Where the session ends.
    ctx.strokeStyle = '#616161';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo((props.duration / span) * W, 0);
    ctx.lineTo((props.duration / span) * W, canvas.height);
    ctx.stroke();
  });
  return (
    <div class="cb-etho">
      <div class="cb-etho__labels">
        <For each={labels()}>
          {(l) => <div style={{ height: `${props.rowH ?? 24}px` }}>{l}</div>}
        </For>
      </div>
      <canvas
        ref={canvas}
        style={{ height: `${labels().length * (props.rowH ?? 24)}px` }}
        aria-label="Annotated behavior over the session"
      />
    </div>
  );
}

function StatsTable(props: { epochs: Epoch[] }): JSX.Element {
  const rows = () =>
    annotationStats(
      props.epochs,
      sessionDuration() ?? Math.max(...props.epochs.map((e) => e.stop)),
    );
  const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  return (
    <table class="cb-stats">
      <thead>
        <tr>
          <th>Label</th>
          <th>Epochs</th>
          <th>Mean length (s)</th>
          <th>Mean gap to next (s)</th>
          <th>Share of session</th>
        </tr>
      </thead>
      <tbody>
        <For each={rows()}>
          {(r) => (
            <tr>
              <td>{r.label}</td>
              <td>{r.n}</td>
              <td>
                {f(r.meanLen)} ± {f(r.sdLen)}
              </td>
              <td>{f(r.meanGap)}</td>
              <td>
                <span class="cb-bar" style={{ width: `${Math.min(r.pctSession, 100) * 0.6}px` }} />
                {f(r.pctSession, 1)}%
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** Optional fixes for annotations: merge bouts that are really one, and remove bouts too short to use. */
function AnnotationFixes(): JSX.Element {
  return (
    <div class="cb-fix">
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => editAnnotations('merge')}>
          Merge bouts closer than {tol.mergeGapS} s ({annotationFixCounts().merge})
        </button>
        <button class="btn-secondary btn-small" onClick={() => editAnnotations('drop')}>
          Remove bouts under {tol.minBoutS} s ({annotationFixCounts().drop})
        </button>
      </div>
      <Show when={annotationLog().length}>
        <ul class="cb-muted">
          <For each={annotationLog()}>{(m) => <li>{m}</li>}</For>
        </ul>
        <button class="cb-link" onClick={undoAnnotationEdits}>
          Undo annotation fixes
        </button>
      </Show>
      <div class="cb-muted">
        These apply to every annotation file and use the pass/fail limits under Settings. The
        annotation files themselves are not changed.
      </div>
    </div>
  );
}

const fileOf = (id: string) => annotationResults().find((a) => a.id === id);

function AnnotationView(props: { id: string }): JSX.Element {
  const a = () => fileOf(props.id);
  const listId = `epochs-${props.id}`;
  const flagged = () => (a()?.epochs ?? []).filter((e) => e.flags.length || e.notes.length);
  const sel = () => Math.min(picked[listId] ?? -1, flagged().length - 1);
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead
          title={`Annotations: ${a()?.name ?? ''}`}
          checks={a()?.checks ?? []}
          flagged={flagged().length ? `${flagged().length} flagged epochs` : undefined}
        />
        <Show when={a()?.error}>
          <div class="cb-error">
            {a()!.name}: {a()!.error}
          </div>
        </Show>
        <Show when={a() && !a()!.error}>
          <PlotCard
            title="Epochs over the session"
            legend={
              <>
                <span class="cb-key cb-key--box-red" />
                Error
                <span class="cb-key cb-key--box-amber" />
                Short or close bout
                <span class="cb-key cb-key--dash-gray" />
                Session end
              </>
            }
            help={
              <>
                <Help k="What is plotted">
                  One row per label and one bar per epoch, from its start to its stop, as read from
                  the annotation file (after any merge or remove fixes).
                </Help>
                <Help k="Axes">
                  Time across the whole session, left to right. Rows are the labels in the order
                  they first appear.
                </Help>
                <Help k="Colors">
                  Bar colors only tell labels apart. Red outline: an error, such as a stop before
                  its start or an epoch outside the session. Amber outline: a bout that is very
                  short, or close to another bout of the same label. Black outline: the epoch
                  selected in Flagged epochs. Dashed line: the end of the session.
                </Help>
                <Help k="Limits">
                  Very short epochs are drawn at least 2 pixels wide so they stay visible, so a bar
                  can look longer than it is. Expand the plot for more detail.
                </Help>
              </>
            }
          >
            {(size) => (
              <Ethogram
                epochs={a()!.epochs}
                duration={sessionDuration() ?? 0}
                selected={flagged()[sel()]}
                rowH={Math.max(
                  24,
                  Math.min(64, (size().h - 12) / new Set(a()!.epochs.map((e) => e.label)).size),
                )}
              />
            )}
          </PlotCard>
          <section class="cb-plot cb-plot--table">
            <div class="cb-plot__head">
              <h3>Epochs per label</h3>
            </div>
            <div class="cb-plot__scroll">
              <StatsTable epochs={a()!.epochs} />
            </div>
          </section>
        </Show>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={a()?.checks ?? []} />
        <RailBox title="Flagged epochs" grow>
          <PagedList
            id={listId}
            rowH={46}
            items={flagged()}
            selected={sel()}
            onSelect={(i) => setPicked(listId, i)}
            empty="No flagged epochs in this file."
          >
            {(e) => (
              <span class="cb-epochrow">
                <span>
                  {e.label} {e.start.toFixed(2)} to {e.stop.toFixed(2)} s
                </span>
                <span class={e.flags.length ? 'cb-error' : 'cb-warn'}>
                  {[...e.flags, ...e.notes].join(', ')}
                </span>
              </span>
            )}
          </PagedList>
        </RailBox>
        <RailBox title="Settings" fold="settings">
          <Limits keys={['annotPct', 'minBoutS', 'mergeGapS']} />
        </RailBox>
        <RailBox title="Correction" fold="correction">
          <Advice checks={a()?.checks ?? []} />
          <AnnotationFixes />
          <ReviewActions id={props.id} section="annotations" checks={a()?.checks ?? []} />
        </RailBox>
      </aside>
    </>
  );
}

/** The Behavioral tab's categories, in the order they are listed. */
export function behaviorCategories(): Category[] {
  const files = annotationResults();
  if (!positionResult() && !files.length && !timing().length) return [];
  return [
    {
      id: 'timing',
      name: 'Timing and alignment',
      checks: timing(),
      flagged: timing().filter((c) => c.status !== 'pass').length,
      flaggedWord: 'checks',
      view: TimingView,
    },
    {
      id: 'position',
      name: 'Position tracking',
      checks: posOk()?.checks ?? [],
      flagged: segments().length,
      flaggedWord: 'segments',
      section: 'position',
      view: PositionView,
    },
    ...files.map((a) => ({
      id: a.id,
      name: a.name.replace(/\.[^.]+$/, ''),
      group: 'Annotations',
      checks: a.error
        ? [
            {
              id: 'read',
              group: 'Behavior' as const,
              title: 'File could be read',
              status: 'fail' as const,
              detail: a.error,
            },
          ]
        : a.checks,
      flagged: a.epochs.filter((e) => e.flags.length || e.notes.length).length,
      flaggedWord: 'epochs',
      section: 'annotations' as const,
      view: () => <AnnotationView id={a.id} />,
    })),
  ];
}
