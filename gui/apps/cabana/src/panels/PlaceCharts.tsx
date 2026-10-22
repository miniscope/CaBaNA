import { createEffect, For, type JSX } from 'solid-js';
import { colorAt } from '../lib/place-display.ts';
import type { Overall } from '../lib/place-outcome.ts';

/** Value of the sorted list at quantile q (0..1). */
const quantile = (sorted: number[], q: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]
    : NaN;
const finiteSorted = (a: ArrayLike<number>) =>
  Array.from(a)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);

/**
 * The shifted values of one cell for one measure, as a histogram with the observed value and the
 * value that only `alpha` of the shifted values reach (the cutoff for p < alpha).
 */
export function ShuffleHistogram(props: {
  title: string;
  unit: string;
  nullValues: ArrayLike<number>;
  observed: number;
  alpha: number;
  p: string;
}): JSX.Element {
  const W = 300;
  const H = 110;
  const sorted = () => finiteSorted(props.nullValues);
  const lo = () =>
    Math.min(sorted()[0] ?? 0, Number.isFinite(props.observed) ? props.observed : Infinity);
  const hi = () =>
    Math.max(
      sorted()[sorted().length - 1] ?? 1,
      Number.isFinite(props.observed) ? props.observed : -Infinity,
    );
  const x = (v: number) => 8 + ((v - lo()) / (hi() - lo() || 1)) * (W - 16);
  const bars = () => {
    const bins = 30;
    const c = new Array<number>(bins).fill(0);
    for (const v of sorted())
      c[Math.min(bins - 1, Math.floor(((v - lo()) / (hi() - lo() || 1)) * bins))]++;
    const top = Math.max(1, ...c);
    return c.map((n, i) => ({
      x: x(lo() + ((hi() - lo()) * i) / bins),
      w: (W - 16) / bins - 1,
      h: (n / top) * (H - 30),
    }));
  };
  const cutoff = () => quantile(sorted(), 1 - props.alpha);
  return (
    <figure class="cb-hist">
      <figcaption>
        {props.title} <span class="cb-muted">p = {props.p}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${props.title}: observed ${props.observed.toFixed(3)} against ${sorted().length} shifted values`}
      >
        <For each={bars()}>
          {(b) => (
            <rect x={b.x} y={H - 18 - b.h} width={Math.max(1, b.w)} height={b.h} fill="#c9c9c6" />
          )}
        </For>
        <line x1="8" x2={W - 8} y1={H - 18} y2={H - 18} stroke="#999" />
        <line
          x1={x(cutoff())}
          x2={x(cutoff())}
          y1="4"
          y2={H - 18}
          stroke="#666"
          stroke-dasharray="4 3"
        />
        {Number.isFinite(props.observed) && (
          <line
            x1={x(props.observed)}
            x2={x(props.observed)}
            y1="4"
            y2={H - 18}
            stroke="#d1495b"
            stroke-width="2.5"
          />
        )}
        <text x="8" y={H - 4} font-size="10" fill="#666">
          {lo().toFixed(2)}
        </text>
        <text x={W - 8} y={H - 4} font-size="10" fill="#666" text-anchor="end">
          {hi().toFixed(2)} {props.unit}
        </text>
      </svg>
    </figure>
  );
}

/** One color per outcome, shared by the heatmap strip and its legend. */
export const OUTCOME_COLOR: Record<Overall, string> = {
  both: '#185FA5',
  info: '#7F77DD',
  stab: '#EF9F27',
  neither: '#B4B2A9',
  cannot: '#D4537E',
};
const hexRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** About four round-ish tick values from `lo` to `hi`. */
function ticks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => t >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}

/**
 * One value per cell, ranked high to low. A filled dot is a cell that passed this test, a hollow dot
 * one that did not. The grey band runs from the middle of a cell's shifted values up to its cutoff for p < alpha.
 */
export function MetricStrip(props: {
  title: string;
  /** What is ranked, for the x label, and the unit of the values. */
  rankedBy: string;
  unit: string;
  values: Float64Array;
  p: Float64Array;
  /** Cell number shown for each result row. */
  ids: number[];
  /** Shifted values, cell * nShifts + shift. */
  nullValues: Float32Array;
  nShifts: number;
  passed: Uint8Array;
  alpha: number;
  selected: number;
  onPick: (i: number) => void;
}): JSX.Element {
  const W = 420;
  const H = 200;
  const [L, R, T, B] = [46, 8, 8, 34];
  const order = () =>
    Array.from(props.values.keys())
      .filter((i) => Number.isFinite(props.values[i]))
      .sort((a, b) => props.values[b] - props.values[a]);
  const band = () =>
    order().map((i) => {
      const s = finiteSorted(props.nullValues.subarray(i * props.nShifts, (i + 1) * props.nShifts));
      return [quantile(s, 0.5), quantile(s, 1 - props.alpha)] as const;
    });
  const top = () =>
    Math.max(
      1e-9,
      ...order().map((i) => props.values[i]),
      ...band()
        .map((b) => b[1])
        .filter(Number.isFinite),
    );
  const bottom = () => Math.min(0, ...order().map((i) => props.values[i]));
  const px = (k: number) => L + (k / Math.max(1, order().length - 1)) * (W - L - R);
  const py = (v: number) => T + (1 - (v - bottom()) / (top() - bottom() || 1)) * (H - T - B);
  const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : +v.toFixed(2)).toString();
  return (
    <figure class="cb-strip">
      <figcaption>{props.title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${props.title} for each cell, ranked by ${props.rankedBy}`}
      >
        <For each={ticks(bottom(), top())}>
          {(t) => (
            <>
              <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="#e6e6e3" />
              <text x={L - 4} y={py(t) + 3} font-size="10" fill="#666" text-anchor="end">
                {fmt(t)}
              </text>
            </>
          )}
        </For>
        <polygon
          fill="#d9d9d5"
          points={[
            ...band().map((b, k) => `${px(k)},${py(b[1])}`),
            ...band()
              .map((b, k) => `${px(k)},${py(b[0])}`)
              .reverse(),
          ].join(' ')}
        />
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#999" />
        <For each={order()}>
          {(i, k) => (
            <circle
              cx={px(k())}
              cy={py(props.values[i])}
              r={i === props.selected ? 5 : 2.6}
              fill={props.passed[i] ? '#2171b5' : '#fff'}
              stroke={i === props.selected ? '#000' : props.passed[i] ? '#2171b5' : '#888'}
              stroke-width={i === props.selected ? 2 : 1}
              style={{ cursor: 'pointer' }}
              onClick={() => props.onPick(i)}
            >
              <title>{`Cell ${props.ids[i] + 1}: ${fmt(props.values[i])} ${props.unit}, p = ${props.p[i].toFixed(3)}`}</title>
            </circle>
          )}
        </For>
        <For each={[1, Math.round(order().length / 2), order().length]}>
          {(n, k) => (
            <text
              x={px(Math.max(0, n - 1))}
              y={H - B + 12}
              font-size="10"
              fill="#666"
              text-anchor={k() === 0 ? 'start' : k() === 2 ? 'end' : 'middle'}
            >
              {n}
            </text>
          )}
        </For>
        <text x={(L + W - R) / 2} y={H - 4} font-size="10" fill="#666" text-anchor="middle">
          Cells ranked by {props.rankedBy}
        </text>
        <text
          transform={`translate(11,${(T + H - B) / 2}) rotate(-90)`}
          font-size="10"
          fill="#666"
          text-anchor="middle"
        >
          {props.unit}
        </text>
      </svg>
    </figure>
  );
}

