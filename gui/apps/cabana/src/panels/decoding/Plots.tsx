// Decoding figures as SVG, drawn from the display models in model.ts. Display settings (color
// limits, axis swap, order, normalization) change only what is drawn, never a result.

import { For, Show, type JSX } from 'solid-js';
import { finite } from '../../lib/results-load.ts';
import { Fit } from '../AurocResults.tsx';
import { tickStep } from './FoldStrip.tsx';
import {
  fmt,
  fmtP,
  type BehaviorRow,
  type BinCell,
  type Histogram,
  type OneVsRest,
} from './model.ts';

type Ref = (el: SVGSVGElement) => void;

/** Light-to-dark blue for a value between 0 and 1. */
export function blue(t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${mix(239, 30)},${mix(246, 58)},${mix(255, 138)})`;
}
const TEXT = '#334155';

const Hatch = (props: { id: string }): JSX.Element => (
  <pattern id={props.id} width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="#f1f5f9" />
    <path d="M0 6 L6 0" stroke="#94a3b8" stroke-width="1" />
  </pattern>
);

/** Median error per bin on the arena grid. */
export function BinMap(props: {
  cells: BinCell[];
  shape: [number, number];
  limits: [number, number];
  swapAxes: boolean;
  /** Which bins carry the significance mark: corrected (max-stat) or uncorrected (exploratory). */
  mark: 'corrected' | 'uncorrected';
  onHover: (c: BinCell | undefined) => void;
  svgRef?: Ref;
}): JSX.Element {
  const cols = () => (props.swapAxes ? props.shape[1] : props.shape[0]);
  const rows = () => (props.swapAxes ? props.shape[0] : props.shape[1]);
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const [L, R, T, B] = [48, 78, 10, 40];
            const size = Math.max(4, Math.min((w - L - R) / cols(), (h - T - B) / rows()));
            const gridW = size * cols();
            const gridH = size * rows();
            const [lo, hi] = props.limits;
            const color = (v: number) => blue((v - lo) / (hi - lo || 1));
            const pos = (c: BinCell) => {
              const x = props.swapAxes ? c.row : c.col;
              const y = props.swapAxes ? c.col : c.row;
              return { x: L + x * size, y: T + (rows() - 1 - y) * size };
            };
            const marked = (c: BinCell) =>
              props.mark === 'corrected' ? c.significantAdj : c.significant;
            const cx = L + gridW + 18;
            return (
              <svg
                ref={props.svgRef}
                width={w}
                height={h}
                role="img"
                aria-label="Median decoding error per spatial bin"
                onMouseLeave={() => props.onHover(undefined)}
              >
                <defs>
                  <Hatch id="cb-dec-excl" />
                  <linearGradient id="cb-dec-scale" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stop-color={blue(0)} />
                    <stop offset="1" stop-color={blue(1)} />
                  </linearGradient>
                </defs>
                <For each={props.cells}>
                  {(c) => {
                    const p = pos(c);
                    return (
                      <g onMouseEnter={() => props.onHover(c)}>
                        <rect
                          x={p.x}
                          y={p.y}
                          width={size}
                          height={size}
                          fill={
                            c.excluded || !finite(c.error) ? 'url(#cb-dec-excl)' : color(c.error)
                          }
                          stroke="#fff"
                          stroke-width="0.5"
                        >
                          <title>{`${c.bin}: ${c.excluded ? 'excluded, too few training frames' : fmt(c.error, 2)}`}</title>
                        </rect>
                        <Show when={!c.excluded && marked(c)}>
                          <circle
                            cx={p.x + size / 2}
                            cy={p.y + size / 2}
                            r={Math.max(1.5, size / 6)}
                            fill="#fff"
                            stroke="#b45309"
                            stroke-width="1.2"
                          />
                        </Show>
                      </g>
                    );
                  }}
                </For>
                <rect x={L} y={T} width={gridW} height={gridH} fill="none" stroke="#94a3b8" />
                <text
                  x={L + gridW / 2}
                  y={T + gridH + 28}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  {props.swapAxes
                    ? 'Grid row (second position axis)'
                    : 'Grid column (first position axis)'}
                </text>
                <text
                  transform={`translate(12 ${T + gridH / 2}) rotate(-90)`}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  {props.swapAxes ? 'Grid column' : 'Grid row'}
                </text>
                <text x={L} y={T + gridH + 14} font-size="11" fill={TEXT}>
                  1
                </text>
                <text x={L + gridW} y={T + gridH + 14} font-size="11" fill={TEXT} text-anchor="end">
                  {cols()}
                </text>
                <text x={L - 4} y={T + gridH} font-size="11" fill={TEXT} text-anchor="end">
                  1
                </text>
                <text x={L - 4} y={T + 9} font-size="11" fill={TEXT} text-anchor="end">
                  {rows()}
                </text>
                <rect
                  x={cx}
                  y={T}
                  width={12}
                  height={Math.min(gridH, 160)}
                  fill="url(#cb-dec-scale)"
                  stroke="#94a3b8"
                />
                <text x={cx + 16} y={T + 9} font-size="11" fill={TEXT}>
                  {fmt(hi, 1)}
                </text>
                <text x={cx + 16} y={T + Math.min(gridH, 160)} font-size="11" fill={TEXT}>
                  {fmt(lo, 1)}
                </text>
                <text x={cx} y={T + Math.min(gridH, 160) + 16} font-size="11" fill={TEXT}>
                  Median error
                </text>
                <text x={cx} y={T + Math.min(gridH, 160) + 29} font-size="11" fill={TEXT}>
                  (position units)
                </text>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}

/** Histogram of the per-frame error with the framework's overall median and chance error. */
export function ErrorHistogramPlot(props: {
  hist: Histogram;
  median: number | null;
  chance: number | null;
  svgRef?: Ref;
}): JSX.Element {
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const [L, R, T, B] = [52, 16, 18, 42];
            const lo = props.hist.edges[0];
            const hi = Math.max(props.hist.edges.at(-1)!, props.chance ?? 0);
            const x = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (w - L - R);
            const top = Math.max(...props.hist.counts, 1);
            const y = (v: number) => T + (1 - v / top) * (h - T - B);
            const step = tickStep(hi - lo);
            const ticks = Array.from(
              { length: Math.floor((hi - lo) / step) + 1 },
              (_, i) => +(lo + i * step).toFixed(6),
            );
            return (
              <svg
                ref={props.svgRef}
                width={w}
                height={h}
                role="img"
                aria-label="Histogram of the decoding error per frame"
              >
                <For each={props.hist.counts}>
                  {(n, i) => (
                    <rect
                      x={x(props.hist.edges[i()])}
                      y={y(n)}
                      width={Math.max(
                        1,
                        x(props.hist.edges[i() + 1]) - x(props.hist.edges[i()]) - 1,
                      )}
                      height={h - B - y(n)}
                      fill="#60a5fa"
                    >
                      <title>{`${fmt(props.hist.edges[i()], 2)} to ${fmt(props.hist.edges[i() + 1], 2)}: ${n} frames`}</title>
                    </rect>
                  )}
                </For>
                <line x1={L} x2={w - R} y1={h - B} y2={h - B} stroke="#64748b" />
                <For each={ticks}>
                  {(t) => (
                    <>
                      <line x1={x(t)} x2={x(t)} y1={h - B} y2={h - B + 4} stroke="#64748b" />
                      <text x={x(t)} y={h - B + 16} text-anchor="middle" font-size="11" fill={TEXT}>
                        {fmt(t, 1)}
                      </text>
                    </>
                  )}
                </For>
                <Show when={props.median != null}>
                  <line
                    x1={x(props.median!)}
                    x2={x(props.median!)}
                    y1={T}
                    y2={h - B}
                    stroke="#1d4ed8"
                    stroke-width="2"
                  />
                  <text x={x(props.median!) + 4} y={T + 10} font-size="11" fill="#1d4ed8">
                    Median {fmt(props.median, 2)}
                  </text>
                </Show>
                <Show when={props.chance != null}>
                  <line
                    x1={x(props.chance!)}
                    x2={x(props.chance!)}
                    y1={T}
                    y2={h - B}
                    stroke="#b45309"
                    stroke-width="2"
                    stroke-dasharray="5 3"
                  />
                  <text
                    x={x(props.chance!) - 4}
                    y={T + 22}
                    text-anchor="end"
                    font-size="11"
                    fill="#b45309"
                  >
                    Chance {fmt(props.chance, 2)}
                  </text>
                </Show>
                <text
                  x={L + (w - L - R) / 2}
                  y={h - 6}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  Decoding error per frame (position units)
                </text>
                <text
                  transform={`translate(12 ${T + (h - T - B) / 2}) rotate(-90)`}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  Frames
                </text>
                <text x={L - 6} y={T + 4} text-anchor="end" font-size="11" fill={TEXT}>
                  {top.toLocaleString()}
                </text>
                <text x={L - 6} y={h - B} text-anchor="end" font-size="11" fill={TEXT}>
                  0
                </text>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}

/** What the framework's `decoded_trajectory` plot data holds (the keys this view reads). */
export interface TrajectoryData {
  time_s: number[];
  true: number[][];
  decoded: (number | null)[][];
  axis_names: string[];
  units: string[];
  t_range: [number, number];
}

/** True and decoded position over time, one panel per position axis, with fold borders. */
export function TrajectoryPlot(props: {
  data: TrajectoryData;
  /** Fold borders in seconds (display only). */
  folds: number[];
  svgRef?: Ref;
}): JSX.Element {
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const [L, R, T, B] = [56, 16, 14, 40];
            const d = props.data;
            const n = d.true.length;
            const panelH = (h - T - B) / n;
            const [t0, t1] = d.t_range;
            const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (w - L - R);
            const step = tickStep(t1 - t0);
            const ticks = Array.from(
              { length: Math.floor((t1 - t0) / step) + 1 },
              (_, i) => +(t0 + i * step).toFixed(6),
            );
            const path = (ys: (number | null)[], lo: number, hi: number, top: number) => {
              let s = '';
              let pen = false;
              ys.forEach((v, i) => {
                if (v == null || !Number.isFinite(v)) {
                  pen = false;
                  return;
                }
                const px = x(d.time_s[i]).toFixed(1);
                const py = (top + (1 - (v - lo) / (hi - lo || 1)) * (panelH - 8) + 4).toFixed(1);
                s += `${pen ? 'L' : 'M'}${px} ${py}`;
                pen = true;
              });
              return s;
            };
            return (
              <svg
                ref={props.svgRef}
                width={w}
                height={h}
                role="img"
                aria-label="True and decoded position over time"
              >
                <For each={d.true}>
                  {(truth, k) => {
                    const all = [...truth, ...d.decoded[k()]].filter(finite);
                    const lo = Math.min(...all);
                    const hi = Math.max(...all);
                    const top = T + k() * panelH;
                    return (
                      <g>
                        <rect
                          x={L}
                          y={top}
                          width={w - L - R}
                          height={panelH - 4}
                          fill="none"
                          stroke="#cbd5e1"
                        />
                        <For each={props.folds.filter((f) => f > t0 && f < t1)}>
                          {(f) => (
                            <line
                              x1={x(f)}
                              x2={x(f)}
                              y1={top}
                              y2={top + panelH - 4}
                              stroke="#b45309"
                              stroke-dasharray="4 3"
                            />
                          )}
                        </For>
                        <path
                          d={path(truth, lo, hi, top)}
                          fill="none"
                          stroke="#64748b"
                          stroke-width="1.6"
                        />
                        <path
                          d={path(d.decoded[k()], lo, hi, top)}
                          fill="none"
                          stroke="#2563eb"
                          stroke-width="1.2"
                        />
                        <text
                          transform={`translate(12 ${top + panelH / 2}) rotate(-90)`}
                          text-anchor="middle"
                          font-size="12"
                          fill={TEXT}
                        >
                          {d.axis_names[k()]}
                          {d.units[k()] ? ` (${d.units[k()]})` : ''}
                        </text>
                        <text x={L - 4} y={top + 12} text-anchor="end" font-size="11" fill={TEXT}>
                          {fmt(hi, 0)}
                        </text>
                        <text
                          x={L - 4}
                          y={top + panelH - 8}
                          text-anchor="end"
                          font-size="11"
                          fill={TEXT}
                        >
                          {fmt(lo, 0)}
                        </text>
                      </g>
                    );
                  }}
                </For>
                <For each={ticks}>
                  {(t) => (
                    <>
                      <line x1={x(t)} x2={x(t)} y1={h - B} y2={h - B + 4} stroke="#64748b" />
                      <text x={x(t)} y={h - B + 16} text-anchor="middle" font-size="11" fill={TEXT}>
                        {fmt(t, 0)}
                      </text>
                    </>
                  )}
                </For>
                <text
                  x={L + (w - L - R) / 2}
                  y={h - 6}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  Time in the session (s)
                </text>
                <g font-size="11" fill={TEXT}>
                  <line
                    x1={w - R - 230}
                    x2={w - R - 210}
                    y1={T + 12}
                    y2={T + 12}
                    stroke="#64748b"
                    stroke-width="1.6"
                  />
                  <text x={w - R - 206} y={T + 16}>
                    True
                  </text>
                  <line
                    x1={w - R - 160}
                    x2={w - R - 140}
                    y1={T + 12}
                    y2={T + 12}
                    stroke="#2563eb"
                    stroke-width="1.2"
                  />
                  <text x={w - R - 136} y={T + 16}>
                    Decoded
                  </text>
                  <line
                    x1={w - R - 78}
                    x2={w - R - 58}
                    y1={T + 12}
                    y2={T + 12}
                    stroke="#b45309"
                    stroke-dasharray="4 3"
                  />
                  <text x={w - R - 54} y={T + 16}>
                    Fold border
                  </text>
                </g>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}

/** Score per behavior with the range of the shuffled null and the chance level. */
export function BehaviorScorePlot(props: {
  rows: BehaviorRow[];
  chance: number | null;
  svgRef?: Ref;
}): JSX.Element {
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const names = props.rows.map((r) => r.name);
            const L = Math.min(220, 24 + 7 * Math.max(...names.map((n) => n.length), 4));
            const [R, T, B] = [24, 12, 42];
            const hi = Math.max(1, ...props.rows.map((r) => r.score ?? 0));
            const x = (v: number) => L + (v / hi) * (w - L - R);
            const rowH = Math.min(36, (h - T - B) / Math.max(1, props.rows.length));
            const ticks = [0, 0.25, 0.5, 0.75, 1];
            return (
              <svg
                ref={props.svgRef}
                width={w}
                height={h}
                role="img"
                aria-label="Decoding score per behavior"
              >
                <For each={ticks}>
                  {(t) => (
                    <>
                      <line
                        x1={x(t)}
                        x2={x(t)}
                        y1={T}
                        y2={T + rowH * props.rows.length}
                        stroke="#e2e8f0"
                      />
                      <text
                        x={x(t)}
                        y={T + rowH * props.rows.length + 16}
                        text-anchor="middle"
                        font-size="11"
                        fill={TEXT}
                      >
                        {t}
                      </text>
                    </>
                  )}
                </For>
                <Show when={props.chance != null}>
                  <line
                    x1={x(props.chance!)}
                    x2={x(props.chance!)}
                    y1={T}
                    y2={T + rowH * props.rows.length}
                    stroke="#b45309"
                    stroke-dasharray="5 3"
                  />
                  <text
                    x={x(props.chance!)}
                    y={T + rowH * props.rows.length + 30}
                    text-anchor="middle"
                    font-size="11"
                    fill="#b45309"
                  >
                    Chance {fmt(props.chance, 2)}
                  </text>
                </Show>
                <For each={props.rows}>
                  {(r, i) => {
                    const cy = T + rowH * i() + rowH / 2;
                    return (
                      <g>
                        <text x={L - 8} y={cy + 4} text-anchor="end" font-size="12" fill={TEXT}>
                          {r.name}
                        </text>
                        <Show when={finite(r.nullLo) && finite(r.nullHi)}>
                          <rect
                            x={x(r.nullLo!)}
                            y={cy - 7}
                            width={Math.max(1, x(r.nullHi!) - x(r.nullLo!))}
                            height={14}
                            fill="#e2e8f0"
                            stroke="#94a3b8"
                          >
                            <title>{`Shuffled null range ${fmt(r.nullLo)} to ${fmt(r.nullHi)}`}</title>
                          </rect>
                        </Show>
                        <Show when={finite(r.score)}>
                          <circle
                            cx={x(r.score!)}
                            cy={cy}
                            r={5}
                            fill={r.significant ? '#1d4ed8' : '#fff'}
                            stroke="#1d4ed8"
                            stroke-width="2"
                          >
                            <title>{`${r.name}: ${fmt(r.score)}, p ${fmtP(r.pAdj ?? r.p)}`}</title>
                          </circle>
                        </Show>
                      </g>
                    );
                  }}
                </For>
                <text
                  x={L + (w - L - R) / 2}
                  y={h - 4}
                  text-anchor="middle"
                  font-size="12"
                  fill={TEXT}
                >
                  Score (framework value for each behavior)
                </text>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}

/** Square confusion matrix: rows are the true behavior, columns the decoded one. */
export function ConfusionPlot(props: {
  names: string[];
  matrix: number[][];
  normalized: boolean;
  svgRef?: Ref;
}): JSX.Element {
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const n = props.names.length;
            const L = Math.min(190, 24 + 7 * Math.max(...props.names.map((s) => s.length), 4));
            const [T, B, R] = [72, 24, 12];
            const size = Math.max(14, Math.min((w - L - R) / n, (h - T - B) / n));
            const top = Math.max(...props.matrix.flat(), 1e-9);
            return (
              <svg ref={props.svgRef} width={w} height={h} role="img" aria-label="Confusion matrix">
                <For each={props.matrix}>
                  {(row, i) => (
                    <>
                      <text
                        x={L - 6}
                        y={T + i() * size + size / 2 + 4}
                        text-anchor="end"
                        font-size="12"
                        fill={TEXT}
                      >
                        {props.names[i()]}
                      </text>
                      <For each={row}>
                        {(v, j) => (
                          <>
                            <rect
                              x={L + j() * size}
                              y={T + i() * size}
                              width={size}
                              height={size}
                              fill={blue(v / top)}
                              stroke="#fff"
                            />
                            <Show when={size >= 26}>
                              <text
                                x={L + j() * size + size / 2}
                                y={T + i() * size + size / 2 + 4}
                                text-anchor="middle"
                                font-size="11"
                                fill={v / top > 0.55 ? '#fff' : '#0f172a'}
                              >
                                {props.normalized ? v.toFixed(2) : Math.round(v)}
                              </text>
                            </Show>
                          </>
                        )}
                      </For>
                    </>
                  )}
                </For>
                <For each={props.names}>
                  {(name, j) => (
                    <text
                      transform={`translate(${L + j() * size + size / 2 + 4} ${T - 6}) rotate(-45)`}
                      font-size="12"
                      fill={TEXT}
                    >
                      {name}
                    </text>
                  )}
                </For>
                <text x={L + (n * size) / 2} y={14} text-anchor="middle" font-size="12" fill={TEXT}>
                  Decoded behavior (columns)
                </text>
                <text x={L} y={T + n * size + 16} font-size="11" fill={TEXT}>
                  Rows: true behavior.{' '}
                  {props.normalized ? 'Each row sums to 1.' : 'Counts of frames.'}
                </text>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}

/** One 2 x 2 table per behavior (logistic regression, one-vs-rest): rows true, columns decoded. */
export function OneVsRestPlot(props: { tables: OneVsRest[]; svgRef?: Ref }): JSX.Element {
  return (
    <Fit>
      {(w, h) => (
        <>
          {(() => {
            const tile = { w: 170, h: 130 };
            const perRow = Math.max(1, Math.floor(w / tile.w));
            const max = Math.max(...props.tables.flatMap((t) => [t.tn, t.fp, t.fn, t.tp]), 1);
            return (
              <svg
                ref={props.svgRef}
                width={w}
                height={Math.max(h, Math.ceil(props.tables.length / perRow) * tile.h)}
                role="img"
                aria-label="One-versus-rest tables per behavior"
              >
                <For each={props.tables}>
                  {(t, i) => {
                    const ox = (i() % perRow) * tile.w + 62;
                    const oy = Math.floor(i() / perRow) * tile.h + 38;
                    const cells = [
                      [t.tn, t.fp],
                      [t.fn, t.tp],
                    ];
                    return (
                      <g>
                        <text x={ox - 52} y={oy - 22} font-size="12" font-weight="600" fill={TEXT}>
                          {t.behavior}
                        </text>
                        <text
                          x={ox + 30}
                          y={oy - 6}
                          text-anchor="middle"
                          font-size="10"
                          fill={TEXT}
                        >
                          not
                        </text>
                        <text
                          x={ox + 90}
                          y={oy - 6}
                          text-anchor="middle"
                          font-size="10"
                          fill={TEXT}
                        >
                          decoded
                        </text>
                        <text x={ox - 6} y={oy + 24} text-anchor="end" font-size="10" fill={TEXT}>
                          not
                        </text>
                        <text x={ox - 6} y={oy + 80} text-anchor="end" font-size="10" fill={TEXT}>
                          true
                        </text>
                        <For each={cells}>
                          {(row, r) => (
                            <For each={row}>
                              {(v, c) => (
                                <>
                                  <rect
                                    x={ox + c() * 60}
                                    y={oy + r() * 40}
                                    width={60}
                                    height={40}
                                    fill={blue(v / max)}
                                    stroke="#fff"
                                  />
                                  <text
                                    x={ox + c() * 60 + 30}
                                    y={oy + r() * 40 + 24}
                                    text-anchor="middle"
                                    font-size="11"
                                    fill={v / max > 0.55 ? '#fff' : '#0f172a'}
                                  >
                                    {Math.round(v)}
                                  </text>
                                </>
                              )}
                            </For>
                          )}
                        </For>
                      </g>
                    );
                  }}
                </For>
              </svg>
            );
          })()}
        </>
      )}
    </Fit>
  );
}
