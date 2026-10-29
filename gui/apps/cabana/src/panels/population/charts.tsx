// SVG (and one canvas) figures of the Population results. Each fills its box, truncates long
// names with the full name on hover, and keeps text at 11 px or more. Nothing is computed here:
// the figures draw arrays the framework produced.

import { createEffect, createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import { createSize } from '../QcParts.tsx';
import {
  colorCss,
  colorRgb,
  colorTicks,
  fmt,
  inkOn,
  niceTicks,
  truncate,
  type Limits,
  type ScaleKind,
} from './logic.ts';

const CHAR = 6.6; // width of one 12 px character, for fitting labels

/** A box that measures itself and gives its size to the figure. */
export function Chart(props: {
  label: string;
  svgRef?: (el: SVGSVGElement) => void;
  /** The figure may be taller than the box; the box then scrolls (named views only). */
  height?: (boxH: number) => number;
  /** Called with the box size whenever it changes. */
  onSize?: (box: { w: number; h: number }) => void;
  children: (w: number, h: number) => JSX.Element;
}): JSX.Element {
  const [size, measure] = createSize();
  const h = () => (props.height ? Math.max(size().h, props.height(size().h)) : size().h);
  createEffect(() => props.onSize?.(size()));
  return (
    <div class="cb-pn-chart" ref={measure}>
      <Show when={size().w > 0 && size().h > 0}>
        <svg
          ref={(el) => props.svgRef?.(el)}
          width={size().w}
          height={h()}
          role="img"
          aria-label={props.label}
        >
          {props.children(size().w, h())}
        </svg>
      </Show>
    </div>
  );
}

const Label = (p: {
  x: number;
  y: number;
  text: string;
  title?: string;
  anchor?: string;
  rotate?: number;
}) => (
  <text
    x={p.x}
    y={p.y}
    text-anchor={(p.anchor ?? 'start') as 'start' | 'middle' | 'end'}
    dominant-baseline="middle"
    transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}
  >
    <Show when={p.title && p.title !== p.text}>
      <title>{p.title}</title>
    </Show>
    {p.text}
  </text>
);

function AxisTitle(p: { x: number; y: number; text: string; rotate?: boolean }) {
  return (
    <text
      class="cb-pn-axis"
      x={p.x}
      y={p.y}
      text-anchor="middle"
      transform={p.rotate ? `rotate(-90 ${p.x} ${p.y})` : undefined}
    >
      {p.text}
    </text>
  );
}

// ---------- heatmap ----------

export interface HeatProps {
  labels: string[];
  /** Row-major values, `order.length` rows by `order.length` columns (indexes into `labels`). */
  values: ArrayLike<number | null>;
  order: number[];
  kind: ScaleKind;
  limits: Limits;
  showValues: boolean;
  /** True where the cell carries a significance mark. */
  mark?: (row: number, col: number) => boolean;
  scaleTitle: string;
  tip: (row: number, col: number) => string;
  svgRef?: (el: SVGSVGElement) => void;
  canvasRef?: (el: HTMLCanvasElement) => void;
  label: string;
}

/** States by states matrix with a labeled color bar. */
/** More states than this are drawn on a canvas: one SVG element per matrix cell is too slow. */
const CANVAS_STATES = 50;

