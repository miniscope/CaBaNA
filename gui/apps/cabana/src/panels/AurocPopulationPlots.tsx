// Plots of the auROC population views. They take plain values, so they hold no selection state.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { heatColor, type HistogramBin } from '../lib/auroc-population.ts';

const ORANGE = '#e8851a';
const PURPLE = '#6a3db8';
const GRAY = '#c9c9c9';
const BLUE = '#1f6fb2';
const fixed = (v: number, d = 2) => v.toFixed(d);

/** The color scale with its real range: purple at 0.5 - half, light gray at 0.5, orange at 0.5 + half. */
export function HeatLegend(props: { half: number }): JSX.Element {
  const stops = Array.from({ length: 11 }, (_, i) => 0.5 - props.half + (i / 10) * 2 * props.half);
  return (
    <div class="cb-ar-legend">
      <div class="cb-ar-legend__scale">
        <div
          class="cb-ar-legend__bar"
          role="img"
          aria-label={`auROC color scale from ${fixed(0.5 - props.half)} (lower) to ${fixed(0.5 + props.half)} (higher)`}
        >
          <For each={stops}>{(v) => <span style={{ background: heatColor(v, props.half) }} />}</For>
        </div>
        <div class="cb-ar-legend__ticks">
          <span>{fixed(0.5 - props.half)}</span>
          <span>0.50</span>
          <span>{fixed(0.5 + props.half)}</span>
        </div>
        <div class="cb-ar-legend__ends">
          <span style={{ color: PURPLE }}>Lower activity</span>
          <span style={{ color: '#a85c0c' }}>Higher activity</span>
        </div>
      </div>
      <div class="cb-ar-legend__keys">
        <span>
          <i class="cb-ar-dot" aria-hidden="true" /> Significant (adjusted p below α)
        </span>
        <span>
          <i class="cb-ar-legend__na" aria-hidden="true" /> Not evaluated
        </span>
        <span class="cb-muted">Range set by the largest deviation from 0.5 in this run.</span>
      </div>
    </div>
  );
}

/**
 * One behavior: every cell as a thin column, ranked left to right. A dot above a column marks a
 * significant cell; the selected cell is outlined. Click a column to select the cell.
 */
export function RankedStrip(props: {
  cells: number[];
  auroc: (cell: number) => number;
  significant: (cell: number) => boolean;
  half: number;
  selected: number;
  onSelect: (cell: number) => void;
  onHover: (cell: number | undefined) => void;
  label: string;
  cellName: (cell: number) => string;
}): JSX.Element {
  const [W, DOT, STRIP] = [1000, 12, 70];
  const w = () => W / Math.max(1, props.cells.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${DOT + STRIP + 2}`}
      preserveAspectRatio="none"
      class="cb-ar-strip-svg"
      role="img"
      aria-label={`auROC of every cell for ${props.label}, ranked from highest to lowest`}
    >
      <For each={props.cells}>
        {(cell, i) => (
          <>
            <rect
              x={i() * w()}
              y={DOT}
              width={w() + 0.4}
              height={STRIP}
              fill={heatColor(props.auroc(cell), props.half)}
              onClick={() => props.onSelect(cell)}
              onMouseEnter={() => props.onHover(cell)}
              onMouseLeave={() => props.onHover(undefined)}
            >
              <title>{props.cellName(cell)}</title>
            </rect>
            <Show when={props.significant(cell)}>
              <circle
                cx={i() * w() + w() / 2}
                cy={DOT / 2}
                r={Math.min(4, Math.max(1.5, w() / 2))}
                fill="#111"
                pointer-events="none"
              />
            </Show>
          </>
        )}
      </For>
      <Show when={props.cells.indexOf(props.selected) >= 0}>
        <rect
          x={props.cells.indexOf(props.selected) * w() - 1}
          y={DOT - 1}
          width={Math.max(w(), 3) + 2}
          height={STRIP + 2}
          fill="none"
          stroke={BLUE}
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          pointer-events="none"
        />
      </Show>
    </svg>
  );
}

/** auROC of the evaluated cells for one behavior, bars split into higher, lower and not significant. */
export function AurocHistogram(props: {
  bins: HistogramBin[];
  half: number;
  w: number;
  h: number;
}): JSX.Element {
  const [L, R, T, B] = [40, 12, 10, 34];
  const total = (b: HistogramBin) => b.higher + b.lower + b.notSignificant;
  const top = createMemo(() => Math.max(1, ...props.bins.map(total)));
  const pw = () => props.w - L - R;
  const ph = () => props.h - T - B;
  const x = (v: number) => L + ((v - (0.5 - props.half)) / (2 * props.half)) * pw();
  const y = (n: number) => T + ph() - (n / top()) * ph();
  const ticks = () => [0.5 - props.half, 0.5, 0.5 + props.half];
  return (
    <svg
      viewBox={`0 0 ${props.w} ${props.h}`}
      width={props.w}
      height={props.h}
      role="img"
      aria-label="Histogram of auROC across evaluated cells"
    >
      <line x1={L} x2={L} y1={T} y2={T + ph()} stroke="#999" />
      <line x1={L} x2={L + pw()} y1={T + ph()} y2={T + ph()} stroke="#999" />
      <For each={[0, top()]}>
        {(n) => (
          <text x={L - 6} y={y(n) + 4} text-anchor="end" font-size="11" fill="currentColor">
            {n}
          </text>
        )}
      </For>
      <For each={props.bins}>
        {(b) => {
          const parts: [number, string][] = [
            [b.notSignificant, GRAY],
            [b.higher, ORANGE],
            [b.lower, PURPLE],
          ];
          let acc = 0;
          return (
            <For each={parts}>
              {([n, fill]) => {
                const y0 = acc;
                acc += n;
                return (
                  <Show when={n > 0}>
                    <rect
                      x={x(b.from) + 0.5}
                      width={Math.max(1, x(b.to) - x(b.from) - 1)}
                      y={y(y0 + n)}
                      height={y(y0) - y(y0 + n)}
                      fill={fill}
                    />
                  </Show>
                );
              }}
            </For>
          );
        }}
      </For>
      <line x1={x(0.5)} x2={x(0.5)} y1={T} y2={T + ph()} stroke="#333" stroke-dasharray="4 3" />
      <For each={ticks()}>
        {(v) => (
          <text x={x(v)} y={T + ph() + 15} text-anchor="middle" font-size="11" fill="currentColor">
            {fixed(v)}
          </text>
        )}
      </For>
      <text
        x={L + pw() / 2}
        y={props.h - 4}
        text-anchor="middle"
        font-size="12"
        fill="currentColor"
      >
        auROC
      </text>
      <text
        transform={`translate(11 ${T + ph() / 2}) rotate(-90)`}
        text-anchor="middle"
        font-size="12"
        fill="currentColor"
      >
        Cells
      </text>
    </svg>
  );
}
