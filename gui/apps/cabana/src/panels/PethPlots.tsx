// Drawing for the PETH pages: line plots and the histogram in SVG, the heatmap and the raster in
// canvas. Every plot is drawn at the pixel size of its box (see `Fit`), so text keeps its size.

import { createEffect, For, Show, type JSX } from 'solid-js';

export const ORANGE = '#e8851a';
export const PURPLE = '#6a3db8';
export const GRAY = '#8c959f';
const TEXT = '#444';
const MUTED = '#666';
const FONT = '11px system-ui, -apple-system, sans-serif';

export const num = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '–');
/** p-values: three decimals, with a floor for very small ones. */
export const fmtP = (p: number) => (!Number.isFinite(p) ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(3));

/** Round tick values covering [lo, hi], about `n` of them. */
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Whole-second ticks along a time axis in seconds, thinned for long windows. */
export function timeTicks(lo: number, hi: number): number[] {
  const step = hi - lo > 20 ? 5 : hi - lo > 10 ? 2 : 1;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/** Width kept free right of the plot area wherever a raster and the curve below it must line up. */
export const SIDE = 70;

export interface Margin {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** A canvas drawn at its pixel size and sharp on high-density screens. */
export function Canvas(props: {
  w: number;
  h: number;
  label: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
  onClick?: (x: number, y: number) => void;
}): JSX.Element {
  let el!: HTMLCanvasElement;
  createEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(props.w * dpr);
    el.height = Math.round(props.h * dpr);
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;
    props.draw(ctx);
  });
  return (
    <canvas
      ref={el}
      role="img"
      aria-label={props.label}
      style={{ width: `${props.w}px`, height: `${props.h}px`, cursor: props.onClick ? 'pointer' : undefined }}
      onClick={(e) => {
        const r = el.getBoundingClientRect();
        props.onClick?.(e.clientX - r.left, e.clientY - r.top);
      }}
    />
  );
}

/** Text on a canvas: `anchor` is the textAlign, optional rotation in radians about the point. */
export function put(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  anchor: CanvasTextAlign = 'center',
  color = MUTED,
  rotate = 0,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.fillStyle = color;
  ctx.textAlign = anchor;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** Time axis along the bottom of a canvas plot. */
export function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  x: (t: number) => number,
  dom: [number, number],
  y: number,
  label: string,
) {
  ctx.strokeStyle = GRAY;
  ctx.beginPath();
  ctx.moveTo(x(dom[0]), y + 0.5);
  ctx.lineTo(x(dom[1]), y + 0.5);
  for (const t of timeTicks(...dom)) {
    ctx.moveTo(x(t), y);
    ctx.lineTo(x(t), y + 4);
    put(ctx, String(t), x(t), y + 15);
  }
  ctx.stroke();
  put(ctx, label, (x(dom[0]) + x(dom[1])) / 2, y + 28);
}

export function drawOnset(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, color = '#222') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.restore();
}

export interface Series {
  mean: ArrayLike<number>;
  sem?: ArrayLike<number>;
  color: string;
}

