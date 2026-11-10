// The arena: its outline, scale, zones, bins and the animal's size. Geometry is
// kept in pixels of the arena picture and converted to cm (origin at the arena's
// lower left corner, y up) when it is used or saved.

import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { FrameSource } from './frame.ts';
import type { CmZone } from './config-read.ts';
import { UNCALIBRATED } from './spec/pipeline.ts';
import {
  zoneOccupancy,
  zoneOrder,
  zoneShape,
  zoneShares,
  type ZoneShape,
} from './zone-occupancy.ts';
import { cameraFps, onClear, positionResult, setPositionScale, source } from './store.ts';

export type Pt = [number, number];
export interface Zone {
  name: string;
  /** A place the analyses care about, or a region the animal cannot enter (walls, enclosures). */
  kind: 'zone' | 'exclude';
  shape: 'rect' | 'circle' | 'polygon';
  /** rect: two corners. circle: centre then a point on the edge. polygon: the corners. */
  pts: Pt[];
}

export const [frame, setFrame] = createSignal<FrameSource | undefined>();
/** Goes up when the picture changes without a new FrameSource (a new video frame). */
export const [frameVersion, bumpFrame] = createSignal(0);

export const [arena, setArena] = createStore({
  shape: 'rectangle' as 'rectangle' | 'circle',
  width: 40,
  height: 40,
  /** The arena's bounding box in picture pixels. */
  box: undefined as { x: number; y: number; w: number; h: number } | undefined,
  scaleMode: 'arena' as 'arena' | 'distance',
  line: undefined as [Pt, Pt] | undefined,
  lineCm: 10,
  zones: [] as Zone[],
  bodyLine: undefined as [Pt, Pt] | undefined,
  bodyLength: undefined as number | undefined,
  binCm: undefined as number | undefined,
  minOccupancy: 0.05,
  headOffset: 0,
});

onClear(() => {
  setFrame(undefined);
  setArena({
    shape: 'rectangle',
    width: 40,
    height: 40,
    box: undefined,
    scaleMode: 'arena',
    line: undefined,
    lineCm: 10,
    zones: [],
    bodyLine: undefined,
    bodyLength: undefined,
    binCm: undefined,
    minOccupancy: 0.05,
    headOffset: 0,
  });
});

/** The arena's real size was typed or read from config.yaml; the starting 40 x 40 cm is not a scale. */
export const [sizeEntered, setSizeEntered] = createSignal(false);
onClear(() => setSizeEntered(false));

/** Zones from a config.yaml, in cm, waiting for the arena outline so they can be put on the picture. */
export const [pendingZones, setPendingZones] = createSignal<CmZone[]>();

/** The config list a region is written to. Names must be unique within it, as YAML keys are. */
export function regionGroup(kind: Zone['kind'], shape: string): 'zone' | 'enclosure' | 'divider' {
  if (kind === 'zone') return 'zone';
  return shape === 'circle' ? 'enclosure' : 'divider';
}
/** A region of this kind and shape already has the name. */
export const nameTaken = (name: string, kind: Zone['kind'], shape: string) =>
  [...arena.zones, ...(pendingZones() ?? [])].some(
    (z) => z.name === name && regionGroup(z.kind, z.shape) === regionGroup(kind, shape),
  );
