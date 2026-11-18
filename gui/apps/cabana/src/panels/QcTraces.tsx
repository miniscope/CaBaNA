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
function windowed(frames: number): { t: number[]; lo: number; hi: number } {
  const ts = frameTimes();
  const t =
    ts?.slice(0, frames) ?? Array.from({ length: frames }, (_, i) => i / (samplingRate() ?? 30));
  const [a, b] = win();
  const lo = lowerBound(t, a);
  return { t: t.slice(lo, lowerBound(t, b)), lo, hi: lowerBound(t, b) };
}

/** One panel: each line over the window's frames. */
export function WindowPanel(props: { lines: TraceLine[]; height: number }): JSX.Element {
  const lines = () => props.lines.filter((l) => l.values);
  const frames = () => Math.max(0, ...lines().map((l) => l.values!.length));
  const data = () => {
    const { t, lo, hi } = windowed(frames());
    return [
      t,
      ...lines().map((l) => Array.from({ length: hi - lo }, (_, i) => l.values![lo + i])),
    ] as [number[], ...number[][]];
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
