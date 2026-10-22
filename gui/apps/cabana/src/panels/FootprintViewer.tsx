import { createEffect, createMemo, type JSX } from 'solid-js';
import {
  cell,
  cellResult,
  cellScores,
  colorBy,
  footprints,
  overlapPartner,
  selectCell,
} from '../lib/store.ts';
import { FOOTPRINT_CUTOFF, normalizeFootprints } from '../lib/qc.ts';

// Hue per cell from the golden angle, so neighbors get different colors.
const rgb = (c: number): [number, number, number] => {
  const h = (c * 137.508) % 360;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (0.75 - 0.55 * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
};

const QUALITY = { good: [46, 160, 80], warn: [235, 170, 20], bad: [215, 50, 50] } as const;

/** All footprints in one image. Click a cell to select it. The selected cell is white and the cell it correlates with most is orange. */
export function FootprintViewer(): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const map = createMemo(() => {
    const f = footprints();
    if (!f) return undefined;
    const norm = normalizeFootprints(f);
    const px = f.height * f.width;
    const owner = new Int16Array(px).fill(-1);
    const value = new Float32Array(px);
    for (let c = 0; c < f.cells; c++)
      for (let i = 0; i < px; i++) {
        const v = norm[c * px + i];
        if (v > value[i] && v > FOOTPRINT_CUTOFF * 0.5) [owner[i], value[i]] = [c, v];
      }
    return { f, owner, value };
  });

  createEffect(() => {
    const m = map();
    if (!m || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { f, owner, value } = m;
    const sel = cell();
    const byQuality = colorBy() === 'quality';
    const scores = cellScores();
    // Highlighted cells: selected (white), most correlated (orange), overlapping partner (cyan).
    const marks = new Map<number, [number, number, number]>([
      [cellResult()?.partner[sel] ?? -1, [255, 150, 30]],
      [overlapPartner(), [60, 200, 255]],
      [sel, [255, 255, 255]],
    ]);
    canvas.width = f.width;
    canvas.height = f.height;
    const img = ctx.createImageData(f.width, f.height);
    for (let i = 0; i < owner.length; i++) {
      const c = owner[i];
      const mark = marks.get(c);
      const [r, g, b] =
        c < 0
          ? [20, 20, 24]
          : (mark ??
            (scores?.[c]?.rejected
              ? ([70, 70, 70] as const)
              : byQuality
                ? QUALITY[scores?.[c]?.overall ?? 'good']
                : rgb(c)));
      const k = c < 0 ? 1 : mark ? Math.max(0.5, value[i]) : 0.25 + 0.55 * value[i];
      img.data.set([r * k, g * k, b * k, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  });

  const pick = (e: MouseEvent) => {
    const m = map();
    if (!m || !canvas) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * m.f.width);
    const y = Math.floor(((e.clientY - box.top) / box.height) * m.f.height);
    const c = m.owner[y * m.f.width + x];
    if (c >= 0) selectCell(c);
  };

  return <canvas ref={canvas} class="cb-footprints" onClick={pick} aria-label="Cell footprints" />;
}