/** A path through the finite points, lifting the pen at gaps. */
function path(pts: [number, number][], ok: (i: number) => boolean): string {
  let d = '';
  let pen = false;
  pts.forEach(([px, py], i) => {
    if (ok(i)) d += `${pen ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    pen = ok(i);
  });
  return d;
}

/**
 * Curves against time from the onset, with their SEM, the baseline and response intervals shaded, the
 * onset line, and optionally a null band and a latency marker. All parts share one x and one y scale.
 */
export function CurvePlot(props: {
  w: number;
  h: number;
  label: string;
  timeS: ArrayLike<number>;
  domain: [number, number];
  series: Series[];
  baseline?: [number, number];
  response?: [number, number];
  band?: { lo: ArrayLike<number>; hi: ArrayLike<number> };
  latencyS?: number;
  yRange?: [number, number];
  yLabel?: string;
  xLabel?: string;
  margin?: Partial<Margin>;
  /** Draw the axes, ticks and labels. Off for the small strips. */
  axes?: boolean;
}): JSX.Element {
  const axes = () => props.axes !== false;
  const m = (): Margin => ({ l: axes() ? 46 : 2, r: 8, t: 6, b: axes() ? (props.xLabel ? 32 : 18) : 2, ...props.margin });
  const [dlo, dhi] = props.domain;
  const x = (t: number) => m().l + ((t - dlo) / (dhi - dlo)) * (props.w - m().l - m().r);
  const yr = (): [number, number] => {
    if (props.yRange) return props.yRange;
    const v: number[] = [0];
    for (const s of props.series)
      Array.from(s.mean).forEach((q, i) => {
        const e = s.sem?.[i];
        if (Number.isFinite(q)) v.push(q, ...(e !== undefined && Number.isFinite(e) ? [q - e, q + e] : []));
      });
    if (props.band)
      for (const a of [props.band.lo, props.band.hi]) for (const q of Array.from(a)) if (Number.isFinite(q)) v.push(q);
    const [lo, hi] = [Math.min(...v), Math.max(...v)];
    const pad = (hi - lo) * 0.08 || 0.1;
    return [lo - pad, hi + pad];
  };
  const y = (v: number) => props.h - m().b - ((v - yr()[0]) / (yr()[1] - yr()[0])) * (props.h - m().t - m().b);
  const pts = (a: ArrayLike<number>) => Array.from(a, (v, i) => [x(props.timeS[i]), y(v)] as [number, number]);
  const band = (a: ArrayLike<number>, b: ArrayLike<number>, ok: (i: number) => boolean) => {
    const up = pts(a);
    const down = pts(b);
    const n = up.length;
    // Walk the finite stretches and close each into its own polygon.
    let d = '';
    for (let i = 0; i < n; ) {
      if (!ok(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && ok(j)) j++;
      const seg = [...up.slice(i, j), ...down.slice(i, j).reverse()];
      d += `M${seg.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join('L')}Z`;
      i = j;
    }
    return d;
  };
  const shade = (iv: [number, number] | undefined, color: string) =>
    iv ? (
      <rect x={x(iv[0])} y={m().t} width={Math.max(0, x(iv[1]) - x(iv[0]))} height={props.h - m().t - m().b} fill={color} />
    ) : null;
  return (
    <svg width={props.w} height={props.h} viewBox={`0 0 ${props.w} ${props.h}`} role="img" aria-label={props.label}>
      {shade(props.baseline, `${PURPLE}1a`)}
      {shade(props.response, `${ORANGE}20`)}
      <Show when={props.band}>
        {(b) => (
          <path
            d={band(b().lo, b().hi, (i) => Number.isFinite(b().lo[i]) && Number.isFinite(b().hi[i]))}
            fill="#8c959f40"
          />
        )}
      </Show>
      <line x1={m().l} x2={props.w - m().r} y1={y(0)} y2={y(0)} stroke="#d0d7de" />
      <line x1={x(0)} x2={x(0)} y1={m().t} y2={props.h - m().b} stroke="#222" stroke-dasharray="4 3" />
      <For each={props.series}>
        {(s) => (
          <>
            <Show when={s.sem}>
              <path
                d={band(
                  Array.from(s.mean, (v, i) => v + s.sem![i]),
                  Array.from(s.mean, (v, i) => v - s.sem![i]),
                  (i) => Number.isFinite(s.mean[i]) && Number.isFinite(s.sem![i]),
                )}
                fill={`${s.color}33`}
              />
            </Show>
            <path
              d={path(pts(s.mean), (i) => Number.isFinite(s.mean[i]))}
              fill="none"
              stroke={s.color}
              stroke-width="1.6"
            />
          </>
        )}
      </For>
      <Show when={props.latencyS !== undefined && Number.isFinite(props.latencyS)}>
        <line x1={x(props.latencyS!)} x2={x(props.latencyS!)} y1={m().t} y2={props.h - m().b} stroke="#222" />
        <polygon
          fill="#222"
          points={`${x(props.latencyS!)},${props.h - m().b} ${x(props.latencyS!) - 4},${props.h - m().b - 8} ${x(props.latencyS!) + 4},${props.h - m().b - 8}`}
        />
        <text
          x={x(props.latencyS!) + (x(props.latencyS!) > props.w * 0.7 ? -5 : 5)}
          y={m().t + 10}
          font-size="11"
          fill={TEXT}
          text-anchor={x(props.latencyS!) > props.w * 0.7 ? 'end' : 'start'}
        >
          latency {props.latencyS!.toFixed(2)} s
        </text>
      </Show>
      <Show when={axes()}>
        <line x1={m().l} x2={props.w - m().r} y1={props.h - m().b} y2={props.h - m().b} stroke={GRAY} />
        <For each={timeTicks(dlo, dhi)}>
          {(t) => (
            <>
              <line x1={x(t)} x2={x(t)} y1={props.h - m().b} y2={props.h - m().b + 4} stroke={GRAY} />
              <text x={x(t)} y={props.h - m().b + 15} font-size="11" fill={MUTED} text-anchor="middle">
                {t}
              </text>
            </>
          )}
        </For>
        <Show when={props.xLabel}>
          <text x={(m().l + props.w - m().r) / 2} y={props.h - 3} font-size="11" fill={MUTED} text-anchor="middle">
            {props.xLabel}
          </text>
        </Show>
        <line x1={m().l} x2={m().l} y1={m().t} y2={props.h - m().b} stroke={GRAY} />
        <For each={niceTicks(...yr())}>
          {(v) => (
            <>
              <line x1={m().l - 4} x2={m().l} y1={y(v)} y2={y(v)} stroke={GRAY} />
              <text x={m().l - 6} y={y(v) + 4} font-size="11" fill={MUTED} text-anchor="end">
                {v}
              </text>
            </>
          )}
        </For>
        <Show when={props.yLabel}>
          <text
            transform={`translate(11 ${(m().t + props.h - m().b) / 2}) rotate(-90)`}
            font-size="11"
            fill={MUTED}
            text-anchor="middle"
          >
            {props.yLabel}
          </text>
        </Show>
      </Show>
    </svg>
  );
}

/** Single-onset raw windows: one row per onset, gray scale from `lim[0]` to `lim[1]`. */
export function Raster(props: {
  w: number;
  h: number;
  data: Float32Array;
  rows: number;
  cols: number;
  domain: [number, number];
  lim: [number, number];
  label: string;
}): JSX.Element {
  const [L, R, T, B] = [46, SIDE, 6, 32];
  const x = (t: number) => L + ((t - props.domain[0]) / (props.domain[1] - props.domain[0])) * (props.w - L - R);
  const gray = (v: number) => {
    const f = Math.max(0, Math.min(1, (v - props.lim[0]) / (props.lim[1] - props.lim[0] || 1)));
    return Number.isFinite(v) ? `rgb(${Math.round(255 - f * 224)},${Math.round(255 - f * 220)},${Math.round(255 - f * 215)})` : '#d0d0d0';
  };
  return (
    <Canvas
      w={props.w}
      h={props.h}
      label={props.label}
      draw={(ctx) => {
        const h = props.h - T - B;
        const rh = h / props.rows;
        const cw = (props.w - L - R) / props.cols;
        for (let e = 0; e < props.rows; e++)
          for (let j = 0; j < props.cols; j++) {
            ctx.fillStyle = gray(props.data[e * props.cols + j]);
            ctx.fillRect(L + j * cw, T + e * rh, cw + 0.4, rh + 0.4);
          }
        drawOnset(ctx, x(0), T, T + h, '#0969da');
        drawTimeAxis(ctx, x, props.domain, T + h, 'Time from behavior onset (s)');
        put(ctx, '1', L - 5, T + 9, 'right');
        if (props.rows > 1) put(ctx, String(props.rows), L - 5, T + h, 'right');
        put(ctx, 'Onset', 11, T + h / 2, 'center', MUTED, -Math.PI / 2);
        const cx = props.w - R + 14;
        for (let i = 0; i < h; i++) {
          ctx.fillStyle = gray(props.lim[1] - ((props.lim[1] - props.lim[0]) * i) / h);
          ctx.fillRect(cx, T + i, 10, 1.2);
        }
        put(ctx, num(props.lim[1], 2), cx + 13, T + 8, 'left');
        put(ctx, num(props.lim[0], 2), cx + 13, T + h, 'left');
        put(ctx, 'raw (a.u.)', cx + 46, T + h / 2, 'center', MUTED, Math.PI / 2);
      }}
    />
  );
}

/** Distribution of the shifted values with the observed value as a line; x is the statistic in a.u. */
export function Histogram(props: {
  w: number;
  h: number;
  draws: ArrayLike<number>;
  observed: number;
  color: string;
  xLabel: string;
  label: string;
}): JSX.Element {
  const [L, R, T, B] = [10, 12, 18, 34];
  const finite = () => Array.from(props.draws).filter(Number.isFinite);
  const dom = (): [number, number] => {
    const f = finite();
    const lo = Math.min(...f, props.observed, 0);
    const hi = Math.max(...f, props.observed, 0);
    const pad = (hi - lo) * 0.06 || 0.05;
    return [lo - pad, hi + pad];
  };
  const x = (v: number) => L + ((v - dom()[0]) / (dom()[1] - dom()[0])) * (props.w - L - R);
  const NB = 40;
  const bins = () => {
    const [lo, hi] = dom();
    const counts = new Array<number>(NB).fill(0);
    for (const v of finite()) counts[Math.min(NB - 1, Math.floor(((v - lo) / (hi - lo)) * NB))]++;
    return { counts, w: (hi - lo) / NB, max: Math.max(1, ...counts) };
  };
  const base = () => props.h - B;
  const flip = () => x(props.observed) > props.w * 0.65;
  return (
    <svg width={props.w} height={props.h} viewBox={`0 0 ${props.w} ${props.h}`} role="img" aria-label={props.label}>
      <For each={bins().counts}>
        {(c, i) => (
          <rect
            x={x(dom()[0] + i() * bins().w) + 0.5}
            y={base() - (c / bins().max) * (base() - T)}
            width={Math.max(1, x(dom()[0] + bins().w) - x(dom()[0]) - 1)}
            height={(c / bins().max) * (base() - T)}
            fill="#afb8c1"
          />
        )}
      </For>
      <line x1={x(0)} x2={x(0)} y1={T} y2={base()} stroke="#222" stroke-dasharray="4 3" />
      <line x1={x(props.observed)} x2={x(props.observed)} y1={T - 4} y2={base()} stroke={props.color} stroke-width="3" />
      <text
        x={x(props.observed) + (flip() ? -6 : 6)}
        y={T - 6}
        font-size="12"
        font-weight="600"
        fill={TEXT}
        text-anchor={flip() ? 'end' : 'start'}
      >
        Observed {num(props.observed)}
      </text>
      <line x1={L} x2={props.w - R} y1={base()} y2={base()} stroke={GRAY} />
      <For each={niceTicks(...dom(), 5)}>
        {(v) => (
          <text x={x(v)} y={base() + 14} font-size="11" fill={MUTED} text-anchor="middle">
            {v}
          </text>
        )}
      </For>
      <text x={(L + props.w - R) / 2} y={props.h - 3} font-size="11" fill={MUTED} text-anchor="middle">
        {props.xLabel}
      </text>
    </svg>
  );
}
