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
  maxSpeed,
  positionResult,
  sessionDuration,
  timingResults,
  tol,
  undoAnnotationEdits,
} from '../lib/store.ts';
import { positionTransform } from '../lib/arena.ts';
import { picked, posRange, setPicked, setPosRange, showFlagged, showPath } from '../lib/qc-view.ts';
import type { Category } from './QcPanel.tsx';
import {
  annotationMetrics,
  AnnotationCorrection,
  AnnotationFlagged,
  AnnotationPlot,
  flaggedOf,
} from './BehaviorQcAnnotations.tsx';
import {
  PositionActions,
  PositionCorrection,
  PositionFlagged,
  positionMetrics,
} from './BehaviorQcPositionRail.tsx';
import { PositionPlot } from './BehaviorQcPosition.tsx';
import { TimingCorrection, TimingPlot, timingMetrics } from './BehaviorQcTiming.tsx';

export { behaviorSettings } from './BehaviorQcSettings.tsx';

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

export const fmtS = (t: number, d = 1) => `${t.toFixed(d)} s`;

export const posOk = () => {
  const p = positionResult();
  return p && 'checks' in p ? p : undefined;
};

/** Jumps and long lost stretches, for the list and the plots. Display only. */
export const segments = createMemo(() => {
  const p = posOk();
  return p ? positionSegments(p, maxSpeed()) : [];
});
export const SEG = 'segments';
export const segIndex = () => Math.min(picked[SEG] ?? 0, Math.max(segments().length - 1, 0));

/** Speed plots on screen (the card and, while open, the expanded view), so a segment can zoom them all. */
const speedCharts = new Set<uPlot>();
export function zoomTo(range?: [number, number]): void {
  const p = posOk();
  if (!p?.t.length) return;
  const [a, b] = range ?? [p.t[0], p.t[p.t.length - 1]];
  speedCharts.forEach((u) => u.setScale('x', { min: a, max: b }));
  setPosRange(range);
}
export function selectSegment(i: number): void {
  const s = segments()[i];
  if (!s) return;
  setPicked(SEG, i);
  const pad = Math.max(5, 2 * (s.stop - s.start));
  zoomTo([s.start - pad, s.stop + pad]);
}

/** The animal's path, in cm, with equal scales on both axes. Steps over the threshold are red. */
export function PathMap(props: { p: PositionQc; w: number; h: number }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const { x, y, frameT, idx, speed } = props.p;
    const [W, H] = [props.w, props.h];
    // The same map to arena cm as every analysis. QC only has a result when it exists.
    const t = positionTransform() ?? { sx: 1, sy: 1, tx: 0, ty: 0 };
    const cx = (i: number) => t.sx * x[i] + t.tx;
    const cy = (i: number) => t.sy * y[i] + t.ty;
    const thr = maxSpeed();
    const range = posRange();
    const [path, flagged] = [showPath(), showFlagged()];
    const sel = segments()[segIndex()];
    const ctx = canvas.getContext('2d');
    if (!ctx || W < 50 || H < 50) return;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i])) continue;
      [x0, x1] = [Math.min(x0, cx(i)), Math.max(x1, cx(i))];
      [y0, y1] = [Math.min(y0, cy(i)), Math.max(y1, cy(i))];
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
    const px = (i: number) => ox + (cx(i) - x0) * s;
    const py = (i: number) => oy + ph - (cy(i) - y0) * s;
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
    for (let i = 1; i < x.length && path; i++) {
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
      if (flagged && v > thr && ok(i) && ok(i - 1)) step(i);
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

export function SpeedPlot(props: { p: PositionQc; h: number }): JSX.Element {
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

export const segLabel = (s: Segment) =>
  s.kind === 'jump'
    ? `Jump, ${s.peak!.toFixed(0)} cm/s${s.n > 1 ? ` over ${s.n} steps` : ''}`
    : `Lost for ${(s.stop - s.start).toFixed(1)} s (${s.n} frames)`;

/** Each recording's progress against time on the neural clock; the two lines should start and end together. */
export function ClockPlot(props: { h: number }): JSX.Element {
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

export const timing = createMemo(() => [
  ...timingResults().flatMap((r) => timingChecks(r.name, r)),
  ...alignmentResults(),
]);

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

export function StatsTable(props: { epochs: Epoch[] }): JSX.Element {
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
export function AnnotationFixes(): JSX.Element {
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
        These apply to every annotation file and use the pass/fail limits under QC settings. The
        annotation files themselves are not changed.
      </div>
    </div>
  );
}

export const fileOf = (id: string) => annotationResults().find((a) => a.id === id);

export function behaviorCategories(): Category[] {
  const files = annotationResults();
  if (!positionResult() && !files.length && !timing().length) return [];
  return [
    {
      id: 'timing',
      name: 'Timing and alignment',
      description: 'Dropped frames, frame-time jitter and whether the clocks line up',
      checks: timing(),
      flagged: timing().filter((c) => c.status !== 'pass').length,
      flaggedWord: 'checks',
      tabs: [
        { id: 'clock', label: 'Clock' },
        { id: 'recordings', label: 'Recordings' },
      ],
      plot: (tab) => <TimingPlot tab={tab} />,
      metrics: timingMetrics,
      correction: TimingCorrection,
      correctionHint: 'Enter a clock offset in Experiment config',
    },
    {
      id: 'position',
      name: 'Position tracking',
      description: 'Lost frames, lost stretches and implausible jumps',
      checks: posOk()?.checks ?? [],
      flagged: segments().length,
      flaggedWord: 'segments',
      section: 'position',
      tabs: [
        { id: 'trajectory', label: 'Trajectory' },
        { id: 'speed', label: 'Speed' },
        { id: 'timeline', label: 'Timeline' },
      ],
      plot: (tab) => <PositionPlot tab={tab} />,
      metrics: positionMetrics,
      flaggedList: PositionFlagged,
      actions: PositionActions,
      correction: PositionCorrection,
      correctionHint: 'Fill gaps and smooth in Preprocess',
    },
    ...files.map((a): Category => ({
      id: a.id,
      name: a.name.replace(/\.[^.]+$/, ''),
      group: 'Annotations',
      description: 'Epoch errors, short bouts and bouts of one label close together',
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
      flagged: flaggedOf(a.id).length,
      flaggedWord: 'epochs',
      section: 'annotations' as const,
      tabs: [
        { id: 'epochs', label: 'Epochs' },
        { id: 'stats', label: 'Per-label stats' },
      ],
      plot: (tab) => <AnnotationPlot id={a.id} tab={tab} />,
      metrics: () => annotationMetrics(a.id),
      flaggedList: () => <AnnotationFlagged id={a.id} />,
      correction: () => <AnnotationCorrection id={a.id} />,
      correctionHint: 'Merge close bouts or remove short ones',
    })),
  ];
}
