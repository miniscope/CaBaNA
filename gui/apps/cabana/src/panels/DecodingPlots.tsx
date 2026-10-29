// The plots of the position-decoding results. Plain SVG, sized by the card that holds them.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { DecodeOutcome } from '../lib/decoding-run.ts';
import { formatP, stateRows, type StateRow } from '../lib/decoding-view.ts';

/** The bin picked in the map or the table, shared by both. */
export const [selectedBin, setSelectedBin] = createSignal<number | undefined>();

const PAD = { l: 44, r: 12, t: 10, b: 30 };
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/** A light-to-dark blue for a value between 0 and 1. */
const shade = (f: number) => {
  const k = Math.max(0, Math.min(1, f));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${mix(235, 18)}, ${mix(242, 74)}, ${mix(252, 160)})`;
};

// ---- median error per spatial bin -------------------------------------------------------------

/** The arena as a grid: each visited bin is shaded by its median decoding error (cm). */
export function ErrorMap(props: { out: DecodeOutcome; w: number; h: number }): JSX.Element {
  const grid = () => props.out.data.frames.grid;
  const rows = createMemo(() => stateRows(props.out));
  const byState = createMemo(() => new Map(rows().map((r) => [r.state, r])));
  const top = createMemo(() => {
    const v = rows().map((r) => r.value).filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? Math.max(v[Math.floor(0.95 * (v.length - 1))], 1e-9) : 1;
  });
  const legendW = 14;
  const cell = () => {
    const g = grid();
    return Math.max(4, Math.min((props.w - legendW - 56) / g.nx, (props.h - 12) / g.ny));
  };
  const mark = (r: StateRow | undefined) => r?.status === 'significant';
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="Median decoding error per spatial bin">
      <defs>
        <pattern id="dec-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#f1f1f1" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#aaa" stroke-width="1.5" />
        </pattern>
      </defs>
      <g transform="translate(6,6)">
        <For each={Array.from({ length: grid().nx * grid().ny }, (_, s) => s)}>
          {(s) => {
            const r = () => byState().get(s);
            const x = (s % grid().nx) * cell();
            // Row 0 is the lowest y: draw it at the bottom, as the trajectory plots do.
            const y = (grid().ny - 1 - Math.floor(s / grid().nx)) * cell();
            return (
              <g onClick={() => r() && setSelectedBin(selectedBin() === s ? undefined : s)} style={{ cursor: r() ? 'pointer' : 'default' }}>
                <rect
                  x={x}
                  y={y}
                  width={cell()}
                  height={cell()}
                  fill={!r() ? '#fff' : r()!.status === 'not evaluated' ? 'url(#dec-hatch)' : shade(r()!.value / top())}
                  stroke={selectedBin() === s ? 'var(--text-primary)' : 'var(--border-subtle)'}
                  stroke-width={selectedBin() === s ? 2 : 1}
                >
                  <title>
                    {r()
                      ? `Bin ${s}: ${r()!.frames} frames, ${r()!.status === 'not evaluated' ? 'not evaluated (too few frames)' : `median error ${fmt(r()!.value)} cm`}${Number.isFinite(r()!.pAdj) ? `, p ${formatP(r()!.pAdj, props.out.settings.nShuffles)}` : ''}`
                      : 'Never visited, or outside the arena'}
                  </title>
                </rect>
                <Show when={mark(r())}>
                  <circle cx={x + cell() / 2} cy={y + cell() / 2} r={Math.max(1.5, cell() * 0.12)} fill="#fff" stroke="#222" stroke-width="1" pointer-events="none" />
                </Show>
              </g>
            );
          }}
        </For>
        <g transform={`translate(${grid().nx * cell() + 12},0)`}>
          <defs>
            <linearGradient id="dec-scale" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stop-color={shade(0)} />
              <stop offset="1" stop-color={shade(1)} />
            </linearGradient>
          </defs>
          <rect width={legendW} height={Math.min(grid().ny * cell(), 160)} fill="url(#dec-scale)" stroke="var(--border-default)" />
          <text x={legendW + 4} y={10} font-size="10" fill="var(--text-secondary)">
            ≥ {fmt(top())}
          </text>
          <text x={legendW + 4} y={Math.min(grid().ny * cell(), 160)} font-size="10" fill="var(--text-secondary)">
            0 cm
          </text>
        </g>
      </g>
    </svg>
  );
}

// ---- error histogram --------------------------------------------------------------------------

/** Decoding error of every decoded frame, with the overall median and the error of always guessing the most visited bin. */
export function ErrorHistogram(props: { out: DecodeOutcome; w: number; h: number }): JSX.Element {
  const bin = () => props.out.data.frames.grid.bin;
  const hist = createMemo(() => {
    const e = props.out.observed.error;
    const vals: number[] = [];
    for (let t = 0; t < e.length; t++) if (Number.isFinite(e[t])) vals.push(e[t]);
    const upper = Math.max(1, props.out.observed.chanceError * 1.5 || 0, vals.reduce((m, v) => Math.max(m, v), 0));
    const width = Math.max(bin() / 2, upper / 40);
    const n = Math.ceil(upper / width) + 1;
    const counts = new Array<number>(n).fill(0);
    for (const v of vals) counts[Math.min(n - 1, Math.floor(v / width))]++;
    return { counts, width, n, total: vals.length, upper: n * width };
  });
  const iw = () => props.w - PAD.l - PAD.r;
  const ih = () => props.h - PAD.t - PAD.b;
  const x = (cm: number) => PAD.l + (cm / hist().upper) * iw();
  const peak = () => Math.max(...hist().counts, 1) / Math.max(hist().total, 1);
  const y = (f: number) => PAD.t + ih() - (f / peak()) * ih();
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="Distribution of decoding error">
      <For each={hist().counts}>
        {(c, i) => (
          <rect
            x={x(i() * hist().width) + 0.5}
            y={y(c / Math.max(hist().total, 1))}
            width={Math.max(1, x(hist().width) - x(0) - 1)}
            height={PAD.t + ih() - y(c / Math.max(hist().total, 1))}
            fill="#6f9bd6"
          />
        )}
      </For>
      <line x1={PAD.l} x2={PAD.l + iw()} y1={PAD.t + ih()} y2={PAD.t + ih()} stroke="var(--border-default)" />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih()} stroke="var(--border-default)" />
      <Show when={Number.isFinite(props.out.observed.errorOverall)}>
        <line x1={x(props.out.observed.errorOverall)} x2={x(props.out.observed.errorOverall)} y1={PAD.t} y2={PAD.t + ih()} stroke="#0b3d91" stroke-width="2" />
        <text x={x(props.out.observed.errorOverall) + 4} y={PAD.t + 10} font-size="11" fill="#0b3d91">
          median {fmt(props.out.observed.errorOverall)} cm
        </text>
      </Show>
      <Show when={Number.isFinite(props.out.observed.chanceError)}>
        <line x1={x(props.out.observed.chanceError)} x2={x(props.out.observed.chanceError)} y1={PAD.t} y2={PAD.t + ih()} stroke="#a05a00" stroke-width="2" stroke-dasharray="5 3" />
        <text x={x(props.out.observed.chanceError) + 4} y={PAD.t + 24} font-size="11" fill="#a05a00">
          chance {fmt(props.out.observed.chanceError)} cm
        </text>
      </Show>
      <text x={PAD.l + iw() / 2} y={props.h - 6} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Decoding error (cm)
      </text>
      <text transform={`translate(12,${PAD.t + ih() / 2}) rotate(-90)`} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Fraction of frames
      </text>
      <text x={PAD.l - 4} y={PAD.t + 8} text-anchor="end" font-size="10" fill="var(--text-secondary)">
        {fmt(peak(), 2)}
      </text>
      <text x={PAD.l - 4} y={PAD.t + ih()} text-anchor="end" font-size="10" fill="var(--text-secondary)">
        0
      </text>
      <For each={[0, 0.25, 0.5, 0.75, 1]}>
        {(f) => (
          <text x={x(f * hist().upper)} y={PAD.t + ih() + 12} text-anchor="middle" font-size="10" fill="var(--text-secondary)">
            {fmt(f * hist().upper, 0)}
          </text>
        )}
      </For>
    </svg>
  );
}

// ---- decoded and true position over time -----------------------------------------------------

const WINDOWS = [
  { label: '30 s', s: 30 },
  { label: '2 min', s: 120 },
  { label: 'Whole session', s: Infinity },
];
const [windowIdx, setWindowIdx] = createSignal(0);
const [startFrac, setStartFrac] = createSignal(0);

export function TimeControls(): JSX.Element {
  return (
    <span class="cb-dec-tools">
      <label>
        Show{' '}
        <select value={windowIdx()} onChange={(e) => setWindowIdx(+e.currentTarget.value)}>
          <For each={WINDOWS}>{(w, i) => <option value={i()}>{w.label}</option>}</For>
        </select>
      </label>
      <Show when={Number.isFinite(WINDOWS[windowIdx()].s)}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          aria-label="Start of the shown time window"
          value={startFrac()}
          onInput={(e) => setStartFrac(+e.currentTarget.value)}
        />
      </Show>
    </span>
  );
}

/** True position (line) and decoded position (dots) of the used frames, x above y; dashed lines are fold boundaries. */
export function DecodedTrace(props: { out: DecodeOutcome; w: number; h: number }): JSX.Element {
  const input = () => props.out.data.input;
  const grid = () => props.out.data.frames.grid;
  const view = createMemo(() => {
    const total = input().frames / input().fs;
    const span = Math.min(WINDOWS[windowIdx()].s, total);
    const t0 = (total - span) * startFrac();
    return { t0, t1: t0 + span };
  });
  const iw = () => props.w - PAD.l - PAD.r;
  const panelH = () => (props.h - PAD.t - PAD.b - 14) / 2;
  const x = (t: number) => PAD.l + ((t - view().t0) / (view().t1 - view().t0)) * iw();
  const frames = createMemo(() => {
    const ob = props.out.observed;
    const { fs } = input();
    const stride = Math.max(1, Math.ceil(((view().t1 - view().t0) * fs) / 1500));
    const pts: { t: number; tx: number; ty: number; dx: number; dy: number }[] = [];
    let last = -1;
    ob.usedFrames.forEach((f) => {
      const t = f / fs;
      if (t < view().t0 || t > view().t1 || f - last < stride) return;
      last = f;
      const lab = input().labels[f];
      const d = ob.decoded[f];
      pts.push({
        t,
        tx: input().centers![2 * lab],
        ty: input().centers![2 * lab + 1],
        dx: d >= 0 ? input().centers![2 * d] : NaN,
        dy: d >= 0 ? input().centers![2 * d + 1] : NaN,
      });
    });
    return pts;
  });
  const foldEdges = createMemo(() => {
    const ob = props.out.observed;
    const e: number[] = [];
    ob.folds.forEach((f, j) => {
      if (j > 0 && f !== ob.folds[j - 1]) e.push(ob.usedFrames[j] / input().fs);
    });
    return e;
  });
  const axis = (which: 'x' | 'y', top: number) => {
    const max = (which === 'x' ? grid().nx : grid().ny) * grid().bin;
    const yv = (v: number) => top + panelH() - (v / max) * panelH();
    return (
      <g>
        <line x1={PAD.l} x2={PAD.l + iw()} y1={top + panelH()} y2={top + panelH()} stroke="var(--border-default)" />
        <line x1={PAD.l} x2={PAD.l} y1={top} y2={top + panelH()} stroke="var(--border-default)" />
        <text x={PAD.l - 4} y={top + 8} text-anchor="end" font-size="10" fill="var(--text-secondary)">
          {fmt(max, 0)}
        </text>
        <text x={PAD.l - 4} y={top + panelH()} text-anchor="end" font-size="10" fill="var(--text-secondary)">
          0
        </text>
        <text transform={`translate(12,${top + panelH() / 2}) rotate(-90)`} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
          {which} (cm)
        </text>
        <polyline
          fill="none"
          stroke="#555"
          stroke-width="1.2"
          points={frames()
            .map((p) => `${x(p.t).toFixed(1)},${yv(which === 'x' ? p.tx : p.ty).toFixed(1)}`)
            .join(' ')}
        />
        <For each={frames().filter((p) => Number.isFinite(which === 'x' ? p.dx : p.dy))}>
          {(p) => <circle cx={x(p.t)} cy={yv(which === 'x' ? p.dx : p.dy)} r="1.8" fill="#1a6fd6" />}
        </For>
        <For each={foldEdges().filter((t) => t > view().t0 && t < view().t1)}>
          {(t) => <line x1={x(t)} x2={x(t)} y1={top} y2={top + panelH()} stroke="#999" stroke-dasharray="4 3" />}
        </For>
      </g>
    );
  };
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="Decoded and true position over time">
      {axis('x', PAD.t)}
      {axis('y', PAD.t + panelH() + 14)}
      <For each={[0, 0.25, 0.5, 0.75, 1]}>
        {(f) => (
          <text x={x(view().t0 + f * (view().t1 - view().t0))} y={props.h - 14} text-anchor="middle" font-size="10" fill="var(--text-secondary)">
            {fmt(view().t0 + f * (view().t1 - view().t0), 0)}
          </text>
        )}
      </For>
      <text x={PAD.l + iw() / 2} y={props.h - 2} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Time (s)
      </text>
    </svg>
  );
}
