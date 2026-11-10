import { createMemo, For, Show, type JSX } from 'solid-js';
import { TracePanel } from '@calab/ui/chart';
import {
  cell,
  deconvolved,
  denoisedTrace,
  frameTimes,
  rawTrace,
  samplingRate,
} from '../lib/store.ts';

/**
 * The selected cell's raw, denoised and deconvolved traces, one labeled panel each (`height` per
 * panel). `mark` bolds the label of one of them; with `highlight` that one is also drawn in blue
 * and the others in gray.
 */
export function CellTraces(props: {
  height?: number;
  mark?: string;
  highlight?: boolean;
}): JSX.Element {
  const frames = () => (rawTrace() ?? denoisedTrace() ?? deconvolved())?.frames ?? 0;
  const t = createMemo(
    () =>
      frameTimes()?.slice(0, frames()) ??
      Array.from({ length: frames() }, (_, i) => i / (samplingRate() ?? 30)),
  );
  const row = (m: ReturnType<typeof rawTrace>) =>
    m ? Array.from(m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames)) : undefined;
  const panels = () => [
    {
      label: 'Raw fluorescence',
      stroke: '#8a97a8',
      v: row(rawTrace()),
    },
    {
      label: 'Denoised trace',
      stroke: '#2171b5',
      v: row(denoisedTrace()),
    },
    {
      label: 'Deconvolved events',
      stroke: '#e09800',
      v: row(deconvolved()),
    },
  ];
  const stroke = (p: { label: string; stroke: string }) =>
    !props.highlight ? p.stroke : p.label === props.mark ? '#2171b5' : '#9aa4b1';
  return (
    <For each={panels()}>
      {(p) => (
        <Show when={p.v}>
          <div class="cb-label" classList={{ 'cb-label--on': props.mark === p.label }}>
            <i style={{ background: stroke(p) }} />
            {p.label}
          </div>
          <TracePanel
            data={() => [t(), p.v!] as [number[], ...number[][]]}
            series={[{}, { label: p.label, stroke: stroke(p), width: 1 }]}
            height={props.height ?? 110}
            syncKey="cabana-cell"
            xLabel="Time (s)"
          />
        </Show>
      )}
    </For>
  );
}