export type TuningSort = 'peak' | 'information' | 'stability' | 'cell';

type TuningRows = {
  rate: Float32Array;
  nStates: number;
  cells: number;
  include: Uint8Array;
  sort: TuningSort;
  information: Float64Array;
  stability: Float64Array;
};

/** The result rows the heatmap draws, top to bottom. A cell with no finite bin is left out. */
export function tuningOrder(p: TuningRows): number[] {
  const peakBin = (i: number) => {
    let best = -1;
    let bi = Infinity;
    for (let k = 0; k < p.nStates; k++) {
      const v = p.rate[i * p.nStates + k];
      if (Number.isFinite(v) && v > best) {
        best = v;
        bi = k;
      }
    }
    return bi;
  };
  const key = (i: number) =>
    p.sort === 'peak'
      ? peakBin(i)
      : p.sort === 'cell'
        ? i
        : -(p.sort === 'information' ? p.information : p.stability)[i];
  return Array.from({ length: p.cells }, (_, i) => i)
    .filter((i) => p.include[i] && peakBin(i) !== Infinity)
    .map((i) => [i, key(i)] as const)
    .sort((a, b) => (Number.isNaN(a[1]) ? 1 : Number.isNaN(b[1]) ? -1 : a[1] - b[1]) || a[0] - b[0])
    .map(([i]) => i);
}

