import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { viridisRGB } from '@calab/ui/chart';
import { arena, inZone, positionsCm, pxPerCm, toPx } from '../lib/arena.ts';
import { ZONE_COLORS } from '../lib/draw.ts';
import { hoverT, setHoverT, setWinLen, span, WINDOW_CHOICES, win, winLen } from '../lib/viz.ts';
import { setWinStartClamped } from '../lib/viz.ts';
import {
  annotationResults,
  cameraTimes,
  cell,
  deconvolved,
  denoisedTrace,
  frameTimes,
  positionResult,
  rawTrace,
  selectCell,
} from '../lib/store.ts';
import { lowerBound } from '../lib/framework.ts';
import { PALETTE } from './BehaviorQc.tsx';

const W = 1200;
type Source = 'raw' | 'denoised' | 'events';
const SOURCE_LABEL: Record<Source, string> = {
  raw: 'raw fluorescence',
  denoised: 'denoised trace',
  events: 'deconvolved events',
};
const SOURCE_COLOR: Record<Source, string> = {
  raw: '#8a97a8',
  denoised: '#2171b5',
  events: '#e09800',
};

const matrixOf = (s: Source) =>
  s === 'raw' ? rawTrace() : s === 'denoised' ? denoisedTrace() : deconvolved();

/** A trace over the window: a line when there are few samples, otherwise the range of values in each pixel column. */
function drawSeries(
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

function Panel(props: {
  label: JSX.Element;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, H: number) => void;
  onClick?: (fractionY: number) => void;
}): JSX.Element {
  let c: HTMLCanvasElement | undefined;
  createEffect(() => {
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, props.height);
    props.draw(ctx, props.height);
  });
  return (
    <>
      <div class="cb-label">{props.label}</div>
      <canvas
        ref={c}
        width={W}
        height={props.height}
        class="cb-sess__canvas"
        style={{ height: `${props.height}px` }}
        onClick={(e) => {
          const r = c!.getBoundingClientRect();
          props.onClick?.((e.clientY - r.top) / r.height);
        }}
      />
    </>
  );
}

const Swatch = (props: { color: string }): JSX.Element => <i style={{ background: props.color }} />;

