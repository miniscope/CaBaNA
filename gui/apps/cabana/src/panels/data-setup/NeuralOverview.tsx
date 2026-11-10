// Overview of a neural trace file on the Data setup page: a heatmap of every cell in this file,
// then the selected cell. The selected cell is the store's, shared with Footprints and the QC.

import { viridisRGB } from '@calab/ui/chart';
import { createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { NEURAL_LAYERS } from '../../lib/analysis-data.ts';
import { cellOrder, heatmapBins, type CellSort } from '../../lib/neural-heatmap.ts';
import type { Matrix } from '../../lib/parse.ts';
import type { SlotId } from '../../lib/slots.ts';
import {
  cell,
  cellResult,
  deconvolved,
  denoisedTrace,
  rawTrace,
  sessionDuration,
  selectCell,
} from '../../lib/store.ts';
import { SlotPreview } from '../Preview.tsx';
import { Help, PlotCard } from '../QcParts.tsx';

export const MATRIX: Partial<Record<SlotId, () => Matrix | undefined>> = {
  neural_raw: rawTrace,
  neural_denoised: denoisedTrace,
  neural_deconvolved: deconvolved,
};

const [sortBy, setSortBy] = createSignal<CellSort>('cell');

function HeatCanvas(props: { m: Matrix; peak: boolean; w: number; h: number }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  const snr = () => cellResult()?.snr;
  const order = createMemo(() => cellOrder(props.m.cells, sortBy(), snr()));
  const bins = createMemo(() => heatmapBins(props.m, Math.max(50, props.w), props.peak));
  const rowOf = (c: number) => order().indexOf(c);
  createEffect(() => {
    const b = bins();
    const n = b.length / props.m.cells;
    canvas.width = n;
    canvas.height = props.m.cells;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(n, props.m.cells);
    order().forEach((c, r) => {
      for (let i = 0; i < n; i++) {
        const [cr, cg, cb] = viridisRGB(b[c * n + i]);
        const k = 4 * (r * n + i);
        img.data.set([cr, cg, cb, 255], k);
      }
    });
    ctx.putImageData(img, 0, 0);
  });
  const rowH = () => props.h / props.m.cells;
  return (
    <div class="cb-ds-heat" style={{ height: `${props.h}px` }}>
      <canvas
        ref={canvas}
        class="cb-ds-heat__img"
        aria-label={`Heatmap of ${props.m.cells} cells`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const row = Math.floor(((e.clientY - r.top) / r.height) * props.m.cells);
          const c = order()[Math.min(props.m.cells - 1, Math.max(0, row))];
          if (c !== undefined) selectCell(c);
        }}
      />
      <div
        class="cb-ds-heat__sel"
        style={{ top: `${rowOf(cell()) * rowH()}px`, height: `${Math.max(2, rowH())}px` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** Every cell of one file over the whole session, one row per cell. */
export function LayerHeatmap(props: { slot: SlotId }): JSX.Element {
  const m = () => MATRIX[props.slot]?.();
  const label = () => NEURAL_LAYERS.find((l) => l.slot === props.slot)?.label ?? '';
  const peak = () => props.slot === 'neural_deconvolved';
  return (
    <PlotCard
      title={`All cells, ${label().toLowerCase()}`}
      class="cb-ds-heatcard"
      tools={
        <label class="cb-plot__tool">
          Sort by{' '}
          <select value={sortBy()} onChange={(e) => setSortBy(e.currentTarget.value as CellSort)}>
            <option value="cell">Cell number</option>
            <option value="snr" disabled={!cellResult()}>
              Signal to noise, highest first
            </option>
          </select>
        </label>
      }
      help={
        <>
          <Help k="What is plotted">
            One row per cell, over the whole session, for this file only. Each time bin is the mean
            of its frames{peak() ? ' (for events, the largest value, so single events show)' : ''}.
          </Help>
          <Help k="Axes">Time in seconds across; cells down, in the chosen order.</Help>
          <Help k="Colors">
            Each cell is scaled to its own range, from dark (its lowest bin) to yellow (its
            highest), so brightness cannot be compared between cells.
          </Help>
          <Help k="Linked">
            Click a row to select that cell; the selection is shared with the traces, the footprints
            and the QC. Signal to noise comes from the cell checks.
          </Help>
        </>
      }
    >
      {(s) => (
        <div class="cb-ds-heatwrap">
          <span class="cb-ds-heat__y">{m()?.cells ?? 0} cells</span>
          {m() && <HeatCanvas m={m()!} peak={peak()} w={s().w - 60} h={s().h - 18} />}
          <span class="cb-ds-heat__x">
            <span>0 s</span>
            <span>Time (s)</span>
            <span>{Math.round(sessionDuration() ?? 0)} s</span>
          </span>
        </div>
      )}
    </PlotCard>
  );
}

/** The overview of a neural trace file: the heatmap of every cell, then the selected cell. */
export function NeuralFileOverview(props: { slot: SlotId }): JSX.Element {
  return (
    <div class="cb-ds-neural">
      <LayerHeatmap slot={props.slot} />
      <SlotPreview slot={props.slot} />
    </div>
  );
}
