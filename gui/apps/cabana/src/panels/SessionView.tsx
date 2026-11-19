import { createEffect, createSignal, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { viridisRGB } from '@calab/ui/chart';
import { cameraTimes, cell, selectCell } from '../lib/store.ts';
import { lowerBound } from '../lib/framework.ts';
import { hoverT, setHoverT, win } from '../lib/viz.ts';
import { allBouts, hoverBout, intensity, setHoverBout, stripes } from '../lib/overlay-state.ts';
import { ALPHA, boutTip, hitRow, hitStripe, sameBout, stripeBox } from '../lib/overlays.ts';
import {
  colorOf,
  frameBands,
  heat,
  markersInView,
  markerNear,
  heatScale,
  isOn,
  matrixOf,
  neuralT,
  pos,
  rows,
  setChoice,
  SOURCE_COLOR,
  SOURCE_LABEL,
  sources,
  type Source,
} from '../lib/viz-tracks.ts';
import { HowTo } from './QcParts.tsx';
import { HELP } from './VizHelp.tsx';

const W = 1200;

/** A trace over the window: a line when there are few samples, otherwise the range of values in each pixel column. */
export function drawSeries(
  ctx: CanvasRenderingContext2D,
  H: number,
  t: ArrayLike<number>,
  y: ArrayLike<number>,
  [t0, t1]: [number, number],
  color: string,
  range?: [number, number],
): void {
  const lo = lowerBound(t, t0);
  const hi = Math.min(lowerBound(t, t1) + 1, t.length);
  let [ymin, ymax] = range ?? [Infinity, -Infinity];
  if (!range)
    for (let i = lo; i < hi; i++)
      if (Number.isFinite(y[i])) [ymin, ymax] = [Math.min(ymin, y[i]), Math.max(ymax, y[i])];
  if (!(ymax > ymin)) [ymin, ymax] = [ymin - 1, ymax + 1];
  const pad = range ? 0 : (ymax - ymin) * 0.05;
  const X = (v: number) => ((v - t0) / (t1 - t0)) * W;
  const Y = (v: number) => H - 4 - ((v - (ymin - pad)) / (ymax + pad - (ymin - pad))) * (H - 8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (hi - lo <= 4 * W) {
    let pen = false;
    for (let i = lo; i < hi; i++) {
      if (!Number.isFinite(y[i])) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(X(t[i]), Y(y[i]));
      else ctx.moveTo(X(t[i]), Y(y[i]));
      pen = true;
    }
  } else {
    const mn = new Float64Array(W).fill(Infinity);
    const mx = new Float64Array(W).fill(-Infinity);
    for (let i = lo; i < hi; i++) {
      const c = Math.min(W - 1, Math.max(0, Math.floor(X(t[i]))));
      if (!Number.isFinite(y[i])) continue;
      mn[c] = Math.min(mn[c], y[i]);
      mx[c] = Math.max(mx[c], y[i]);
    }
    for (let c = 0; c < W; c++)
      if (mx[c] >= mn[c]) {
        ctx.moveTo(c + 0.5, Y(mn[c]));
        ctx.lineTo(c + 0.5, Y(mx[c]));
      }
  }
  ctx.stroke();
}

/** Bars where a yes/no signal is on, one row each. */
function drawBars(
  ctx: CanvasRenderingContext2D,
  rows: { color: string; runs: [number, number][] }[],
  rowH: number,
  [t0, t1]: [number, number],
): void {
  rows.forEach((r, k) => {
    ctx.fillStyle = r.color;
    for (const [a, b] of r.runs) {
      if (b < t0 || a > t1) continue;
      const x = ((Math.max(a, t0) - t0) / (t1 - t0)) * W;
      ctx.fillRect(
        x,
        k * rowH + 3,
        Math.max(((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * W, 1.5),
        rowH - 6,
      );
    }
  });
}

/**
 * Shown behavior bouts shaded across a row, and time markers as thin lines. Bouts that overlap
 * share the height, one stripe per behavior, so colors are never blended.
 */
function drawOverlay(ctx: CanvasRenderingContext2D, H: number, [t0, t1]: [number, number]): void {
  const X = (v: number) => ((v - t0) / (t1 - t0)) * W;
  ctx.save();
  ctx.globalAlpha = ALPHA[intensity()];
  for (const s of stripes()) {
    const { start, stop, label } = s.bout;
    if (stop < t0 || start > t1) continue;
    const [top, h] = stripeBox(s);
    ctx.fillStyle = colorOf(label);
    const a = X(Math.max(start, t0));
    ctx.fillRect(a, top * H, Math.max(X(Math.min(stop, t1)) - a, 1), h * H);
  }
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  for (const m of markersInView()) {
    if (m.timeS < t0 || m.timeS > t1) continue;
    ctx.strokeStyle = colorOf(m.label);
    ctx.beginPath();
    ctx.moveTo(Math.round(X(m.timeS)) + 0.5, 0);
    ctx.lineTo(Math.round(X(m.timeS)) + 0.5, H);
    ctx.stroke();
  }
  ctx.restore();
}

const Swatch = (props: { color: string }): JSX.Element => <i style={{ background: props.color }} />;

/** What a row shows when its checkbox is off: a dashed line, so the row and its checkbox stay. */
function drawOff(ctx: CanvasRenderingContext2D, H: number): void {
  ctx.strokeStyle = '#d4d4d4';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The checkbox in front of a row's label; it turns the row's drawing on or off. */
const RowToggle = (props: {
  name: string;
  on: boolean;
  set: (on: boolean) => void;
}): JSX.Element => (
  <input
    type="checkbox"
    class="cb-trk__chk"
    aria-label={`Show ${props.name}`}
    checked={props.on}
    onChange={(e) => props.set(e.currentTarget.checked)}
  />
);

/**
 * One temporal row: a label column (with its own help button) and a plot area. Every row uses the
 * same columns, so all time axes line up. Hovering sets the shared time, drawn as a dashed line.
 */
function Track(props: {
  label: JSX.Element;
  help?: { title: string; text: JSX.Element };
  /** Drawing height in canvas pixels; the row itself stretches to the space it gets. */
  height: number;
  /** Share of the free height; 0 for a row of fixed height `min`. */
  grow?: number;
  min?: number;
  draw: (ctx: CanvasRenderingContext2D, H: number) => void;
  onClick?: (fractionY: number) => void;
  /** Rows that already show the epochs or markers themselves leave the overlay off. */
  overlay?: boolean;
  /** Show the label of the nearest time marker beside the cursor. */
  markerLabels?: boolean;
  /** A timeline row of this behavior: hovering a bout in it links to the plots. */
  rowLabel?: string;
  /** A checkbox before the label; off draws a dashed line in the row. */
  toggle?: { name: string; on: boolean; set: (on: boolean) => void };
}): JSX.Element {
  let c: HTMLCanvasElement | undefined;
  let hl: HTMLCanvasElement | undefined;
  const [mouse, setMouse] = createSignal<{ x: number; y: number }>();
  createEffect(() => {
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, props.height);
    if (props.toggle && !props.toggle.on) return drawOff(ctx, props.height);
    props.draw(ctx, props.height);
    if (props.overlay !== false) drawOverlay(ctx, props.height, win());
  });
  // The outline of the hovered bout, on its own canvas so hovering never redraws the plot.
  createEffect(() => {
    const ctx = hl?.getContext('2d');
    if (!hl || !ctx) return;
    const [t0, t1] = win();
    const hb = hoverBout();
    ctx.clearRect(0, 0, W, props.height);
    if (!hb || hb.stop < t0 || hb.start > t1) return;
    const X = (v: number) => ((v - t0) / (t1 - t0)) * W;
    let top = 0;
    let h = 1;
    if (props.rowLabel !== undefined) {
      if (hb.label !== props.rowLabel) return;
    } else if (props.overlay !== false) {
      const s = stripes().find((x) => sameBout(x.bout, hb));
      if (!s) return;
      [top, h] = stripeBox(s);
    } else return;
    const a = X(Math.max(hb.start, t0));
    const w = Math.max(X(Math.min(hb.stop, t1)) - a, 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1b2733';
    ctx.strokeRect(a + 1, top * props.height + 1, Math.max(w - 2, 1), h * props.height - 2);
  });
  const nearMarker = () =>
    props.markerLabels && hoverT() !== undefined
      ? markerNear(hoverT()!, (win()[1] - win()[0]) / 200)
      : undefined;
  const left = () => ((hoverT()! - win()[0]) / (win()[1] - win()[0])) * 100;
  return (
    <div
      class="cb-trk"
      style={{
        flex: props.grow === 0 ? `0 0 ${props.min}px` : `${props.grow ?? 1} 1 0`,
        'min-height': `${props.min ?? 40}px`,
      }}
    >
      <div class="cb-trk__lab">
        <Show when={props.toggle}>
          {(t) => <RowToggle name={t().name} on={t().on} set={t().set} />}
        </Show>
        <span class="cb-trk__name">{props.label}</span>
        <Show when={props.help}>{(h) => <HowTo title={h().title}>{h().text}</HowTo>}</Show>
      </div>
      <div
        class="cb-trk__plot"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          const inside = f >= 0 && f <= 1;
          const t = win()[0] + f * (win()[1] - win()[0]);
          setHoverT(inside ? t : undefined);
          // Bouts thinner than 3 pixels stay hoverable.
          const tol = (3 / r.width) * (win()[1] - win()[0]);
          const fy = (e.clientY - r.top) / r.height;
          setHoverBout(
            !inside
              ? undefined
              : props.rowLabel !== undefined
                ? hitRow(allBouts(), props.rowLabel, t, tol)
                : props.overlay !== false
                  ? hitStripe(stripes(), t, fy, tol)?.bout
                  : undefined,
          );
          setMouse({ x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => {
          setHoverT(undefined);
          setHoverBout(undefined);
          setMouse(undefined);
        }}
      >
        <canvas
          ref={c}
          width={W}
          height={props.height}
          onClick={(e) => {
            const r = c!.getBoundingClientRect();
            props.onClick?.((e.clientY - r.top) / r.height);
          }}
        />
        <canvas ref={hl} class="cb-trk__hl" width={W} height={props.height} aria-hidden="true" />
        <Show when={mouse() && hoverBout()}>
          {(hb) => (
            <Portal>
              <div
                class="cb-bouttip"
                role="tooltip"
                style={{ left: `${mouse()!.x + 12}px`, top: `${mouse()!.y + 14}px` }}
              >
                <strong>
                  <i style={{ background: colorOf(hb().label) }} />
                  {boutTip(hb()).title}
                </strong>
                <For each={boutTip(hb()).lines}>{(l) => <span>{l}</span>}</For>
              </div>
            </Portal>
          )}
        </Show>
        <Show when={hoverT() !== undefined && left() >= 0 && left() <= 100}>
          <div class="cb-trk__line" style={{ left: `${left()}%` }} />
        </Show>
        <Show when={nearMarker()}>
          {(m) => (
            <span class="cb-trk__tip" style={{ left: `${left()}%` }}>
              {m().label} · {m().timeS.toFixed(2)} s
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

const CELL_ROWS: { src: Source; label: string }[] = [
  { src: 'raw', label: 'Raw fluorescence' },
  { src: 'denoised', label: 'Denoised trace' },
  { src: 'events', label: 'Deconvolved events' },
];

/** Time ticks under the rows; the same columns as the rows, so it lines up with them. */
function Axis(): JSX.Element {
  const ticks = () => {
    const [a, b] = win();
    return Array.from({ length: 6 }, (_, k) => a + ((b - a) * k) / 5);
  };
  return (
    <div class="cb-trk cb-trk--axis">
      <div class="cb-trk__lab cb-muted">Time (s)</div>
      <div class="cb-axis">
        <For each={ticks()}>
          {(v) => <span>{v.toFixed(v - Math.floor(v) < 0.05 ? 0 : 1)}</span>}
        </For>
      </div>
    </div>
  );
}

/** Every cell over the window, one row per cell; clicking a row selects that cell. */
function HeatTrack(): JSX.Element {
  return (
    <Track
      label={
        <>
          All cells
          <span class="cb-muted"> {SOURCE_LABEL[heat()!]}</span>
        </>
      }
      help={HELP.heat}
      grow={3}
      min={40}
      height={150}
      onClick={(f) =>
        selectCell(Math.min(matrixOf(heat()!)!.cells - 1, Math.floor(f * matrixOf(heat()!)!.cells)))
      }
      draw={(ctx, H) => {
        // Clearing the session empties the data before this box unmounts.
        const h = heat();
        const m = h && matrixOf(h);
        const sc = heatScale();
        const t = neuralT();
        if (!m || !sc || !t) return;
        const [t0, t1] = win();
        const img = ctx.createImageData(W, m.cells);
        for (let x = 0; x < W; x++) {
          const a = lowerBound(t, t0 + ((t1 - t0) * x) / W);
          const b = Math.max(a + 1, lowerBound(t, t0 + ((t1 - t0) * (x + 1)) / W));
          for (let c = 0; c < m.cells; c++) {
            let sum = 0;
            for (let i = a; i < Math.min(b, m.frames); i++) sum += m.data[c * m.frames + i];
            const v =
              (sum / Math.max(1, Math.min(b, m.frames) - a) - sc.lo[c]) /
              (sc.hi[c] - sc.lo[c] || 1);
            const [r, g, bl] = viridisRGB(v);
            img.data.set([r, g, bl, 255], (c * W + x) * 4);
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = m.cells;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, (cell() / m.cells) * H - 1, 10, Math.max(3, H / m.cells + 2));
      }}
    />
  );
}

/** Neural data on the shared window: the all-cell heat map, then the selected cell's traces. */
export function NeuralRows(): JSX.Element {
  return (
    <div class="cb-trks">
      <Show
        when={neuralT() && sources().length}
        fallback={
          <div class="cb-note">
            Load raw or denoised traces, or deconvolved events, to see the neural data.
          </div>
        }
      >
        <Show when={heatScale()}>
          <HeatTrack />
        </Show>
        <For each={CELL_ROWS.filter((r) => matrixOf(r.src))}>
          {(r) => (
            <Track
              label={
                <>
                  <Swatch color={SOURCE_COLOR[r.src]} />
                  {r.label}
                </>
              }
              help={HELP[r.src]}
              min={22}
              height={110}
              toggle={{
                name: r.label,
                on: isOn(`trace:${r.src}`),
                set: (on) => setChoice(`trace:${r.src}`, on),
              }}
              draw={(ctx, H) => {
                const m = matrixOf(r.src)!;
                drawSeries(
                  ctx,
                  H,
                  neuralT()!,
                  m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames),
                  win(),
                  SOURCE_COLOR[r.src],
                );
              }}
            />
          )}
        </For>
        <Axis />
      </Show>
    </div>
  );
}

/** Behavior and zone rows, time markers, frame labels, position and speed on the shared window. */
export function BehaviorRows(): JSX.Element {
  const firstOfKind = (i: number) => rows()[i - 1]?.kind !== rows()[i].kind;
  return (
    <div class="cb-trks">
      <Show when={!rows().length && !pos() && !markersInView().length && !frameBands().length}>
        <div class="cb-note">Load behavior annotations, zones or position to see them here.</div>
      </Show>
      <For each={rows()}>
        {(r, i) => (
          <Track
            label={
              <>
                <Swatch color={r.color} />
                <span title={r.name}>{r.name}</span>
              </>
            }
            help={firstOfKind(i()) ? HELP[r.kind === 'Zone' ? 'zone' : 'behavior'] : undefined}
            grow={0}
            min={18}
            height={20}
            overlay={false}
            rowLabel={r.kind === 'Behavior' ? r.name : undefined}
            toggle={{
              name: r.name,
              on: isOn(r.key, i()),
              set: (on) => setChoice(r.key, on),
            }}
            draw={(ctx, H) => drawBars(ctx, [r], H, win())}
          />
        )}
      </For>
      <Show when={markersInView().length}>
        <Track
          label={<>Time markers</>}
          grow={0}
          min={18}
          height={20}
          overlay={false}
          markerLabels
          draw={(ctx, H) => {
            const [t0, t1] = win();
            for (const m of markersInView()) {
              if (m.timeS < t0 || m.timeS > t1) continue;
              ctx.fillStyle = colorOf(m.label);
              ctx.fillRect(Math.round(((m.timeS - t0) / (t1 - t0)) * W) - 1, 2, 2, H - 4);
            }
          }}
        />
      </Show>
      <For each={frameBands()}>
        {(b) => (
          <Track
            label={
              <>
                <Swatch color={b.runs[0]?.color ?? '#999'} />
                <span title={`${b.name} (frame labels)`}>{b.name}</span>
              </>
            }
            grow={0}
            min={18}
            height={20}
            overlay={false}
            draw={(ctx, H) => b.runs.forEach((g) => drawBars(ctx, [g], H, win()))}
          />
        )}
      </For>
      <Show when={pos()}>
        <Track
          label={
            <>
              <Swatch color="#2171b5" />x <Swatch color="#e09800" />y
              <span class="cb-muted"> position</span>
            </>
          }
          help={HELP.position}
          toggle={{
            name: 'position',
            on: isOn('position'),
            set: (on) => setChoice('position', on),
          }}
          grow={2}
          min={36}
          height={110}
          draw={(ctx, H) => {
            const p = pos()!;
            const all = [...p.x, ...p.y].filter(Number.isFinite);
            const range: [number, number] = [Math.min(...all), Math.max(...all)];
            drawSeries(ctx, H, cameraTimes()!, p.x, win(), '#2171b5', range);
            drawSeries(ctx, H, cameraTimes()!, p.y, win(), '#e09800', range);
          }}
        />
      </Show>
      <Show when={pos()}>
        <Track
          label={
            <>
              <Swatch color="#2e7d32" />
              Speed <span class="cb-muted">cm/s</span>
            </>
          }
          help={HELP.speed}
          toggle={{ name: 'speed', on: isOn('speed'), set: (on) => setChoice('speed', on) }}
          grow={1.5}
          min={30}
          height={90}
          draw={(ctx, H) => drawSeries(ctx, H, pos()!.t, pos()!.speed, win(), '#2e7d32')}
        />
      </Show>
      {/* Stays at the bottom of the box when the rows scroll. */}
      <div class="cb-trks__foot">
        <Axis />
      </div>
    </div>
  );
}