/** Neural data and behavior on one time axis. */
export function SessionView(): JSX.Element {
  const sources = () => (['denoised', 'raw', 'events'] as Source[]).filter((s) => matrixOf(s));
  const [traceSrc, setTraceSrc] = createSignal<Source | undefined>();
  const [heatSrc, setHeatSrc] = createSignal<Source | undefined>();
  const trace = () => (traceSrc() && matrixOf(traceSrc()!) ? traceSrc()! : sources()[0]);
  const heat = () => (heatSrc() && matrixOf(heatSrc()!) ? heatSrc()! : sources()[0]);
  const times = frameTimes;

  const heatScale = createMemo(() => {
    const s = heat();
    const m = s && matrixOf(s);
    if (!m) return undefined;
    const lo = new Float32Array(m.cells);
    const hi = new Float32Array(m.cells);
    for (let c = 0; c < m.cells; c++) {
      const row = Float32Array.from(m.data.subarray(c * m.frames, (c + 1) * m.frames)).sort();
      lo[c] = row[Math.floor(row.length * 0.05)];
      hi[c] = row[Math.floor(row.length * 0.995)];
    }
    return { lo, hi };
  });

  const epochs = createMemo(() =>
    annotationResults().flatMap((a) => (a.error ? [] : a.epochs.filter((e) => e.stop > e.start))),
  );
  const labels = createMemo(() => [...new Set(epochs().map((e) => e.label))]);
  const zones = createMemo(() => {
    const pos = positionsCm();
    if (!pxPerCm() || !arena.box || !pos.x.length)
      return [] as { name: string; color: string; runs: [number, number][] }[];
    const t = cameraTimes();
    if (!t) return [];
    return arena.zones
      .map((z, i) => ({ z, i }))
      .filter(({ z }) => z.kind === 'zone')
      .map(({ z, i }) => {
        const runs: [number, number][] = [];
        let start: number | undefined;
        for (let k = 0; k < t.length; k++) {
          const p = toPx([pos.x[k], pos.y[k]]);
          const inside = !!p && Number.isFinite(pos.x[k]) && inZone(p, z);
          if (inside && start === undefined) start = t[k];
          if (!inside && start !== undefined) {
            runs.push([start, t[k]]);
            start = undefined;
          }
        }
        if (start !== undefined) runs.push([start, t[t.length - 1]]);
        return { name: z.name, color: ZONE_COLORS[i % ZONE_COLORS.length], runs };
      });
  });

  const pos = () => {
    const p = positionResult();
    return p && 'x' in p && cameraTimes() ? p : undefined;
  };

  const readout = () => {
    const ht = hoverT();
    if (ht === undefined) return undefined;
    const active = epochs()
      .filter((e) => e.start <= ht && ht <= e.stop)
      .map((e) => e.label);
    const ct = cameraTimes();
    const p = pos();
    let where = '';
    if (ct && p) {
      const i = Math.min(lowerBound(ct, ht), ct.length - 1);
      if (Number.isFinite(p.x[i]))
        where = `, position (${p.x[i].toFixed(1)}, ${p.y[i].toFixed(1)})`;
    }
    return `${ht.toFixed(1)} s${where}${active.length ? `, behavior: ${active.join(', ')}` : ''}`;
  };

  const ticks = () => {
    const [a, b] = win();
    return Array.from({ length: 6 }, (_, k) => a + ((b - a) * k) / 5);
  };

  return (
    <section class="cb-group">
      <h3>Session view</h3>
      <div class="cb-controls">
        <label>
          Window
          <select value={String(winLen())} onChange={(e) => setWinLen(+e.currentTarget.value)}>
            <For each={WINDOW_CHOICES}>{(w) => <option value={String(w.s)}>{w.label}</option>}</For>
          </select>
        </label>
        <button
          class="btn-secondary btn-small"
          onClick={() => setWinStartClamped(win()[0] - (win()[1] - win()[0]) / 2)}
        >
          Earlier
        </button>
        <button
          class="btn-secondary btn-small"
          onClick={() => setWinStartClamped(win()[0] + (win()[1] - win()[0]) / 2)}
        >
          Later
        </button>
        <label class="cb-grow">
          Start
          <input
            type="range"
            class="cb-grow"
            min={span()[0]}
            max={Math.max(span()[0], span()[1] - (win()[1] - win()[0]))}
            step="0.1"
            value={win()[0]}
            onInput={(e) => setWinStartClamped(+e.currentTarget.value)}
          />
          {win()[0].toFixed(0)} to {win()[1].toFixed(0)} s
        </label>
      </div>
      <Show when={sources().length}>
        <div class="cb-controls">
          <label>
            Cell trace shows
            <select value={trace()} onChange={(e) => setTraceSrc(e.currentTarget.value as Source)}>
              <For each={sources()}>{(s) => <option value={s}>{SOURCE_LABEL[s]}</option>}</For>
            </select>
          </label>
          <label>
            Heat map shows
            <select value={heat()} onChange={(e) => setHeatSrc(e.currentTarget.value as Source)}>
              <For each={sources()}>{(s) => <option value={s}>{SOURCE_LABEL[s]}</option>}</For>
            </select>
          </label>
        </div>
      </Show>
      <div
        class="cb-sess"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - r.left) / r.width;
          setHoverT(f >= 0 && f <= 1 ? win()[0] + f * (win()[1] - win()[0]) : undefined);
        }}
        onMouseLeave={() => setHoverT(undefined)}
      >
        <Show when={hoverT() !== undefined}>
          <div
            class="cb-sess__line"
            style={{ left: `${((hoverT()! - win()[0]) / (win()[1] - win()[0])) * 100}%` }}
          />
        </Show>

        <Show when={trace() && times()}>
          <Panel
            height={110}
            label={
              <>
                <Swatch color={SOURCE_COLOR[trace()!]} />
                Cell {cell() + 1}: {SOURCE_LABEL[trace()!]}
              </>
            }
            draw={(ctx, H) => {
              const m = matrixOf(trace()!)!;
              drawSeries(
                ctx,
                H,
                times()!,
                m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames),
                win(),
                SOURCE_COLOR[trace()!],
              );
            }}
          />
          <Show when={heatScale()}>
            <Panel
              height={150}
              label={`All cells: ${SOURCE_LABEL[heat()!]}, each cell on its own scale. Click a row to select that cell.`}
              onClick={(f) =>
                selectCell(
                  Math.min(matrixOf(heat()!)!.cells - 1, Math.floor(f * matrixOf(heat()!)!.cells)),
                )
              }
              draw={(ctx, H) => {
                const m = matrixOf(heat()!)!;
                const sc = heatScale()!;
                const t = times()!;
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
        </Show>

        <Show when={labels().length}>
          <div class="cb-label">Annotated behavior</div>
          <div class="cb-legend">
            <For each={labels()}>
              {(l, i) => (
                <span class="cb-legend__item">
                  <i style={{ background: PALETTE[i() % PALETTE.length] }} />
                  {l}
                </span>
              )}
            </For>
          </div>
          <Panel
            height={labels().length * 22 + 6}
            label=""
            draw={(ctx) =>
              drawBars(
                ctx,
                labels().map((l, i) => ({
                  color: PALETTE[i % PALETTE.length],
                  runs: epochs()
                    .filter((e) => e.label === l)
                    .map((e) => [e.start, e.stop] as [number, number]),
                })),
                22,
                win(),
              )
            }
          />
        </Show>

        <Show when={zones().length}>
          <div class="cb-label">Zones: when the animal is inside</div>
          <div class="cb-legend">
            <For each={zones()}>
              {(z) => (
                <span class="cb-legend__item">
                  <i style={{ background: z.color }} />
                  {z.name}
                </span>
              )}
            </For>
          </div>
          <Panel
            height={zones().length * 22 + 6}
            label=""
            draw={(ctx) => drawBars(ctx, zones(), 22, win())}
          />
        </Show>

        <Show when={pos()}>
          <Panel
            height={110}
            label={
              <>
                <Swatch color="#2171b5" />
                Position x <Swatch color="#e09800" />
                Position y (position units)
              </>
            }
            draw={(ctx, H) => {
              const p = pos()!;
              const all = [...p.x, ...p.y].filter(Number.isFinite);
              const range: [number, number] = [Math.min(...all), Math.max(...all)];
              drawSeries(ctx, H, cameraTimes()!, p.x, win(), '#2171b5', range);
              drawSeries(ctx, H, cameraTimes()!, p.y, win(), '#e09800', range);
            }}
          />
          <Panel
            height={90}
            label={
              <>
                <Swatch color="#2e7d32" />
                Speed (cm/s)
              </>
            }
            draw={(ctx, H) => drawSeries(ctx, H, pos()!.t, pos()!.speed, win(), '#2e7d32')}
          />
        </Show>
      </div>
      <div class="cb-axis">
        <For each={ticks()}>
          {(v) => <span>{v.toFixed(v - Math.floor(v) < 0.05 ? 0 : 1)}</span>}
        </For>
      </div>
      <div class="cb-muted">
        Time (s).{' '}
        {readout() ??
          'Move the mouse over a plot to read the time, position and behavior at that moment.'}
      </div>
    </section>
  );
}
