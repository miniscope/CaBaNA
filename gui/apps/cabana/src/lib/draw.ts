// Canvas shapes shared by Experimental Setup and Data visualization.

import type { Pt, Zone } from './arena.ts';

export function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], close = true): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  if (close) ctx.closePath();
}

/** The outline of a rectangle, circle or polygon given as in a Zone. */
export function shapePath(ctx: CanvasRenderingContext2D, z: { shape: string; pts: Pt[] }): void {
  if (z.shape === 'rect') {
    const [a, d] = z.pts;
    ctx.beginPath();
    ctx.rect(
      Math.min(a[0], d[0]),
      Math.min(a[1], d[1]),
      Math.abs(d[0] - a[0]),
      Math.abs(d[1] - a[1]),
    );
  } else if (z.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(
      z.pts[0][0],
      z.pts[0][1],
      Math.hypot(z.pts[0][0] - z.pts[1][0], z.pts[0][1] - z.pts[1][1]),
      0,
      2 * Math.PI,
    );
  } else tracePath(ctx, z.pts);
}

export function arenaOutline(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number } | undefined,
  shape: 'rectangle' | 'circle',
): void {
  ctx.beginPath();
  if (!box) return;
  if (shape === 'circle')
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, 2 * Math.PI);
  else ctx.rect(box.x, box.y, box.w, box.h);
}

export const ZONE_COLORS = ['#2171b5', '#e09800', '#2e7d32', '#8e44ad', '#16a085', '#c0392b'];

/** Zones, drawn as in Experimental Setup: colored by position in the list, excluded regions dashed red. */
export function drawZones(
  ctx: CanvasRenderingContext2D,
  zones: Zone[],
  lineWidth: number,
  fontPx: number,
): void {
  zones.forEach((z, i) => {
    shapePath(ctx, z);
    const col = z.kind === 'exclude' ? '#d32f2f' : ZONE_COLORS[i % ZONE_COLORS.length];
    ctx.fillStyle = col + '33';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(z.kind === 'exclude' ? [8, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.font = `${fontPx}px sans-serif`;
    ctx.fillText(z.name, z.pts[0][0] + 4, z.pts[0][1] - 4);
  });
}

type Box = { x: number; y: number; w: number; h: number };

/** The outline's corners, clockwise from the top left. */
export const boxCorners = (b: Box): Pt[] => [
  [b.x, b.y],
  [b.x + b.w, b.y],
  [b.x + b.w, b.y + b.h],
  [b.x, b.y + b.h],
];

/**
 * The outline after a drag from `from` to `p`: moved, or with one corner (index into boxCorners)
 * dragged while the opposite corner stays. A circle's outline stays square.
 */
export function adjustBox(b: Box, what: 'move' | number, from: Pt, p: Pt, square: boolean): Box {
  if (what === 'move') return { ...b, x: b.x + p[0] - from[0], y: b.y + p[1] - from[1] };
  const fixed = boxCorners(b)[(what + 2) % 4];
  let w = Math.max(4, Math.abs(p[0] - fixed[0]));
  let h = Math.max(4, Math.abs(p[1] - fixed[1]));
  if (square) w = h = Math.max(w, h);
  return {
    x: p[0] < fixed[0] ? fixed[0] - w : fixed[0],
    y: p[1] < fixed[1] ? fixed[1] - h : fixed[1],
    w,
    h,
  };
}
