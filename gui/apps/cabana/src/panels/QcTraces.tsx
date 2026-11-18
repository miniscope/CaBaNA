// Trace plots for the QC and Preprocess pop-ups: the selected cell in the Data visualization
// window, one panel per signal, panels sharing zoom and cursor.

import { For, Show, type JSX } from 'solid-js';
import { TracePanel } from '@calab/ui/chart';
import type uPlot from 'uplot';
import { lowerBound } from '../lib/framework.ts';
import {
  cell,
  deconvolved,
  denoisedTrace,
  frameTimes,
  rawTrace,
  samplingRate,
} from '../lib/store.ts';
import { win } from '../lib/viz.ts';

export interface TraceLine {
  label: string;
  stroke: string;
  width?: number;
  values: ArrayLike<number> | undefined;
}

/** The selected cell's row of a matrix, for the whole session. */
export function cellRow(m: ReturnType<typeof rawTrace>): ArrayLike<number> | undefined {
  return m ? m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames) : undefined;
}

/** Times (s) and the frame range inside the Data visualization window. */
function windowed(
  frames: number,
  range?: [number, number],
): { t: number[]; lo: number; hi: number } {
  const ts = frameTimes();
  const t =
    ts?.slice(0, frames) ?? Array.from({ length: frames }, (_, i) => i / (samplingRate() ?? 30));
  const [a, b] = range ?? win();
  const lo = lowerBound(t, a);
  return { t: t.slice(lo, lowerBound(t, b)), lo, hi: lowerBound(t, b) };
}

/** Shades time ranges (s) behind the lines, e.g. lost frames. */
const shading = (ranges: () => [number, number][]): uPlot.Plugin => ({
  hooks: {
    draw(u) {
      const { ctx, bbox } = u;
      ctx.save();
      ctx.fillStyle = 'rgba(224,152,0,0.22)';
      for (const [a, b] of ranges()) {
        const x0 = Math.max(u.valToPos(a, 'x', true), bbox.left);
        const x1 = Math.min(u.valToPos(b, 'x', true), bbox.left + bbox.width);
        if (x1 > x0) ctx.fillRect(x0, bbox.top, Math.max(x1 - x0, 2), bbox.height);
      }
      ctx.restore();
    },
  },
});

/** One panel: each line over the window's frames. */
export function WindowPanel(props: {
  lines: TraceLine[];
  height: number;
  /** Seconds to show instead of the Data visualization window. */
  range?: [number, number];
  /** Time ranges (s) to shade, e.g. lost frames. */
  shade?: () => [number, number][];
}): JSX.Element {
  const lines = () => props.lines.filter((l) => l.values);
  const frames = () => Math.max(0, ...lines().map((l) => l.values!.length));
  const data = () => {
    const { t, lo, hi } = windowed(frames(), props.range);
    // A lost frame is a gap in the line, not zero.
    const at = (l: TraceLine, i: number) => {
      const v = l.values![lo + i];
      return Number.isFinite(v) ? v : null;
    };
    return [
      t,
      ...lines().map((l) => Array.from({ length: hi - lo }, (_, i) => at(l, i))),
    ] as unknown as [number[], ...number[][]];
  };
  const series = (): uPlot.Series[] => [
    {},
    ...lines().map((l) => ({ label: l.label, stroke: l.stroke, width: l.width ?? 1 })),
  ];
  return (
    <Show when={lines().length}>
      <TracePanel
        data={data}
        series={series()}
        height={props.height}
        syncKey="cabana-qc-popup"
        xLabel="Time (s)"
        plugins={props.shade ? [shading(props.shade)] : undefined}
      />
    </Show>
  );
}

const SIGNALS = [
  { label: 'Raw fluorescence', stroke: '#8a97a8', matrix: rawTrace },
  { label: 'Denoised trace', stroke: '#2171b5', matrix: denoisedTrace },
  { label: 'Deconvolved events', stroke: '#e09800', matrix: deconvolved },
];

/** Raw, denoised and deconvolved traces of the selected cell; the panels that are loaded. */
export function WindowTraces(props: { height: number }): JSX.Element {
  return (
    <For each={SIGNALS}>
      {(s) => (
        <Show when={s.matrix()}>
          <div class="cb-qp__small">{s.label}</div>
          <WindowPanel
            height={props.height}
            lines={[{ label: s.label, stroke: s.stroke, values: cellRow(s.matrix()) }]}
          />
        </Show>
      )}
    </For>
  );
}
