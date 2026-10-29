import { createEffect, For, Show, type JSX } from 'solid-js';
import { viridisRGB } from '@calab/ui/chart';
import { cameraTimes, cell, selectCell } from '../lib/store.ts';
import { lowerBound } from '../lib/framework.ts';
import { hoverT, setHoverT, win } from '../lib/viz.ts';
import {
  colorOf,
  epochs,
  frameBands,
  heat,
  markersInView,
  markerNear,
  heatScale,
  hiddenCount,
  isOn,
  matrixOf,
  neuralT,
  openTracks,
  pos,
  readout,
  shownRows,
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

/** Epochs shaded across a row, and time markers as thin lines, so every row shows when things happened. */
function drawOverlay(ctx: CanvasRenderingContext2D, H: number, [t0, t1]: [number, number]): void {
  const X = (v: number) => ((v - t0) / (t1 - t0)) * W;
  ctx.save();
  ctx.globalAlpha = 0.13;
  for (const e of epochs()) {
    if (e.stop < t0 || e.start > t1) continue;
    ctx.fillStyle = colorOf(e.label);
    const a = X(Math.max(e.start, t0));
    ctx.fillRect(a, 0, Math.max(X(Math.min(e.stop, t1)) - a, 1), H);
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
}): JSX.Element {
  let c: HTMLCanvasElement | undefined;
  createEffect(() => {
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, props.height);
    props.draw(ctx, props.height);
    if (props.overlay !== false) drawOverlay(ctx, props.height, win());
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
        <span class="cb-trk__name">{props.label}</span>
        <Show when={props.help}>{(h) => <HowTo title={h().title}>{h().text}</HowTo>}</Show>
      </div>
      <div
        class="cb-trk__plot"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          setHoverT(f >= 0 && f <= 1 ? win()[0] + f * (win()[1] - win()[0]) : undefined);
        }}
        onMouseLeave={() => setHoverT(undefined)}
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

/** The selected cell's raw, denoised and deconvolved traces over the shared window. */
export function SelectedCellRows(): JSX.Element {
  return (
    <div class="cb-trks">
      <Show
        when={neuralT() && sources().length}
        fallback={
          <div class="cb-note">
            Load raw or denoised traces, or deconvolved events, to see the selected cell.
          </div>
        }
      >
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
              height={110}
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
      </Show>
    </div>
  );
}

/** Heat map, behavior and zone rows, position and speed on one time axis, then the readout. */
export function Timeline(): JSX.Element {
  const ticks = () => {
    const [a, b] = win();
    return Array.from({ length: 6 }, (_, k) => a + ((b - a) * k) / 5);
  };
  const firstOfKind = (i: number) => shownRows()[i - 1]?.kind !== shownRows()[i].kind;
  return (
    <div class="cb-trks">
      <Show when={!heatScale() && !shownRows().length && !pos()}>
        <div class="cb-note">
          Load neural data, behavior annotations or position to fill the session timeline.
        </div>
      </Show>
      <Show when={heatScale() && neuralT()}>
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
            selectCell(
              Math.min(matrixOf(heat()!)!.cells - 1, Math.floor(f * matrixOf(heat()!)!.cells)),
            )
          }
          draw={(ctx, H) => {
            const m = matrixOf(heat()!)!;
            const sc = heatScale()!;
            const t = neuralT()!;
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
      </Show>
      <For each={shownRows()}>
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
            draw={(ctx, H) => drawBars(ctx, [r], H, win())}
          />
        )}
      </For>
      <Show when={hiddenCount() > 0}>
        <div class="cb-trk__more">
          <button type="button" class="cb-link" onClick={(e) => openTracks(e.currentTarget)}>
            +{hiddenCount()} hidden {hiddenCount() === 1 ? 'track' : 'tracks'}
          </button>
        </div>
      </Show>
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
      <Show when={pos() && isOn('position')}>
        <Track
          label={
            <>
              <Swatch color="#2171b5" />x <Swatch color="#e09800" />y
              <span class="cb-muted"> position</span>
            </>
          }
          help={HELP.position}
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
      <Show when={pos() && isOn('speed')}>
        <Track
          label={
            <>
              <Swatch color="#2e7d32" />
              Speed <span class="cb-muted">cm/s</span>
            </>
          }
          help={HELP.speed}
          grow={1.5}
          min={30}
          height={90}
          draw={(ctx, H) => drawSeries(ctx, H, pos()!.t, pos()!.speed, win(), '#2e7d32')}
        />
      </Show>
      <div class="cb-trk cb-trk--axis">
        <div class="cb-trk__lab cb-muted">Time (s)</div>
        <div class="cb-axis">
          <For each={ticks()}>
            {(v) => <span>{v.toFixed(v - Math.floor(v) < 0.05 ? 0 : 1)}</span>}
          </For>
        </div>
      </div>
      <div class="cb-muted cb-trks__readout">
        {readout() ??
          'Move the mouse over a plot to read the time, position and behavior at that moment.'}
      </div>
    </div>
  );
}