/** The matrix cells of a large heatmap on a canvas, with one tooltip that follows the pointer. */
function HeatCells(p: {
  heat: HeatProps;
  x0: number;
  top: number;
  cell: number;
  canvasRef?: (el: HTMLCanvasElement) => void;
}): JSX.Element {
  const n = () => p.heat.order.length;
  const side = () => p.cell * n();
  const [tip, setTip] = createSignal('');
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const h = p.heat;
    const scale = Math.max(1, devicePixelRatio);
    canvas.width = Math.max(1, Math.round(side() * scale));
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.min(12, Math.max(8, p.cell))}px sans-serif`;
    h.order.forEach((i, r) => {
      h.order.forEach((j, c) => {
        const rgb = colorRgb(
          h.values[i * h.labels.length + j] ?? NaN,
          h.kind,
          h.limits.lo,
          h.limits.hi,
        );
        ctx.fillStyle = `rgb(${rgb.join(',')})`;
        ctx.fillRect(c * p.cell, r * p.cell, p.cell, p.cell);
        if (h.mark?.(i, j)) {
          ctx.fillStyle = inkOn(rgb);
          ctx.fillText('*', (c + 0.5) * p.cell, (r + 0.5) * p.cell + 1);
        }
      });
    });
  });
  const locate = (e: MouseEvent) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const c = Math.min(
      n() - 1,
      Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n())),
    );
    const r = Math.min(
      n() - 1,
      Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * n())),
    );
    setTip(p.heat.tip(p.heat.order[r], p.heat.order[c]));
  };
  return (
    <>
      <foreignObject x={p.x0} y={p.top} width={side()} height={side()}>
        <canvas
          ref={(el) => {
            canvas = el;
            p.canvasRef?.(el);
          }}
          style={{ width: `${side()}px`, height: `${side()}px`, display: 'block' }}
        />
      </foreignObject>
      <rect
        x={p.x0}
        y={p.top}
        width={side()}
        height={side()}
        fill="transparent"
        onMouseMove={locate}
      >
        <title>{tip()}</title>
      </rect>
    </>
  );
}

export function Heatmap(p: HeatProps): JSX.Element {
  const gradient = createUniqueId();
  return (
    <Chart label={p.label} svgRef={p.svgRef}>
      {(w, h) => {
        const n = p.order.length;
        const longest = Math.max(1, ...p.labels.map((l) => l.length));
        const left = Math.min(170, Math.max(36, longest * CHAR + 6));
        const bottom = Math.min(120, Math.max(24, longest * CHAR + 6));
        const right = 104;
        const top = 8;
        const cell = Math.max(1, Math.min((w - left - right - 8) / n, (h - top - bottom - 8) / n));
        const step = Math.max(1, Math.ceil(11 / cell));
        const x0 = left + 6;
        const side = cell * n;
        const valuesFit = cell >= 30;
        const barH = Math.min(side, 220);
        const barX = x0 + side + 22;
        return (
          <>
            <defs>
              <linearGradient id={gradient} x1="0" y1="1" x2="0" y2="0">
                <For each={[0, 0.25, 0.5, 0.75, 1]}>
                  {(t) => (
                    <stop
                      offset={`${t * 100}%`}
                      stop-color={colorCss(
                        p.limits.lo + (p.limits.hi - p.limits.lo) * t,
                        p.kind,
                        p.limits.lo,
                        p.limits.hi,
                      )}
                    />
                  )}
                </For>
              </linearGradient>
            </defs>
            <For each={p.order}>
              {(i, r) => (
                <>
                  <Show when={r() % step === 0}>
                    <Label
                      x={left}
                      y={top + (r() + 0.5) * cell}
                      anchor="end"
                      text={truncate(p.labels[i], Math.floor((left - 6) / CHAR))}
                      title={p.labels[i]}
                    />
                    <Label
                      x={x0 + (r() + 0.5) * cell}
                      y={top + side + 6}
                      anchor="end"
                      rotate={-90}
                      text={truncate(p.labels[i], Math.floor((bottom - 4) / CHAR))}
                      title={p.labels[i]}
                    />
                  </Show>
                  <Show when={n <= CANVAS_STATES}>
                    <For each={p.order}>
                      {(j, c) => {
                        const v = () => p.values[i * p.labels.length + j];
                        const rgb = () => colorRgb(v() ?? NaN, p.kind, p.limits.lo, p.limits.hi);
                        return (
                          <g>
                            <rect
                              x={x0 + c() * cell}
                              y={top + r() * cell}
                              width={cell}
                              height={cell}
                              fill={`rgb(${rgb().join(',')})`}
                              stroke="#fff"
                              stroke-width={cell > 8 ? 0.5 : 0}
                            >
                              <title>{p.tip(i, j)}</title>
                            </rect>
                            <Show when={valuesFit || p.mark?.(i, j)}>
                              <text
                                x={x0 + (c() + 0.5) * cell}
                                y={top + (r() + 0.5) * cell}
                                text-anchor="middle"
                                dominant-baseline="middle"
                                fill={inkOn(rgb())}
                                pointer-events="none"
                              >
                                {(p.showValues && valuesFit ? fmt(v(), 2) : '') +
                                  (p.mark?.(i, j) ? '*' : '')}
                              </text>
                            </Show>
                          </g>
                        );
                      }}
                    </For>
                  </Show>
                </>
              )}
            </For>
            <Show when={n > CANVAS_STATES}>
              <HeatCells heat={p} x0={x0} top={top} cell={cell} canvasRef={p.canvasRef} />
            </Show>
            <rect
              x={x0}
              y={top}
              width={side}
              height={side}
              fill="none"
              stroke="#94a3b8"
              pointer-events="none"
            />
            <rect
              x={barX}
              y={top}
              width={14}
              height={barH}
              fill={`url(#${gradient})`}
              stroke="#94a3b8"
            />
            <For each={colorTicks(p.limits)}>
              {(t) => (
                <Label
                  x={barX + 18}
                  y={top + barH - ((t - p.limits.lo) / (p.limits.hi - p.limits.lo)) * barH}
                  text={fmt(t, 2)}
                />
              )}
            </For>
            <AxisTitle x={barX + 52} y={top + barH / 2} text={p.scaleTitle} rotate />
            <Show when={p.showValues && !valuesFit}>
              <text class="cb-pn-note" x={x0} y={h - 4}>
                Values are hidden: cells are under 30 px (expand the plot to show them).
              </text>
            </Show>
          </>
        );
      }}
    </Chart>
  );
}

