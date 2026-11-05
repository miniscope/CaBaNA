// What Spatial setup knows beyond the arena store: whether the real size was entered, which
// regions from config.yaml still need their placement checked, the chosen video frame, and the
// current stage. Builds the snapshot that lib/spatial-checks.ts grades.

import { createMemo, createRoot, createSignal } from 'solid-js';
import {
  arena,
  frame,
  pendingZones,
  positionsCm,
  pxPerCm,
  regionGroup,
  setArena,
  setFrame,
  sizeCm,
  toCm,
  type Zone,
} from './arena.ts';
import { arenaProblem, configReport } from './config-import.ts';
import { blankFrame } from './frame.ts';
import { regionNoticeProblem } from './region-notice.ts';
import { spatialChecks, type SpatialSnapshot, type Stage } from './spatial-checks.ts';
import { loaded, onClear, onConfig, source } from './store.ts';

/** The arena's real size was typed or read from config.yaml (the starting 40 x 40 cm does not count). */
export const [sizeEntered, setSizeEntered] = createSignal(false);
/** A region's name within its config group (zones, enclosures, dividers), where names are unique. */
export const regionKey = (z: { name: string; kind: Zone['kind']; shape: string }) =>
  `${regionGroup(z.kind, z.shape)}:${z.name}`;
/** Keys of regions from config.yaml whose placement has not been checked against the picture. */
export const [unverifiedZones, setUnverifiedZones] = createSignal<ReadonlySet<string>>(new Set());
/** The background frame chosen from a video: a time in seconds, or the empty-arena median. */
export const [videoChoice, setVideoChoice] = createSignal<{ t?: number; median?: boolean }>();
/** The stage shown; undefined follows the first stage with something left to do. */
export const [chosenStage, setChosenStage] = createSignal<Stage>();

onClear(() => {
  setSizeEntered(false);
  setUnverifiedZones(new Set<string>());
  setVideoChoice(undefined);
  setChosenStage(undefined);
});

// Registered after config-import's handler (imported above), so the report is read and applied.
// A config with a readable arena and positions in cm opens straight on a blank canvas with its
// outline and zones, so valid geometry is never drawn again. Positions in pixels need a picture
// from the tracking video instead, so those wait on the landing screen.
onConfig(() => {
  const v = configReport()?.values;
  if (v?.arena) setSizeEntered(true);
  if (v?.zones?.length) setUnverifiedZones(new Set(v.zones.map(regionKey)));
  if (v?.arena && !frame() && !arena.box && source.positionUnit === 'cm') startBlankCanvas();
});

/** Mark regions from the config as checked: all of them, or one by its key. */
export function verifyZones(key?: string): void {
  setUnverifiedZones((s) => (key ? new Set([...s].filter((k) => k !== key)) : new Set<string>()));
}

/**
 * Draw on a blank canvas: the arena fills it at the current size, so the outline is done and the
 * scale follows from the size. The same outline, scale and zone steps follow as for a picture.
 */
export function startBlankCanvas(): void {
  const [w, h] = sizeCm();
  const W = 720;
  const s = (W - 60) / w;
  setFrame(blankFrame(W, Math.round(h * s + 60)));
  setArena('scaleMode', 'arena');
  if (!arena.box) setArena('box', { x: 30, y: 30, w: w * s, h: h * s });
}

/** Share of finite tracked positions inside the arena (rectangle or circle, 2% slack). */
function insideShare(): number | undefined {
  const { x, y } = positionsCm();
  if (!x.length) return undefined;
  const [w, h] = sizeCm();
  const tol = 0.02 * Math.max(w, h);
  let n = 0;
  let inside = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i] + y[i])) continue;
    n++;
    const ok =
      arena.shape === 'circle'
        ? Math.hypot(x[i] - w / 2, y[i] - h / 2) <= w / 2 + tol
        : x[i] >= -tol && x[i] <= w + tol && y[i] >= -tol && y[i] <= h + tol;
    if (ok) inside++;
  }
  return n ? inside / n : undefined;
}

/** Regions with a point outside the arena's bounding box (2% slack). */
function regionsOutside(): number {
  const [w, h] = sizeCm();
  const tol = 0.02 * Math.max(w, h);
  return arena.zones.filter((z) =>
    z.pts.some((p) => {
      const c = toCm(p);
      return c && (c[0] < -tol || c[0] > w + tol || c[1] < -tol || c[1] > h + tol);
    }),
  ).length;
}

export const spatialSnapshot = createRoot(() =>
  createMemo<SpatialSnapshot>(() => {
    const f = frame();
    const b = arena.box;
    const placed = new Set(arena.zones.map(regionKey));
    return {
      frameKind: f?.kind,
      videoFrameChosen: !!videoChoice(),
      outline: !!b,
      shape: arena.shape,
      boxAspect: b && b.h ? b.w / b.h : undefined,
      scaleMode: arena.scaleMode,
      lineDrawn: !!arena.line,
      sizeEntered: sizeEntered(),
      sizeCm: sizeCm(),
      pxPerCm: pxPerCm(),
      positionUnit: source.positionUnit,
      positionsLoaded: !!loaded.position?.summary && !loaded.position.error,
      insideShare: insideShare(),
      zones: arena.zones.filter((z) => z.kind === 'zone').length,
      excluded: arena.zones.filter((z) => z.kind === 'exclude').length,
      pending: pendingZones()?.length ?? 0,
      unverified: [...unverifiedZones()].filter((n) => placed.has(n)).length,
      outside: regionsOutside(),
      problem: arenaProblem() ?? regionNoticeProblem(),
      bodyLength: arena.bodyLength,
    };
  }),
);

export const spatialCheckList = createRoot(() =>
  createMemo(() => spatialChecks(spatialSnapshot())),
);
