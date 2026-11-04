// Regions are drawn on the picture, so a new arena outline, a new scale or a new picture changes
// where they are in cm. When that happens with regions already drawn, the user chooses what they
// keep: their place in cm, their place on the picture, or nothing (redraw). Until then, analyses
// that use the arena are blocked.

import { batch, createEffect, createRoot, createSignal, on } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { arena, frame, setArena, setFrame, toCm, toPx, type Pt, type Zone } from './arena.ts';
import type { FrameSource } from './frame.ts';
import { onClear } from './store.ts';

/** Everything that decides where a picture point is in cm. */
interface Calibration {
  box: typeof arena.box;
  width: number;
  height: number;
  shape: typeof arena.shape;
  scaleMode: typeof arena.scaleMode;
  line: typeof arena.line;
  lineCm: number;
  frame: FrameSource | undefined;
}
const calibration = (): Calibration => ({
  box: arena.box && { ...arena.box },
  width: arena.width,
  height: arena.height,
  shape: arena.shape,
  scaleMode: arena.scaleMode,
  line: arena.line && [[...arena.line[0]], [...arena.line[1]]],
  lineCm: arena.lineCm,
  frame: frame(),
});
// A new frame of the same video (scrubbing) is not a new picture.
const frameKey = (f?: FrameSource) =>
  f && `${f.name}|${f.canvas.width}x${f.canvas.height}|${f.scale}`;
const keyOf = (c: Calibration) => JSON.stringify({ ...c, frame: frameKey(c.frame) });

export type ChangeKind = 'outline' | 'scale' | 'picture';

export interface RegionNotice {
  kind: ChangeKind;
  /** The calibration before the change, to undo it. */
  before: Calibration;
  /** The regions drawn before the change, in cm under the old calibration. */
  regionsCm: { zone: Zone; cm: Pt[] }[];
}

export const [regionNotice, setRegionNotice] = createSignal<RegionNotice>();
/** Regions as "Keep position in cm" would place them, shown while that choice is hovered. */
export const [previewRegions, setPreviewRegions] = createSignal<Zone[]>();

/** Why arena analyses are blocked by an open notice, or undefined. */
export const regionNoticeProblem = () =>
  regionNotice()
    ? 'Choose what happens to the regions drawn before the arena changed (Spatial setup).'
    : undefined;

/** The last calibration the regions were settled on, and the regions in cm under it. */
let settled: { key: string; cal: Calibration; regionsCm: RegionNotice['regionsCm'] } | undefined;
/** Set while a choice is being applied, so the change it makes does not open a new notice. */
let applying = false;

function settle(): void {
  const cal = calibration();
  // Without an outline and scale the regions have no cm coordinates, so nothing can move.
  const regionsCm = arena.zones.flatMap((zone) => {
    const cm = zone.pts.map((p) => toCm(p));
    return cm.every(Boolean) ? [{ zone, cm: cm as Pt[] }] : [];
  });
  settled = { key: keyOf(cal), cal, regionsCm };
}

function kindOf(a: Calibration, b: Calibration): ChangeKind {
  if (frameKey(a.frame) !== frameKey(b.frame)) return 'picture';
  if (JSON.stringify(a.box) !== JSON.stringify(b.box)) return 'outline';
  return 'scale';
}

createRoot(() => {
  createEffect(
    on(
      () => [keyOf(calibration()), JSON.stringify(arena.zones)],
      () => {
        if (applying || regionNotice()) return;
        const cal = calibration();
        const key = keyOf(cal);
        // Regions placed under the old calibration, which has changed: ask.
        if (settled && settled.key !== key && settled.regionsCm.length) {
          setRegionNotice({
            kind: kindOf(settled.cal, cal),
            before: settled.cal,
            regionsCm: settled.regionsCm,
          });
          return;
        }
        settle();
      },
    ),
  );
});

onClear(() => {
  setRegionNotice(undefined);
  setPreviewRegions(undefined);
  settled = undefined;
});

/** The old regions moved so they keep their cm coordinates, or undefined while the new calibration is incomplete. */
export function reprojected(n: RegionNotice): Zone[] | undefined {
  const moved = n.regionsCm.map(({ zone, cm }) => ({ ...zone, pts: cm.map((c) => toPx(c)) }));
  return moved.every((z) => z.pts.every(Boolean)) ? (moved as Zone[]) : undefined;
}

function finish(apply: () => void): void {
  applying = true;
  batch(() => {
    apply();
    setRegionNotice(undefined);
    setPreviewRegions(undefined);
  });
  applying = false;
  settle();
}

// Store setters see the raw objects, the notice keeps store proxies: compare the raw ones.
const isOld = (n: RegionNotice) => (z: Zone) =>
  n.regionsCm.some((r) => unwrap(r.zone) === unwrap(z));

/** Apply a change that keeps every region's place in cm, so there is nothing to ask. */
export const withoutNotice = (apply: () => void) => finish(apply);

/** Keep the regions' cm coordinates: they move with the new outline or scale, in the same order. */
export function keepInCm(): void {
  const n = regionNotice();
  const moved = n && reprojected(n);
  if (!n || !moved) return;
  finish(() =>
    setArena('zones', (zs) =>
      zs.map((z) => {
        const k = n.regionsCm.findIndex((r) => unwrap(r.zone) === unwrap(z));
        return k < 0 ? z : moved[k];
      }),
    ),
  );
}

/** Keep the regions where they were drawn on the picture. */
export const keepOnPicture = () => finish(() => undefined);

/** Delete the regions drawn before the change. */
export function removeRegions(): void {
  const n = regionNotice();
  if (n) finish(() => setArena('zones', (zs) => zs.filter((z) => !isOld(n)(z))));
}

/** Put the outline, scale and picture back as they were before the change. */
export function undoChange(): void {
  const n = regionNotice();
  if (!n) return;
  const { frame: f, ...rest } = n.before;
  finish(() => {
    setFrame(f);
    setArena(rest);
  });
}