// ---------- cells by cells matrix (canvas) ----------

/** A large square matrix drawn on a canvas under an SVG with the axes and the color bar. */
export function CanvasMatrix(p: {
  values: ArrayLike<number | null>;
  n: number;
  kind: ScaleKind;
  limits: Limits;
  scaleTitle: string;
  xTitle: string;
  yTitle: string;
  highlight?: number;
  svgRef?: (el: SVGSVGElement) => void;
  canvasRef?: (el: HTMLCanvasElement) => void;
  label: string;
}): JSX.Element {
  const [size, measure] = createSize();
  let canvas!: HTMLCanvasElement;
  const gradient = createUniqueId();
  const geom = () => {
    const { w, h } = size();
    const left = 56;
    const bottom = 40;
    const right = 100;
    const side = Math.max(40, Math.min(w - left - right, h - bottom - 10));
    return { left, top: 6, side };
  };
  createEffect(() => {
    const { side } = geom();
    if (!canvas || size().w <= 0) return;
    const px = Math.max(1, Math.round(side * devicePixelRatio));
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    const { n } = p;
    for (let y = 0; y < px; y++) {
      const i = Math.min(n - 1, Math.floor((y / px) * n));
      for (let x = 0; x < px; x++) {
        const j = Math.min(n - 1, Math.floor((x / px) * n));
        const rgb = colorRgb(p.values[i * n + j] ?? NaN, p.kind, p.limits.lo, p.limits.hi);
        const o = (y * px + x) * 4;
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  return (
    <div class="cb-pn-chart cb-pn-canvaswrap" ref={measure}>
      <Show when={size().w > 0 && size().h > 0}>
        <canvas
          ref={(el) => {
            canvas = el;
            p.canvasRef?.(el);
          }}
          style={{
            position: 'absolute',
            left: `${geom().left}px`,
            top: `${geom().top}px`,
            width: `${geom().side}px`,
            height: `${geom().side}px`,
          }}
        />
        <svg
          ref={(el) => p.svgRef?.(el)}
          width={size().w}
          height={size().h}
          role="img"
          aria-label={p.label}
        >
          {(() => {
            const g = geom();
            const barX = g.left + g.side + 20;
            const barH = Math.min(g.side, 220);
            return (
              <>
                <defs>
                  <linearGradient id={gradient} x1="0" y1="1" x2="0" y2="0">
                    <For each={[0, 0.25, 0.5, 0.75, 1]}>
                      {(t) => (
                        <stop
                          offset={`${t * 100}%`}
                          stop-color={colorCss(
                            p.limits.lo + (p.limits.hi - p.limits.lo) * t,
                            p.kind,
                            p.limits.lo,
                            p.limits.hi,
                          )}
                        />
                      )}
                    </For>
                  </linearGradient>
                </defs>
                <rect
                  x={g.left}
                  y={g.top}
                  width={g.side}
                  height={g.side}
                  fill="none"
                  stroke="#94a3b8"
                />
                <Show when={p.highlight !== undefined && p.highlight >= 0}>
                  <rect
                    x={g.left}
                    y={g.top + (p.highlight! / p.n) * g.side}
                    width={g.side}
                    height={Math.max(1.5, g.side / p.n)}
                    fill="none"
                    stroke="#0f172a"
                  />
                </Show>
                <For each={[0, 0.25, 0.5, 0.75, 1]}>
                  {(t) => (
                    <>
                      <Label
                        x={g.left - 4}
                        y={g.top + t * g.side}
                        anchor="end"
                        text={String(Math.max(1, Math.round(t * p.n)))}
                      />
                      <Label
                        x={g.left + t * g.side}
                        y={g.top + g.side + 10}
                        anchor="middle"
                        text={String(Math.max(1, Math.round(t * p.n)))}
                      />
                    </>
                  )}
                </For>
                <AxisTitle x={g.left + g.side / 2} y={g.top + g.side + 30} text={p.xTitle} />
                <AxisTitle x={12} y={g.top + g.side / 2} text={p.yTitle} rotate />
                <rect
                  x={barX}
                  y={g.top}
                  width={14}
                  height={barH}
                  fill={`url(#${gradient})`}
                  stroke="#94a3b8"
                />
                <For each={colorTicks(p.limits)}>
                  {(t) => (
                    <Label
                      x={barX + 18}
                      y={g.top + barH - ((t - p.limits.lo) / (p.limits.hi - p.limits.lo)) * barH}
                      text={fmt(t, 2)}
                    />
                  )}
                </For>
                <AxisTitle x={barX + 52} y={g.top + barH / 2} text={p.scaleTitle} rotate />
              </>
            );
          })()}
        </svg>
      </Show>
    </div>
  );
}

// ---------- dot plot with null range ----------

export interface DotRow {
  name: string;
  value: number | null;
  nullLo: number | null;
  nullHi: number | null;
  significant: boolean;
}

const DOT_TOP = 8;
const DOT_BOTTOM = 44;
const DOT_PITCH = 16; // px per state row

/** One dot per state with the null range as a gray bar; the selected state is outlined. */
export function DotPlot(p: {
  rows: DotRow[];
  xTitle: string;
  selected?: number;
  onSelect?: (row: number) => void;
  svgRef?: (el: SVGSVGElement) => void;
  label: string;
}): JSX.Element {
  // States are paged to the rows that fit the box, so the plot never scrolls inside it.
  const [boxH, setBoxH] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const perPage = () => Math.max(3, Math.floor((boxH() - DOT_TOP - DOT_BOTTOM) / DOT_PITCH));
  const pages = () => Math.max(1, Math.ceil(p.rows.length / perPage()));
  const at = () => Math.min(page(), pages() - 1);
  const first = () => at() * perPage();
  const shown = () => p.rows.slice(first(), first() + perPage());
  // Turn to the page of the selected state.
  createEffect(() => {
    if (p.selected != null && p.selected >= 0) setPage(Math.floor(p.selected / perPage()));
  });
  return (
    <div class="cb-pn-dotwrap">
      <Chart label={p.label} svgRef={p.svgRef} onSize={(b) => setBoxH(b.h)}>
        {(w, h) => {
          const longest = Math.max(1, ...p.rows.map((r) => r.name.length));
          const left = Math.min(180, Math.max(40, longest * CHAR + 8));
          const right = 26; // room for the significance mark beside the last dot
          const top = DOT_TOP;
          const bottom = DOT_BOTTOM;
          const nums = p.rows
            .flatMap((r) => [r.value, r.nullLo, r.nullHi])
            .filter((v): v is number => v != null && Number.isFinite(v));
          const lo = Math.min(0, ...nums);
          const hi = Math.max(0.0001, ...nums);
          const ticks = niceTicks(lo, hi, 6);
          const x = (v: number) =>
            left + ((v - lo) / (ticks.at(-1)! - lo || 1)) * (w - left - right);
          const pitch = Math.min(26, (h - top - bottom) / Math.max(1, shown().length));
          return (
            <>
              <For each={ticks}>
                {(t) => (
                  <>
                    <line x1={x(t)} x2={x(t)} y1={top} y2={h - bottom} stroke="#e2e8f0" />
                    <Label x={x(t)} y={h - bottom + 12} anchor="middle" text={fmt(t, 2)} />
                  </>
                )}
              </For>
              <For each={shown()}>
                {(r, k) => {
                  const i = () => first() + k();
                  const y = top + (k() + 0.5) * pitch;
                  return (
                    <g
                      class="cb-pn-row"
                      style={{ cursor: p.onSelect ? 'pointer' : 'default' }}
                      onClick={() => p.onSelect?.(i())}
                    >
                      <rect
                        x={0}
                        y={y - pitch / 2}
                        width={w}
                        height={pitch}
                        fill={p.selected === i() ? '#eff6ff' : 'transparent'}
                      />
                      <Label
                        x={left - 6}
                        y={y}
                        anchor="end"
                        text={truncate(r.name, Math.floor((left - 10) / CHAR))}
                        title={r.name}
                      />
                      <Show when={r.nullLo != null && r.nullHi != null}>
                        <line
                          x1={x(r.nullLo!)}
                          x2={x(r.nullHi!)}
                          y1={y}
                          y2={y}
                          stroke="#94a3b8"
                          stroke-width={5}
                          stroke-linecap="round"
                        >
                          <title>{`Null range ${fmt(r.nullLo)} to ${fmt(r.nullHi)}`}</title>
                        </line>
                      </Show>
                      <Show when={r.value != null}>
                        <circle
                          cx={x(r.value!)}
                          cy={y}
                          r={Math.min(5, pitch / 2.5)}
                          fill={r.significant ? '#1d4ed8' : '#fff'}
                          stroke="#1d4ed8"
                          stroke-width={1.5}
                        >
                          <title>{`${r.name}: ${fmt(r.value)}${r.significant ? ' (significant)' : ''}`}</title>
                        </circle>
                        <Show when={r.significant}>
                          <text x={x(r.value!) + 9} y={y} dominant-baseline="middle">
                            *
                          </text>
                        </Show>
                      </Show>
                    </g>
                  );
                }}
              </For>
              <line x1={left} x2={left} y1={top} y2={h - bottom} stroke="#94a3b8" />
              <AxisTitle x={left + (w - left - right) / 2} y={h - 8} text={p.xTitle} />
            </>
          );
        }}
      </Chart>
      <Show when={pages() > 1}>
        <div class="cb-pn-pager">
          <button
            class="btn-secondary btn-small"
            disabled={at() === 0}
            onClick={() => setPage(at() - 1)}
          >
            Previous
          </button>
          <span class="cb-muted">
            States {first() + 1}–{Math.min(p.rows.length, first() + perPage())} of {p.rows.length}
          </span>
          <button
            class="btn-secondary btn-small"
            disabled={at() >= pages() - 1}
            onClick={() => setPage(at() + 1)}
          >
            Next
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------- scatter ----------

export interface ScatterPoint {
  x: number;
  y: number;
  name?: string;
}

export function Scatter(p: {
  points: ScatterPoint[];
  xTitle: string;
  yTitle: string;
  diagonal?: boolean;
  labels?: boolean;
  svgRef?: (el: SVGSVGElement) => void;
  label: string;
}): JSX.Element {
  return (
    <Chart label={p.label} svgRef={p.svgRef}>
      {(w, h) => {
        const left = 56;
        const bottom = 42;
        const top = 10;
        const right = p.labels ? 90 : 14;
        const xs = p.points.map((q) => q.x).filter(Number.isFinite);
        const ys = p.points.map((q) => q.y).filter(Number.isFinite);
        const lo = (a: number[]) => Math.min(...a);
        const hi = (a: number[]) => Math.max(...a);
        const all = p.diagonal ? [...xs, ...ys] : undefined;
        const xr = [all ? lo(all) : lo(xs), all ? hi(all) : hi(xs)];
        const yr = [all ? lo(all) : lo(ys), all ? hi(all) : hi(ys)];
        const xt = niceTicks(xr[0], xr[1], 5);
        const yt = niceTicks(yr[0], yr[1], 5);
        const x0 = Math.min(xr[0], xt[0]);
        const x1 = Math.max(xr[1], xt.at(-1)!);
        const y0 = Math.min(yr[0], yt[0]);
        const y1 = Math.max(yr[1], yt.at(-1)!);
        const sx = (v: number) => left + ((v - x0) / (x1 - x0 || 1)) * (w - left - right);
        const sy = (v: number) => h - bottom - ((v - y0) / (y1 - y0 || 1)) * (h - top - bottom);
        return (
          <>
            <For each={xt}>
              {(t) => <Label x={sx(t)} y={h - bottom + 12} anchor="middle" text={fmt(t, 2)} />}
            </For>
            <For each={yt}>
              {(t) => (
                <>
                  <line x1={left} x2={w - right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" />
                  <Label x={left - 4} y={sy(t)} anchor="end" text={fmt(t, 2)} />
                </>
              )}
            </For>
            <rect
              x={left}
              y={top}
              width={w - left - right}
              height={h - top - bottom}
              fill="none"
              stroke="#94a3b8"
            />
            <Show when={p.diagonal}>
              <line
                x1={sx(Math.max(x0, y0))}
                y1={sy(Math.max(x0, y0))}
                x2={sx(Math.min(x1, y1))}
                y2={sy(Math.min(x1, y1))}
                stroke="#94a3b8"
                stroke-dasharray="4 3"
              />
            </Show>
            <For each={p.points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y))}>
              {(q) => (
                <>
                  <circle
                    cx={sx(q.x)}
                    cy={sy(q.y)}
                    r={p.labels ? 5 : 3}
                    fill="#2563eb"
                    fill-opacity={p.labels ? 0.9 : 0.55}
                  >
                    <title>{`${q.name ? `${q.name}: ` : ''}${fmt(q.x)}, ${fmt(q.y)}`}</title>
                  </circle>
                  <Show when={p.labels && q.name}>
                    <Label
                      x={sx(q.x) + 8}
                      y={sy(q.y)}
                      text={truncate(q.name!, 12)}
                      title={q.name!}
                    />
                  </Show>
                </>
              )}
            </For>
            <AxisTitle x={left + (w - left - right) / 2} y={h - 8} text={p.xTitle} />
            <AxisTitle x={13} y={top + (h - top - bottom) / 2} text={p.yTitle} rotate />
          </>
        );
      }}
    </Chart>
  );
}

// ---------- bars (with optional line and whiskers) ----------

export interface BarDatum {
  name: string;
  value: number | null;
  nullLo?: number | null;
  nullHi?: number | null;
}

/** Vertical bars by name or number. A second series draws as a line on the right axis. */
export function Bars(p: {
  bars: BarDatum[];
  xTitle: string;
  yTitle: string;
  /** Cumulative line on a 0 to 1 right axis. */
  line?: { values: number[]; title: string };
  /** Log10 y axis for positive values. */
  log?: boolean;
  svgRef?: (el: SVGSVGElement) => void;
  label: string;
  thinLabels?: boolean;
}): JSX.Element {
  return (
    <Chart label={p.label} svgRef={p.svgRef}>
      {(w, h) => {
        const longest = Math.max(1, ...p.bars.map((b) => b.name.length));
        const rotated = longest > 4 && p.bars.length > 6;
        const left = 58;
        const right = p.line ? 56 : 14;
        const top = 10;
        const bottom = (rotated ? Math.min(110, longest * CHAR + 8) : 22) + 24;
        const vals = p.bars
          .flatMap((b) => [b.value, b.nullLo, b.nullHi])
          .filter((v): v is number => v != null && Number.isFinite(v) && (!p.log || v > 0));
        const t = (v: number) => (p.log ? Math.log10(Math.max(v, 1e-12)) : v);
        const lo = p.log ? Math.floor(t(Math.min(...vals))) : 0;
        const hiRaw = t(Math.max(...vals, 1e-9));
        const ticks = p.log
          ? Array.from({ length: Math.max(2, Math.ceil(hiRaw) - lo + 1) }, (_, i) => lo + i)
          : niceTicks(0, hiRaw, 5);
        const hi = ticks.at(-1)!;
        const sy = (v: number) =>
          h -
          bottom -
          ((t(v) - (p.log ? lo : 0)) / (hi - (p.log ? lo : 0) || 1)) * (h - top - bottom);
        const band = (w - left - right) / Math.max(1, p.bars.length);
        const sx = (i: number) => left + (i + 0.5) * band;
        const step = Math.max(1, Math.ceil(12 / band));
        return (
          <>
            <For each={ticks}>
              {(v) => {
                const real = p.log ? 10 ** v : v;
                return (
                  <>
                    <line x1={left} x2={w - right} y1={sy(real)} y2={sy(real)} stroke="#e2e8f0" />
                    <Label
                      x={left - 4}
                      y={sy(real)}
                      anchor="end"
                      text={p.log ? fmt(real, 3) : fmt(v, 2)}
                    />
                  </>
                );
              }}
            </For>
            <For each={p.bars}>
              {(b, i) => (
                <>
                  <Show
                    when={b.value != null && Number.isFinite(b.value) && (!p.log || b.value! > 0)}
                  >
                    <rect
                      x={sx(i()) - band * 0.36}
                      width={band * 0.72}
                      y={sy(b.value!)}
                      height={Math.max(0, h - bottom - sy(b.value!))}
                      fill="#60a5fa"
                    >
                      <title>{`${b.name}: ${fmt(b.value)}`}</title>
                    </rect>
                  </Show>
                  <Show when={b.nullLo != null && b.nullHi != null}>
                    <line
                      x1={sx(i())}
                      x2={sx(i())}
                      y1={sy(b.nullLo!)}
                      y2={sy(b.nullHi!)}
                      stroke="#0f172a"
                      stroke-width={2}
                    >
                      <title>{`Null range ${fmt(b.nullLo)} to ${fmt(b.nullHi)}`}</title>
                    </line>
                  </Show>
                  <Show when={i() % step === 0}>
                    <Label
                      x={sx(i())}
                      y={h - bottom + (rotated ? 6 : 12)}
                      anchor={rotated ? 'end' : 'middle'}
                      rotate={rotated ? -90 : 0}
                      text={truncate(b.name, rotated ? Math.floor((bottom - 30) / CHAR) : 8)}
                      title={b.name}
                    />
                  </Show>
                </>
              )}
            </For>
            <Show when={p.line}>
              {(l) => (
                <>
                  <polyline
                    fill="none"
                    stroke="#b45309"
                    stroke-width={2}
                    points={l()
                      .values.map((v, i) => `${sx(i)},${h - bottom - v * (h - top - bottom)}`)
                      .join(' ')}
                  />
                  <For each={[0, 0.5, 1]}>
                    {(v) => (
                      <Label
                        x={w - right + 4}
                        y={h - bottom - v * (h - top - bottom)}
                        text={fmt(v, 1)}
                      />
                    )}
                  </For>
                  <AxisTitle x={w - 12} y={top + (h - top - bottom) / 2} text={l().title} rotate />
                </>
              )}
            </Show>
            <line x1={left} x2={left} y1={top} y2={h - bottom} stroke="#94a3b8" />
            <line x1={left} x2={w - right} y1={h - bottom} y2={h - bottom} stroke="#94a3b8" />
            <AxisTitle x={left + (w - left - right) / 2} y={h - 8} text={p.xTitle} />
            <AxisTitle x={13} y={top + (h - top - bottom) / 2} text={p.yTitle} rotate />
          </>
        );
      }}
    </Chart>
  );
}

/** Line through (index, value) points, optionally with a log10 y axis (spectrum). */
export function Spectrum(p: {
  values: number[];
  xTitle: string;
  yTitle: string;
  log: boolean;
  svgRef?: (el: SVGSVGElement) => void;
  label: string;
}): JSX.Element {
  return (
    <Chart label={p.label} svgRef={p.svgRef}>
      {(w, h) => {
        const left = 62;
        const right = 16;
        const top = 10;
        const bottom = 42;
        const pos = p.values.filter((v) => Number.isFinite(v) && (!p.log || v > 0));
        const t = (v: number) => (p.log ? Math.log10(v) : v);
        const lo = p.log ? Math.floor(Math.min(...pos.map(t))) : 0;
        const ticks = p.log
          ? Array.from(
              { length: Math.max(2, Math.ceil(t(Math.max(...pos))) - lo + 1) },
              (_, i) => lo + i,
            )
          : niceTicks(0, Math.max(...pos, 1e-9), 5);
        const hi = ticks.at(-1)!;
        const sy = (v: number) => h - bottom - ((t(v) - lo) / (hi - lo || 1)) * (h - top - bottom);
        const sx = (i: number) =>
          left + (i / Math.max(1, p.values.length - 1)) * (w - left - right);
        const pts = p.values
          .map((v, i) => [i, v] as const)
          .filter(([, v]) => Number.isFinite(v) && (!p.log || v > 0));
        const xt = niceTicks(1, p.values.length, 6);
        return (
          <>
            <For each={ticks}>
              {(v) => {
                const real = p.log ? 10 ** v : v;
                return (
                  <>
                    <line x1={left} x2={w - right} y1={sy(real)} y2={sy(real)} stroke="#e2e8f0" />
                    <Label x={left - 4} y={sy(real)} anchor="end" text={fmt(real, 3)} />
                  </>
                );
              }}
            </For>
            <For each={xt}>
              {(v) => <Label x={sx(v - 1)} y={h - bottom + 12} anchor="middle" text={String(v)} />}
            </For>
            <polyline
              fill="none"
              stroke="#2563eb"
              stroke-width={2}
              points={pts.map(([i, v]) => `${sx(i)},${sy(v)}`).join(' ')}
            />
            <For each={pts}>
              {([i, v]) => (
                <circle cx={sx(i)} cy={sy(v)} r={2.5} fill="#2563eb">
                  <title>{`Component ${i + 1}: ${fmt(v, 4)}`}</title>
                </circle>
              )}
            </For>
            <line x1={left} x2={left} y1={top} y2={h - bottom} stroke="#94a3b8" />
            <line x1={left} x2={w - right} y1={h - bottom} y2={h - bottom} stroke="#94a3b8" />
            <AxisTitle x={left + (w - left - right) / 2} y={h - 8} text={p.xTitle} />
            <AxisTitle x={13} y={top + (h - top - bottom) / 2} text={p.yTitle} rotate />
          </>
        );
      }}
    </Chart>
  );
}

/** Histogram of values already binned by `histogram()`. */
export function Histogram(p: {
  edges: number[];
  counts: number[];
  xTitle: string;
  mean?: number | null;
  svgRef?: (el: SVGSVGElement) => void;
  label: string;
}): JSX.Element {
  return (
    <Chart label={p.label} svgRef={p.svgRef}>
      {(w, h) => {
        const left = 58;
        const right = 14;
        const top = 10;
        const bottom = 42;
        const max = Math.max(1, ...p.counts);
        const yt = niceTicks(0, max, 5);
        const x0 = p.edges[0] ?? 0;
        const x1 = p.edges.at(-1) ?? 1;
        const sx = (v: number) => left + ((v - x0) / (x1 - x0 || 1)) * (w - left - right);
        const sy = (v: number) => h - bottom - (v / (yt.at(-1)! || 1)) * (h - top - bottom);
        return (
          <>
            <For each={yt}>
              {(t) => (
                <>
                  <line x1={left} x2={w - right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" />
                  <Label x={left - 4} y={sy(t)} anchor="end" text={fmt(t, 0)} />
                </>
              )}
            </For>
            <For each={p.counts}>
              {(c, i) => (
                <rect
                  x={sx(p.edges[i()]) + 0.5}
                  y={sy(c)}
                  width={Math.max(0, sx(p.edges[i() + 1]) - sx(p.edges[i()]) - 1)}
                  height={Math.max(0, h - bottom - sy(c))}
                  fill="#60a5fa"
                >
                  <title>{`${fmt(p.edges[i()])} to ${fmt(p.edges[i() + 1])}: ${c} pairs`}</title>
                </rect>
              )}
            </For>
            <For each={niceTicks(x0, x1, 6)}>
              {(t) => <Label x={sx(t)} y={h - bottom + 12} anchor="middle" text={fmt(t, 2)} />}
            </For>
            <Show when={p.mean != null && Number.isFinite(p.mean!)}>
              <line
                x1={sx(p.mean!)}
                x2={sx(p.mean!)}
                y1={top}
                y2={h - bottom}
                stroke="#b45309"
                stroke-width={2}
                stroke-dasharray="5 3"
              />
              <text x={sx(p.mean!) + 4} y={top + 8} fill="#b45309">{`mean ${fmt(p.mean, 3)}`}</text>
            </Show>
            <line x1={left} x2={left} y1={top} y2={h - bottom} stroke="#94a3b8" />
            <line x1={left} x2={w - right} y1={h - bottom} y2={h - bottom} stroke="#94a3b8" />
            <AxisTitle x={left + (w - left - right) / 2} y={h - 8} text={p.xTitle} />
            <AxisTitle x={13} y={top + (h - top - bottom) / 2} text="Cell pairs (count)" rotate />
          </>
        );
      }}
    </Chart>
  );
}
