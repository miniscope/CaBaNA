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
 * panel). `mark` bolds the label of one of them.
 */
export function CellTraces(props: { height?: number; mark?: string }): JSX.Element {
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
  return (
    <For each={panels()}>
      {(p) => (
        <Show when={p.v}>
          <div class="cb-label" classList={{ 'cb-label--on': props.mark === p.label }}>
            <i style={{ background: p.stroke }} />
            {p.label}
          </div>
          <TracePanel
            data={() => [t(), p.v!] as [number[], ...number[][]]}
            series={[{}, { label: p.label, stroke: p.stroke, width: 1 }]}
            height={props.height ?? 110}
            syncKey="cabana-cell"
            xLabel="Time (s)"
          />
        </Show>
      )}
    </For>
  );
}
