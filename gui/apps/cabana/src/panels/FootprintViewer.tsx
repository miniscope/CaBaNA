import { createEffect, createMemo, Show, type JSX } from 'solid-js';
import {
  cell,
  cellResult,
  cellScores,
  colorBy,
  footprints,
  overlapPartner,
  rejected,
  selectCell,
} from '../lib/store.ts';
import { FOOTPRINT_CUTOFF, normalizeFootprints } from '../lib/qc.ts';
import { cellDrawn, cellVisibility, footprintShow } from '../lib/viz-display.ts';

/** Cells the Data visualization map marks: flagged ones and members of overlapping pairs. */
export interface MapMarks {
  flagged: () => ReadonlySet<number>;
  overlapping: () => ReadonlySet<number>;
}

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

/**
 * All footprints in one image. Click a cell to select it; the selected cell is white and drawn
 * whole on top of its neighbors. With `partners`, the neighbor it correlates with most is orange
 * and an overlapping partner picked from the QC list is cyan.
 */
export function FootprintViewer(props: { partners?: boolean; marks?: MapMarks }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let rings: HTMLCanvasElement | undefined;
  const map = createMemo(() => {
    const f = footprints();
    if (!f) return undefined;
    const norm = normalizeFootprints(f);
    const px = f.height * f.width;
    const owner = new Int16Array(px).fill(-1);
    const value = new Float32Array(px);
    // Weighted centers, where the rings go.
    const center = new Float32Array(f.cells * 2).fill(NaN);
    for (let c = 0; c < f.cells; c++) {
      let sum = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < px; i++) {
        const v = norm[c * px + i];
        if (v > value[i] && v > FOOTPRINT_CUTOFF * 0.5) [owner[i], value[i]] = [c, v];
        if (v > FOOTPRINT_CUTOFF) {
          sum += v;
          sx += v * (i % f.width);
          sy += v * Math.floor(i / f.width);
        }
      }
      if (sum > 0) [center[2 * c], center[2 * c + 1]] = [sx / sum, sy / sum];
    }
    return { f, norm, owner, value, center };
  });

  // Each pixel's cell as drawn: the brightest cell, except that the selected cell covers all of
  // its own pixels. Clicking a white pixel therefore keeps the selection.
  const shown = createMemo(() => {
    const m = map();
    if (!m) return undefined;
    const sel = cell();
    const px = m.owner.length;
    const owner = m.owner.slice();
    const value = m.value.slice();
    if (sel >= 0 && sel < m.f.cells)
      for (let i = 0; i < px; i++) {
        const v = m.norm[sel * px + i];
        if (v > FOOTPRINT_CUTOFF * 0.5) [owner[i], value[i]] = [sel, v];
      }
    // Cells left out of the view are not drawn; the selected cell always is.
    if (props.marks && cellVisibility() !== 'all') {
      const drawn = new Map<number, boolean>();
      for (let i = 0; i < px; i++) {
        const c = owner[i];
        if (c < 0) continue;
        if (!drawn.has(c))
          drawn.set(c, cellDrawn(c, cellVisibility(), rejected(), props.marks.flagged(), sel));
        if (!drawn.get(c)) owner[i] = -1;
      }
    }
    return { f: m.f, owner, value, center: m.center };
  });

  createEffect(() => {
    const m = shown();
    if (!m || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { f, owner, value } = m;
    const sel = cell();
    const byQuality = colorBy() === 'quality';
    const scores = cellScores();
    const marks = new Map<number, [number, number, number]>();
    if (props.partners) {
      marks.set(cellResult()?.partner[sel] ?? -1, [255, 150, 30]);
      marks.set(overlapPartner(), [60, 200, 255]);
    }
    if (!props.marks || footprintShow.selected) marks.set(sel, [255, 255, 255]);
    const outlines = !!props.marks && footprintShow.outlines;
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
      // An outline is the cell's edge at full brightness.
      const edge =
        outlines &&
        c >= 0 &&
        (owner[i - 1] !== c ||
          owner[i + 1] !== c ||
          owner[i - f.width] !== c ||
          owner[i + f.width] !== c);
      const k = c < 0 ? 1 : edge ? 1 : mark ? Math.max(0.5, value[i]) : 0.25 + 0.55 * value[i];
      img.data.set([r * k, g * k, b * k, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  });

  // Rings round flagged cells (amber) and overlapping pairs (cyan), at the canvas's own resolution.
  const RINGS = 512;
  createEffect(() => {
    const m = shown();
    const ctx = rings?.getContext('2d');
    if (!m || !rings || !ctx || !props.marks) return;
    ctx.clearRect(0, 0, RINGS, RINGS);
    const k = RINGS / m.f.width;
    const ring = (cells: ReadonlySet<number>, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (const c of cells) {
        const [x, y] = [m.center[2 * c], m.center[2 * c + 1]];
        if (!Number.isFinite(x) || m.owner[Math.round(y) * m.f.width + Math.round(x)] < 0) continue;
        ctx.beginPath();
        ctx.arc(x * k, y * k, 7, 0, 2 * Math.PI);
        ctx.stroke();
      }
    };
    if (footprintShow.overlap) ring(props.marks.overlapping(), '#00bcd4');
    if (footprintShow.flagged) ring(props.marks.flagged(), '#e09800');
  });

  const pick = (e: MouseEvent) => {
    const m = shown();
    if (!m || !canvas) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * m.f.width);
    const y = Math.floor(((e.clientY - box.top) / box.height) * m.f.height);
    const c = m.owner[y * m.f.width + x];
    if (c >= 0) selectCell(c);
  };

  const picture = (
    <canvas ref={canvas} class="cb-footprints" onClick={pick} aria-label="Cell footprints" />
  );
  return (
    <Show when={props.marks} fallback={picture}>
      <div class="cb-fpmap">
        {picture}
        <canvas
          ref={rings}
          class="cb-fpmap__rings"
          width={RINGS}
          height={RINGS}
          aria-hidden="true"
        />
      </div>
    </Show>
  );
}
