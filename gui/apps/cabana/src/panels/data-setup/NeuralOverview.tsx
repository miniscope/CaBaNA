// Overview of a neural trace file on the Data setup page: a heatmap of every cell in this file,
// then the selected cell in every layer beside its footprint, close up. The selected cell is the store's, shared with Footprints and the QC.

import { viridisRGB } from '@calab/ui/chart';
import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js';
import { NEURAL_LAYERS } from '../../lib/analysis-data.ts';
import { NEIGHBOR_PX } from '../../lib/cells.ts';
import { cellPeaks, cropAround, inMask, MASK } from '../../lib/footprint-zoom.ts';
import { cellOrder, heatmapBins, type CellSort } from '../../lib/neural-heatmap.ts';
import type { Matrix } from '../../lib/parse.ts';
import type { SlotId } from '../../lib/slots.ts';
import {
  cell,
  cellResult,
  deconvolved,
  denoisedTrace,
  footprints,
  rawTrace,
  sessionDuration,
  selectCell,
} from '../../lib/store.ts';
import { CellTraces } from '../CellTraces.tsx';
import { CellPicker } from '../parts.tsx';
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
      <div class="cb-ds-neural__cell">
        <SelectedCell slot={props.slot} />
        <FootprintZoom />
      </div>
    </div>
  );
}

const MARK: Partial<Record<SlotId, string>> = {
  neural_raw: 'Raw fluorescence',
  neural_denoised: 'Denoised trace',
  neural_deconvolved: 'Deconvolved events',
};

/** The selected cell in every loaded layer, this file's layer in blue and the others in gray. */
export function SelectedCell(props: { slot: SlotId }): JSX.Element {
  const n = () => (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? 0;
  const layers = () => [rawTrace(), denoisedTrace(), deconvolved()].filter(Boolean).length || 1;
  return (
    <PlotCard
      title={`Cell ${cell() + 1}, all loaded layers`}
      tools={<CellPicker n={n()} compact />}
      help={
        <>
          <Help k="What is plotted">
            The selected cell in each loaded neural file: raw fluorescence, the denoised trace and
            the deconvolved events. This file is drawn in blue, the others in gray.
          </Help>
          <Help k="Axes">
            Time in seconds; each panel has its own vertical scale, in the file's own units.
          </Help>
          <Help k="Linked">
            The panels share zoom and cursor: drag to zoom. Pick a cell here, in the heatmap or on
            the footprints.
          </Help>
          <Help k="Limits">Heights cannot be compared between panels.</Help>
        </>
      }
    >
      {(s) => (
        // In a short window each panel keeps a readable height and the card scrolls.
        <div class="cb-plot__scroll" style={{ height: `${s().h}px` }}>
          <CellTraces
            mark={MARK[props.slot]}
            highlight
            height={Math.max(70, Math.floor((s().h - 26 * layers()) / layers()))}
          />
        </div>
      )}
    </PlotCard>
  );
}

/** The selected cell's footprint, close up, with the outlines of the cells around it. */
export function FootprintZoom(): JSX.Element {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  const peaks = createMemo(() => {
    const f = footprints();
    return f ? cellPeaks(f) : undefined;
  });
  const view = createMemo(() => {
    const f = footprints();
    const p = peaks();
    if (!f || !p || cell() >= f.cells) return undefined;
    const crop = cropAround(f, cell(), p[cell()], NEIGHBOR_PX);
    const near: number[] = [];
    for (let c = 0; c < f.cells; c++) {
      if (c === cell()) continue;
      search: for (let y = crop.y0; y < crop.y0 + crop.h; y++)
        for (let x = crop.x0; x < crop.x0 + crop.w; x++)
          if (inMask(f, c, p[c], x, y)) {
            near.push(c);
            break search;
          }
    }
    return { f, p, crop, near };
  });
  createEffect(() => {
    const v = view();
    const el = canvas();
    if (!v || !el) return;
    const { f, p, crop } = v;
    el.width = crop.w;
    el.height = crop.h;
    const ctx = el.getContext('2d')!;
    const img = ctx.createImageData(crop.w, crop.h);
    const n = f.height * f.width;
    const edge = (c: number, x: number, y: number) =>
      inMask(f, c, p[c], x, y) &&
      [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(
        ([a, b]) =>
          a < crop.x0 ||
          b < crop.y0 ||
          a >= crop.x0 + crop.w ||
          b >= crop.y0 + crop.h ||
          !inMask(f, c, p[c], a, b),
      );
    for (let y = 0; y < crop.h; y++)
      for (let x = 0; x < crop.w; x++) {
        const [gx, gy] = [crop.x0 + x, crop.y0 + y];
        const g = Math.round(
          255 * Math.max(0, f.data[cell() * n + gy * f.width + gx] / (p[cell()] || 1)),
        );
        let rgb = [g, g, g];
        if (v.near.some((c) => edge(c, gx, gy))) rgb = [232, 89, 12];
        if (edge(cell(), gx, gy)) rgb = [33, 113, 181];
        img.data.set([...rgb, 255], 4 * (y * crop.w + x));
      }
    ctx.putImageData(img, 0, 0);
  });
  const pick = (e: MouseEvent) => {
    const v = view();
    const el = e.currentTarget as HTMLCanvasElement;
    if (!v) return;
    const r = el.getBoundingClientRect();
    const x = v.crop.x0 + Math.floor(((e.clientX - r.left) / r.width) * v.crop.w);
    const y = v.crop.y0 + Math.floor(((e.clientY - r.top) / r.height) * v.crop.h);
    const hit = v.near.find((c) => inMask(v.f, c, v.p[c], x, y));
    if (hit !== undefined) selectCell(hit);
  };
  return (
    <PlotCard
      title="Footprint"
      class="cb-ds-fpzoom"
      help={
        <>
          <Help k="What is plotted">
            The selected cell's footprint, close up, in gray from dark (none) to white (its
            brightest pixel). Blue outlines it; orange outlines the other cells in this window.
          </Help>
          <Help k="Axes">Footprint pixels; the window reaches {NEIGHBOR_PX} px past the cell.</Help>
          <Help k="Linked">Click inside an orange outline to select that cell.</Help>
          <Help k="Limits">
            An outline is where a footprint is at least {Math.round(MASK * 100)}% of its own
            brightest pixel. The full map is under Footprints.
          </Help>
        </>
      }
    >
      {() => (
        <Show
          when={view()}
          fallback={
            <p class="cb-muted">Load footprints to see this cell's footprint and its neighbors.</p>
          }
        >
          {(v) => (
            <div class="cb-ds-fpzoom__box">
              <canvas ref={setCanvas} class="cb-ds-fpzoom__img" onClick={pick} />
              <span class="cb-muted">
                Cell {cell() + 1} and {v().near.length} nearby · {v().crop.w} × {v().crop.h} px
              </span>
            </div>
          )}
        </Show>
      )}
    </PlotCard>
  );
}
