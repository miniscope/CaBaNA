import { createEffect, createMemo, type JSX } from 'solid-js';
import { cellPeaks, cropAround } from '../lib/footprint-zoom.ts';
import { NEIGHBOR_PX } from '../lib/cells.ts';
import { cell, footprints } from '../lib/store.ts';

/** The selected cell's footprint close up, brightness in grey, ringed in white. Display only. */
export function QcCellCrop(): JSX.Element {
  let canvas!: HTMLCanvasElement;
  const peaks = createMemo(() => {
    const f = footprints();
    return f ? cellPeaks(f) : undefined;
  });
  createEffect(() => {
    const f = footprints();
    const p = peaks();
    const c = cell();
    if (!f || !p || c >= f.cells) return;
    const crop = cropAround(f, c, p[c], NEIGHBOR_PX / 2);
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(crop.w, crop.h);
    const n = f.height * f.width;
    for (let y = 0; y < crop.h; y++)
      for (let x = 0; x < crop.w; x++) {
        const v = f.data[c * n + (crop.y0 + y) * f.width + crop.x0 + x] / (p[c] || 1);
        const g = Math.round(255 * Math.max(0, Math.min(1, v)));
        img.data.set([g, g, g, 255], 4 * (y * crop.w + x));
      }
    ctx.putImageData(img, 0, 0);
  });
  return (
    <canvas
      ref={canvas}
      class="cb-qp__crop"
      role="img"
      aria-label={`Footprint of cell ${cell() + 1}`}
    />
  );
}