/**
 * Cells by bins: each row is one cell's map scaled from its lowest to its highest bin. A strip at the right edge
 * gives each cell's outcome. Bins are in the order of the analysis: row by row from the bottom-left corner of the arena.
 * `outcome` holds an index into OVERALL_ORDER for each result row, and `include` which rows to draw.
 */
export function PopulationTuning(props: {
  rate: Float32Array;
  nStates: number;
  cells: number;
  outcome: Uint8Array;
  outcomes: Overall[];
  include: Uint8Array;
  sort: TuningSort;
  information: Float64Array;
  stability: Float64Array;
  /** Which bins lie inside the arena. */
  open: boolean[];
  selected: number;
  onPick: (i: number) => void;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const order = () => tuningOrder(props);
  const ROW = () => Math.max(1, Math.min(4, Math.round(540 / Math.max(1, order().length))));
  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rows = order();
    const n = props.nStates;
    const row = ROW();
    canvas.width = n + 10;
    canvas.height = Math.max(1, rows.length) * row;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const [grey, white] = [
      [212, 212, 208],
      [255, 255, 255],
    ];
    rows.forEach((i, r) => {
      const m = props.rate.subarray(i * n, (i + 1) * n);
      const fin = Array.from(m).filter(Number.isFinite);
      const lo = Math.min(...fin);
      const hi = Math.max(...fin);
      const strip = hexRgb(OUTCOME_COLOR[props.outcomes[props.outcome[i]]]);
      for (let y = 0; y < row; y++)
        for (let k = 0; k < canvas!.width; k++) {
          const o = 4 * ((r * row + y) * canvas!.width + k);
          let rgb: number[] = grey;
          if (k >= n + 4) rgb = strip;
          else if (k >= n) rgb = white;
          else if (!props.open[k]) rgb = white;
          else if (Number.isFinite(m[k])) rgb = colorAt(hi > lo ? (m[k] - lo) / (hi - lo) : 0);
          img.data.set([rgb[0], rgb[1], rgb[2], 255], o);
        }
    });
    ctx.putImageData(img, 0, 0);
    const r = rows.indexOf(props.selected);
    if (r >= 0) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, r * row - 0.5, canvas.width - 1, row + 1);
    }
  });
  return (
    <canvas
      ref={canvas}
      class="cb-popmap__canvas"
      role="img"
      aria-label={`Spatial tuning of ${order().length} cells, one row per cell`}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const rows = order();
        const row = Math.floor(((e.clientY - box.top) / box.height) * rows.length);
        const i = rows[Math.min(rows.length - 1, Math.max(0, row))];
        if (i !== undefined) props.onPick(i);
      }}
    />
  );
}
