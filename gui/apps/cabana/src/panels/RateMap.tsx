import { createEffect, type JSX } from 'solid-js';
import { colorAt, placeDisplay } from '../lib/place-display.ts';

/**
 * A map over the arena, drawn to the arena's real proportions. Bins visited too briefly are grey,
 * space outside the arena is white. With `fields` the field outlines are drawn, and `centroid` marks
 * the center of the largest field.
 */
export function RateMap(props: {
  values: Float32Array;
  max: number;
  nx: number;
  ny: number;
  open: boolean[];
  /** Bin and arena size in cm. */
  bin: number;
  arenaCm: [number, number];
  fields?: Uint8Array;
  centroid?: [number, number];
  /** Pixels along the longer side. */
  size: number;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { nx, ny, values, max, fields, bin } = props;
    const [w, h] = props.arenaCm;
    const s = props.size / Math.max(w, h); // pixels per cm
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const at = (j: number, i: number) => j * nx + i; // j counts up from the bottom row
    const x0 = (i: number) => i * bin * s;
    const y0 = (j: number) => canvas!.height - (j + 1) * bin * s;
    const ok = (k: number) => props.open[k] && Number.isFinite(values[k]);
    const color = (v: number) => `rgb(${colorAt(max > 0 ? v / max : 0).join(',')})`;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!props.open[at(j, i)]) continue;
        ctx.fillStyle = ok(at(j, i)) ? color(values[at(j, i)]) : '#d4d4d0';
        ctx.fillRect(x0(i), y0(j), bin * s + 0.5, bin * s + 0.5);
      }
    if (placeDisplay.style === 'smooth') {
      // Interpolate between bin centers: draw the bins as a small image and scale it up smoothly.
      const small = document.createElement('canvas');
      small.width = nx;
      small.height = ny;
      const img = small.getContext('2d')!.createImageData(nx, ny);
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const k = at(j, i);
          if (!ok(k)) continue;
          const [r, g, b] = colorAt(max > 0 ? values[k] / max : 0);
          img.data.set([r, g, b, 255], 4 * ((ny - 1 - j) * nx + i));
        }
      small.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, canvas.height - ny * bin * s, nx * bin * s, ny * bin * s);
    }
    if (!fields) return;
    const edges = new Path2D();
    const other = (jj: number, ii: number) =>
      jj < 0 || jj >= ny || ii < 0 || ii >= nx ? 0 : fields[at(jj, ii)];
    const seg = (xa: number, ya: number, xb: number, yb: number) => {
      edges.moveTo(xa, ya);
      edges.lineTo(xb, yb);
    };
    const t = bin * s;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const f = fields[at(j, i)];
        if (!f) continue;
        const [x, y] = [x0(i), y0(j)];
        if (other(j + 1, i) !== f) seg(x, y, x + t, y);
        if (other(j - 1, i) !== f) seg(x, y + t, x + t, y + t);
        if (other(j, i - 1) !== f) seg(x, y, x, y + t);
        if (other(j, i + 1) !== f) seg(x + t, y, x + t, y + t);
      }
    ctx.lineWidth = 3.5; // dark under-stroke keeps the white line visible on bright bins
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke(edges);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = '#fff';
    ctx.stroke(edges);
    if (props.centroid) {
      const cx = props.centroid[0] * t;
      const cy = canvas.height - props.centroid[1] * t;
      const cross = new Path2D();
      cross.moveTo(cx - 5, cy);
      cross.lineTo(cx + 5, cy);
      cross.moveTo(cx, cy - 5);
      cross.lineTo(cx, cy + 5);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke(cross);
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = '#fff';
      ctx.stroke(cross);
    }
  });
  return (
    <canvas
      ref={canvas}
      class="cb-map cb-map--fluid"
      style={{
        'aspect-ratio': `${props.arenaCm[0]} / ${props.arenaCm[1]}`,
        'max-width': `${props.size}px`,
      }}
    />
  );
}