/** A name for a new region that no region of its group has. */
export function freeName(kind: Zone['kind'], shape: string): string {
  const stem = kind === 'exclude' ? 'excluded' : 'zone';
  let n = 1;
  while (nameTaken(`${stem} ${n}`, kind, shape)) n++;
  return `${stem} ${n}`;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Picture pixels per cm. */
export const pxPerCm = createMemo(() => {
  if (arena.scaleMode === 'distance')
    return arena.line ? dist(arena.line[0], arena.line[1]) / arena.lineCm : undefined;
  return arena.box ? arena.box.w / arena.width : undefined;
});

/** Arena size in cm, as typed, or measured from the picture when the scale comes from a known distance. */
export const sizeCm = createMemo<[number, number]>(() => {
  const s = pxPerCm();
  if (arena.scaleMode === 'distance' && arena.box && s)
    return [arena.box.w / s, arena.shape === 'circle' ? arena.box.w / s : arena.box.h / s];
  return [arena.width, arena.shape === 'circle' ? arena.width : arena.height];
});

/**
 * Why the outline cannot set the scale, or undefined. Only once an outline exists: without one
 * nothing on the picture is converted, and positions in cm need no scale.
 */
export const scaleIssue = createMemo(() => {
  if (!arena.box) return undefined;
  if (arena.scaleMode === 'distance')
    return arena.line
      ? undefined
      : 'The arena outline is complete, but the known distance has not been drawn. Spatial analyses stay unavailable until it is (Spatial setup, Scale).';
  return sizeEntered()
    ? undefined
    : "The arena outline is complete, but the arena's real size has not been entered. Spatial analyses stay unavailable until it is (Spatial setup, Scale).";
});

/** Positions in video pixels cannot be put in cm with an outline drawn on a blank canvas. */
export const blankPixelIssue = () =>
  source.positionUnit === 'px' && frame()?.kind === 'blank'
    ? 'Positions are in video pixels, but the arena outline is on a blank canvas, which has no video pixels. Spatial analyses stay unavailable until the outline is drawn on a frame from the tracking video (Spatial setup), or the position file is in cm.'
    : undefined;

export const toCm = (p: Pt): Pt | undefined => {
  const s = pxPerCm();
  const b = arena.box;
  return s && b ? [(p[0] - b.x) / s, (b.y + b.h - p[1]) / s] : undefined;
};
export const toPx = (c: Pt): Pt | undefined => {
  const s = pxPerCm();
  const b = arena.box;
  return s && b ? [b.x + c[0] * s, b.y + b.h - c[1] * s] : undefined;
};

// Placed after toPx and pxPerCm, which the effect reads as soon as it is created.
onClear(() => setPendingZones(undefined));
createRoot(() =>
  createEffect(() => {
    const z = pendingZones();
    if (!z || !pxPerCm() || !arena.box) return;
    setArena('zones', [
      ...arena.zones.filter((a) => !z.some((b) => b.name === a.name)),
      ...z.map((c) => ({ ...c, pts: c.pts.map((p) => toPx(p)!) })),
    ]);
    setPendingZones(undefined);
  }),
);

function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Is a picture point inside a zone? */
export function inZone(p: Pt, z: Zone): boolean {
  if (z.shape === 'rect') {
    const [a, b] = z.pts;
    return (
      p[0] >= Math.min(a[0], b[0]) &&
      p[0] <= Math.max(a[0], b[0]) &&
      p[1] >= Math.min(a[1], b[1]) &&
      p[1] <= Math.max(a[1], b[1])
    );
  }
  if (z.shape === 'circle') return dist(p, z.pts[0]) <= dist(z.pts[0], z.pts[1]);
  return inPolygon(p, z.pts);
}

export interface BinGrid {
  nx: number;
  ny: number;
  bin: number;
  /** Bins the animal can be in: inside the arena and outside excluded regions. */
  open: boolean[];
}

export function binGrid(bin: number): BinGrid | undefined {
  const [w, h] = sizeCm();
  if (!(bin > 0)) return undefined;
  const nx = Math.ceil(w / bin);
  const ny = Math.ceil(h / bin);
  const open: boolean[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c: Pt = [(i + 0.5) * bin, (j + 0.5) * bin];
      let ok = c[0] <= w && c[1] <= h;
      if (ok && arena.shape === 'circle') ok = Math.hypot(c[0] - w / 2, c[1] - h / 2) <= w / 2;
      const px = toPx(c);
      if (ok && px) ok = !arena.zones.some((z) => z.kind === 'exclude' && inZone(px, z));
      open.push(ok);
    }
  return { nx, ny, bin, open };
}

/**
 * The one map from the position file's units to cm in the arena's frame (origin at the arena's
 * lower left, y up): x_cm = sx * x + tx, y_cm = sy * y + ty. QC, previews, speed, export and every
 * analysis use it. Undefined for pixel positions without a calibration: there is no default scale.
 */
export interface PositionTransform {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export const positionTransform = createMemo<PositionTransform | undefined>(() => {
  if (source.positionUnit === 'cm')
    return source.yDown
      ? { sx: 1, sy: -1, tx: 0, ty: sizeCm()[1] }
      : { sx: 1, sy: 1, tx: 0, ty: 0 };
  const s = pxPerCm();
  const b = arena.box;
  if (!s || !b || scaleIssue() || blankPixelIssue()) return undefined;
  const k = frame()?.scale ?? 1; // position pixels refer to the original video, the picture may be smaller
  return { sx: 1 / (k * s), sy: -1 / (k * s), tx: -b.x / s, ty: (b.y + b.h) / s };
});

/** Why positions cannot be put in cm, or undefined when they can. */
export const calibrationIssue = () =>
  positionTransform() ? undefined : (blankPixelIssue() ?? scaleIssue() ?? UNCALIBRATED);

/** Position-file units per cm (1 for cm). A memo, so position QC reruns only when the scale changes. */
export const positionUnitsPerCm = createMemo(() => {
  const t = positionTransform();
  return t && 1 / Math.abs(t.sx);
});
// The store's position QC needs the scale, but the store cannot import this module (it imports the store).
// The memo itself is handed over and read inside the store's memo, so it stays tracked.
// eslint-disable-next-line solid/reactivity
setPositionScale(positionUnitsPerCm);

/** The animal's tracked positions in cm, in the arena's frame. Empty when they cannot be placed. */
export const positionsCm = createMemo<{ x: number[]; y: number[] }>(() => {
  const p = positionResult();
  const t = positionTransform();
  if (!p || !('x' in p) || !t) return { x: [], y: [] };
  return { x: p.x.map((v) => t.sx * v + t.tx), y: p.y.map((v) => t.sy * v + t.ty) };
});

/** Seconds spent in each bin. */
export function occupancy(grid: BinGrid): Float64Array {
  const occ = new Float64Array(grid.nx * grid.ny);
  const { x, y } = positionsCm();
  const dt = 1 / cameraFps();
  for (let n = 0; n < x.length; n++) {
    if (!Number.isFinite(x[n] + y[n])) continue;
    const i = Math.floor(x[n] / grid.bin);
    const j = Math.floor(y[n] / grid.bin);
    if (i >= 0 && i < grid.nx && j >= 0 && j < grid.ny) occ[j * grid.nx + i] += dt;
  }
  return occ;
}

/** Bin size used until one is chosen. A starting value only: it depends on the arena, animal and frame rate. */
export const DEFAULT_BIN_CM = 3;
export const effectiveBin = () => arena.binCm ?? DEFAULT_BIN_CM;
/** Set the bin size: at least 0.5 cm, at most half the smaller arena side. */
export function setBinCm(v: number): void {
  if (Number.isFinite(v)) setArena('binCm', Math.min(Math.min(...sizeCm()) / 2, Math.max(0.5, v)));
}

const r = (v: number) => Math.round(v * 100) / 100;
export const cmPts = (z: Zone) => z.pts.map((p) => toCm(p)!.map(r));

export function arenaSummary(): string {
  const [w, h] = sizeCm();
  return `${arena.shape}, ${arena.shape === 'circle' ? `${r(w)} cm across` : `${r(w)} x ${r(h)} cm`}, ${arena.zones.length} zones, ${effectiveBin()} cm bins`;
}

/**
 * For each zone (not excluded regions): percent of the tracked frames the animal spent inside, and
 * the seconds. A frame in overlapping zones counts for the first zone, as the framework's
 * `zone_occupancy` decides (zone-occupancy.ts); zones are compared in cm as config.yaml writes them.
 */
export const zoneShare = createMemo<
  { name: string; pct: number; seconds: number; index: number }[]
>(() => {
  const pos = positionsCm();
  if (!pos.x.length || !pxPerCm() || !arena.box) return [];
  const listed = arena.zones.map((z, index) => ({ z, index })).filter(({ z }) => z.kind === 'zone');
  const shapes = listed.map(({ z }): [string, ZoneShape] => [
    z.name,
    zoneShape({ shape: z.shape, pts: cmPts(z) }),
  ]);
  const occ = zoneOccupancy(pos.x, pos.y, shapes);
  const names = zoneOrder(shapes).map(([n]) => n);
  const share = zoneShares(occ, shapes.length);
  const dt = 1 / cameraFps();
  const tracked = occ.filter((k) => k !== -2).length;
  return listed.map(({ z, index }) => {
    const k = names.indexOf(z.name);
    return {
      name: z.name,
      pct: 100 * share.zones[k],
      seconds: share.zones[k] * tracked * dt,
      index,
    };
  });
});

/** How many bins the arena has at the chosen size, and how long the animal spent in them. */
export const binStats = createMemo(() => {
  const g = pxPerCm() && arena.box ? binGrid(effectiveBin()) : undefined;
  if (!g) return undefined;
  const base: { n: number; open: number; median?: number; underPct?: number } = {
    n: g.nx * g.ny,
    open: g.open.filter(Boolean).length,
  };
  if (!positionsCm().x.length) return base;
  const times = [...occupancy(g)].filter((_, i) => g.open[i]).sort((p, q) => p - q);
  const under = times.filter((v) => v < arena.minOccupancy).length;
  base.median = times[Math.floor(0.5 * (times.length - 1))] ?? 0;
  base.underPct = (100 * under) / Math.max(times.length, 1);
  return base;
});
