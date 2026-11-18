// Shape arithmetic for the arena editor: moving and resizing regions, their size in cm, the scale
// from a drawn line. Points are picture pixels unless a name says cm.

import type { Pt, Zone } from './arena.ts';

type Shape = Pick<Zone, 'shape' | 'pts'>;
type Box = { x: number; y: number; w: number; h: number };

/** Pixels per cm from a line drawn over a known distance; undefined until both are positive. */
export function scaleFromLine(line: [Pt, Pt] | undefined, distanceCm: number): number | undefined {
  if (!line || !(distanceCm > 0)) return undefined;
  const px = Math.hypot(line[0][0] - line[1][0], line[0][1] - line[1][1]);
  return px > 0 ? px / distanceCm : undefined;
}

/** A distance typed in mm or cm, in cm. */
export const toCmFrom = (value: number, unit: 'cm' | 'mm'): number =>
  unit === 'mm' ? value / 10 : value;

/** The region shifted by (dx, dy). */
export const moveRegion = (z: Shape, dx: number, dy: number): Pt[] =>
  z.pts.map((p) => [p[0] + dx, p[1] + dy] as Pt);

/** The bounding box of a region. */
export function regionBox(z: Shape): Box {
  if (z.shape === 'circle') {
    const r = Math.hypot(z.pts[0][0] - z.pts[1][0], z.pts[0][1] - z.pts[1][1]);
    return { x: z.pts[0][0] - r, y: z.pts[0][1] - r, w: 2 * r, h: 2 * r };
  }
  const xs = z.pts.map((p) => p[0]);
  const ys = z.pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The region with one handle dragged to p. A rectangle's handle is a corner (0 to 3 clockwise from
 * the top left) and the opposite corner stays; a circle's is the point on its edge. Polygons only move.
 */
export function resizeRegion(z: Shape, handle: number, p: Pt): Pt[] {
  if (z.shape === 'circle') return [z.pts[0], p];
  if (z.shape !== 'rect') return z.pts;
  const b = regionBox(z);
  const corners: Pt[] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const fixed = corners[(handle + 2) % 4];
  return [fixed, p];
}

/** The handles a region offers for resizing, as points. */
export function regionHandles(z: Shape): Pt[] {
  if (z.shape === 'circle') return [z.pts[1]];
  if (z.shape !== 'rect') return [];
  const b = regionBox(z);
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

/** Size and area of a region from its corners in cm, as the pop-over writes them. */
export function regionSizeText(shape: string, cm: Pt[]): string {
  const f = (v: number) => v.toFixed(1);
  if (shape === 'circle') {
    const r = Math.hypot(cm[0][0] - cm[1][0], cm[0][1] - cm[1][1]);
    return `diameter ${f(2 * r)} cm · ${f(Math.PI * r * r)} cm²`;
  }
  if (shape === 'rect') {
    const w = Math.abs(cm[0][0] - cm[1][0]);
    const h = Math.abs(cm[0][1] - cm[1][1]);
    return `${f(w)} × ${f(h)} cm · ${f(w * h)} cm²`;
  }
  const xs = cm.map((p) => p[0]);
  const ys = cm.map((p) => p[1]);
  let area = 0;
  cm.forEach((p, i) => {
    const q = cm[(i + 1) % cm.length];
    area += p[0] * q[1] - q[0] * p[1];
  });
  return `${f(Math.max(...xs) - Math.min(...xs))} × ${f(Math.max(...ys) - Math.min(...ys))} cm · ${f(Math.abs(area) / 2)} cm²`;
}

/** A name for a copy of a region that is not taken, such as "left copy" then "left copy 2". */
export function copyName(name: string, taken: (n: string) => boolean): string {
  let n = `${name} copy`;
  for (let k = 2; taken(n); k++) n = `${name} copy ${k}`;
  return n;
}
