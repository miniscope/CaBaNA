import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { viridisCss, viridisRGB } from '@calab/ui/chart';
import {
  arena,
  binGrid,
  effectiveBin,
  frame,
  frameVersion,
  occupancy,
  positionsCm,
  pxPerCm,
  toPx,
  type Pt,
} from '../lib/arena.ts';
import { arenaOutline, drawZones } from '../lib/draw.ts';
import { cameraTimes, positionResult } from '../lib/store.ts';
import { lowerBound } from '../lib/framework.ts';
import { hoverT, span, win } from '../lib/viz.ts';

/** Whether the arena is set up, so positions can be drawn on its picture. */
export const placed = () => !!(pxPerCm() && arena.box && frame());

/** The path of the animal over the arena, colored by time, or the time spent in each bin. */
/** `bare` leaves out the heading and the choice of view; `mode` then picks the view. */
/** `linked` fills its box with a gray path, the session window in blue and a red dot at the hovered time. */
export function Trajectory(props: {
  bare?: boolean;
  mode?: 'path' | 'time';
  linked?: boolean;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let dot: HTMLCanvasElement | undefined;
  const [drawn, setDrawn] = createSignal<{ pts: (Pt | undefined)[]; w: number; h: number }>();
  const [chosen, setMode] = createSignal<'path' | 'time'>('path');
  const mode = () => props.mode ?? chosen();

  createEffect(() => {
    const c = canvas;
    const ctx = c?.getContext('2d');
    const p = positionResult();
    if (!c || !ctx || !p || !('x' in p)) return;
    frameVersion();
    const t = cameraTimes();
    const cm = positionsCm();
    const SIZE = 640;

    // Where each position lands on the canvas: on the arena picture when the arena is set up, else fitted to the data.
    let pts: (Pt | undefined)[];
    if (placed()) {
      const f = frame()!;
      c.width = f.canvas.width;
      c.height = f.canvas.height;
      ctx.drawImage(f.canvas, 0, 0);
      pts = cm.x.map((x, i) => (Number.isFinite(x + cm.y[i]) ? toPx([x, cm.y[i]]) : undefined));
    } else {
      const ok = p.x.map((x, i) => Number.isFinite(x + p.y[i]));
      const xs = p.x.filter((_, i) => ok[i]);
      const ys = p.y.filter((_, i) => ok[i]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = (SIZE - 40) / Math.max(x1 - x0, y1 - y0, 1e-9);
      c.width = Math.round((x1 - x0) * k + 40);
      c.height = Math.round((y1 - y0) * k + 40);
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, c.width, c.height);
      pts = p.x.map((x, i) =>
        ok[i] ? [20 + (x - x0) * k, c.height - 20 - (p.y[i] - y0) * k] : undefined,
      );
    }
    const lw = Math.max(1.5, c.width / 450);

    if (placed()) {
      arenaOutline(ctx, arena.box, arena.shape);
      ctx.strokeStyle = '#2171b5';
      ctx.lineWidth = lw * 1.5;
      ctx.stroke();
      if (mode() === 'time') {
        const g = binGrid(effectiveBin());
        const b = arena.box!;
        const s = pxPerCm()!;
        if (g) {
          const occ = occupancy(g);
          const open = [...occ].filter((_, i) => g.open[i]).sort((a, d) => a - d);
          const top = open[Math.floor(open.length * 0.95)] || 1;
          ctx.save();
          arenaOutline(ctx, b, arena.shape);
          ctx.clip();
          for (let j = 0; j < g.ny; j++)
            for (let i = 0; i < g.nx; i++) {
              const k = j * g.nx + i;
              ctx.fillStyle = g.open[k]
                ? viridisCss(Math.min(1, occ[k] / top))
                : 'rgba(90,90,90,0.6)';
              ctx.fillRect(
                b.x + i * g.bin * s,
                b.y + b.h - (j + 1) * g.bin * s,
                g.bin * s,
                g.bin * s,
              );
            }
          ctx.restore();
        }
      }
      drawZones(ctx, arena.zones, lw, Math.max(12, c.width / 50));
    }
    if (mode() === 'path' || !placed()) {
      const n = pts.length;
      ctx.lineWidth = lw;
      for (let i = 1; i < n; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        const [r, g, bl] = props.linked ? [190, 196, 205] : viridisRGB(i / n);
        ctx.strokeStyle = `rgba(${r},${g},${bl},0.75)`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      // The time window of the session view, drawn thick.
      if (t) {
        const [w0, w1] = win();
        ctx.strokeStyle = props.linked ? '#2171b5' : '#e8590c';
        ctx.lineWidth = lw * 2.2;
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const q = pts[i];
          if (!q || t[i] < w0 || t[i] > w1) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
          pen = true;
        }
        ctx.stroke();
      }
    }
    setDrawn({ pts, w: c.width, h: c.height });
  });

  // The red dot at the hovered time, on its own canvas so hovering does not redraw the path.
  createEffect(() => {
    const d = drawn();
    const ctx = dot?.getContext('2d');
    if (!dot || !ctx || !d) return;
    if (dot.width !== d.w) dot.width = d.w;
    dot.height = d.h;
    const t = cameraTimes();
    const ht = hoverT();
    const q = t && ht !== undefined ? d.pts[Math.min(lowerBound(t, ht), t.length - 1)] : undefined;
    if (!q) return;
    ctx.beginPath();
    ctx.arc(q[0], q[1], Math.max(5, d.w / 90), 0, 2 * Math.PI);
    ctx.fillStyle = '#d32f2f';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, d.w / 400);
    ctx.stroke();
  });

  return (
    <Show when={positionResult() && 'x' in positionResult()!}>
      <section classList={{ 'cb-group': !props.linked, 'cb-trajfill': props.linked }}>
        <Show when={!props.bare}>
          <h3>Position</h3>
        </Show>
        <Show
          when={placed()}
          fallback={
            <div class="cb-note">
              Set up the arena in Experimental Setup to see the path on the arena, with zones and
              bins.
            </div>
          }
        >
          <div class="cb-controls" hidden={props.bare}>
            <label>
              Show
              <select
                value={mode()}
                onChange={(e) => setMode(e.currentTarget.value as 'path' | 'time')}
              >
                <option value="path">Path of the animal</option>
                <option value="time">Time spent in each bin</option>
              </select>
            </label>
          </div>
        </Show>
        <div classList={{ 'cb-trajfill__box': props.linked }}>
          <canvas
            ref={canvas}
            class="cb-arena-canvas cb-traj"
            aria-label="Position of the animal"
          />
          <Show when={props.linked}>
            <canvas ref={dot} class="cb-traj__dot" aria-hidden="true" />
          </Show>
        </div>
        <div class="cb-legend" hidden={props.linked}>
          <Show when={mode() === 'path' || !placed()}>
            <span>Path, start</span>
            <span class="cb-legend__bar cb-legend__bar--viridis" />
            <span>
              end ({Math.round(span()[0]) || 0} to {Math.round(span()[1])} s)
            </span>
            <span class="cb-legend__item">
              <i style={{ background: '#e8590c' }} />
              thick: the window in the session view
            </span>
          </Show>
          <Show when={mode() === 'time' && placed()}>
            <span>Time in a bin, low</span>
            <span class="cb-legend__bar cb-legend__bar--viridis" />
            <span>high</span>
            <span class="cb-legend__item">
              <i style={{ background: 'rgba(90,90,90,0.6)' }} />
              excluded
            </span>
          </Show>
        </div>
      </section>
    </Show>
  );
}
