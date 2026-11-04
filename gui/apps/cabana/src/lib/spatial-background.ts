// The picture Spatial setup draws on. An image, a video or a blank canvas all end in the same
// place: a FrameSource behind the outline, scale and zones. Replacing it keeps the geometry.

import { createSignal } from 'solid-js';
import {
  arena,
  bumpFrame,
  frame,
  pendingZones,
  setArena,
  setFrame,
  setPendingZones,
  toCm,
  type Pt,
} from './arena.ts';
import { configReport } from './config-import.ts';
import { backgroundFrame, loadFrameFile, seekVideo, type FrameSource } from './frame.ts';
import { withoutNotice } from './region-notice.ts';
import {
  setChosenStage,
  setSizeEntered,
  setVideoChoice,
  sizeEntered,
  startBlankCanvas,
  videoChoice,
} from './spatial-state.ts';
import { onClear } from './store.ts';

export const [busy, setBusy] = createSignal('');
export const [loadError, setLoadError] = createSignal('');
/** Size of the picture the outline was drawn on, when a new picture of another size replaced it. */
export const [replacedSize, setReplacedSize] = createSignal<[number, number]>();
/** The video time shown while choosing a frame. */
export const [scrubT, setScrubT] = createSignal(0);

onClear(() => {
  setBusy('');
  setLoadError('');
  setReplacedSize(undefined);
  setScrubT(0);
});

/**
 * Load an image or video (told apart by type and extension) as the background. On a picture the
 * outline, scale line and regions stay where they are; region-notice asks what to do with regions
 * when the picture changes. A video opens the frame stage; an image goes straight to the outline.
 */
export async function loadBackground(file: File | undefined): Promise<void> {
  if (!file) return;
  setLoadError('');
  setBusy('Loading…');
  try {
    await setBackground(await loadFrameFile(file));
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : String(e));
  }
  setBusy('');
}

/**
 * Put a decoded picture behind the arena. An outline on a blank canvas only stands for the arena's
 * size, so a picture replaces it: the regions go back to waiting in cm and reappear, at the same cm
 * positions, once the outline is drawn on the picture.
 */
export async function setBackground(f: FrameSource): Promise<void> {
  const before = frame();
  if (before?.kind === 'blank' && arena.box) {
    const waiting = arena.zones.map((z) => ({ ...z, pts: z.pts.map((p) => toCm(p) as Pt) }));
    withoutNotice(() => {
      setPendingZones([...waiting, ...(pendingZones() ?? [])]);
      setArena({ zones: [], box: undefined, line: undefined });
      setFrame(f);
    });
  }
  const size = (c: HTMLCanvasElement): [number, number] => [c.width, c.height];
  setReplacedSize(
    arena.box && before && size(before.canvas).join() !== size(f.canvas).join()
      ? size(before.canvas)
      : undefined,
  );
  setFrame(f);
  setVideoChoice(undefined);
  if (f.kind === 'video') setScrubT(Math.min(1, (f.duration ?? 0) / 2));
  setChosenStage(f.kind === 'video' ? 'frame' : arena.box ? 'outline' : undefined);
  // The video the config names: use the frame it records instead of asking again.
  const saved = configReport()?.values.arenaBackground;
  if (f.kind === 'video' && saved?.kind === 'video' && saved.file === f.name) {
    if (saved.frame === 'median') await useEmptyArena();
    else if (saved.frame !== undefined) {
      await showVideoAt(saved.frame);
      useShownFrame();
    }
  }
}

/** Start without a file: a blank canvas sized to the arena. */
export function useBlankCanvas(): void {
  setLoadError('');
  setReplacedSize(undefined);
  startBlankCanvas();
  setVideoChoice(undefined);
  setChosenStage(sizeEntered() ? undefined : 'scale');
}

/** Show the video frame at t seconds (a preview until it is chosen). */
export async function showVideoAt(t: number): Promise<void> {
  const f = frame();
  if (!f?.video) return;
  setScrubT(t);
  await seekVideo(f, t);
  bumpFrame((n) => n + 1);
}

/** Use the frame shown now as the background. */
export function useShownFrame(): void {
  setVideoChoice({ t: scrubT() });
  setChosenStage(undefined);
}

/** Use the empty arena: the median of frames spread over the video, which removes the animal. */
export async function useEmptyArena(): Promise<void> {
  const f = frame();
  if (!f?.video) return;
  setBusy('Building the empty arena from 15 frames…');
  await backgroundFrame(f);
  bumpFrame((n) => n + 1);
  setBusy('');
  setVideoChoice({ median: true });
  setChosenStage(undefined);
}

/** Leave the frame stage without changing the background: show the chosen frame again. */
export async function keepChosenFrame(): Promise<void> {
  const c = videoChoice();
  if (c?.median) await useEmptyArena();
  else if (c?.t !== undefined) await showVideoAt(c.t);
  setChosenStage(undefined);
}

/**
 * Enter the arena's real size. On a blank canvas the outline is the arena, so its height follows
 * the entered proportions (the width in pixels stays, so it still fits the canvas).
 */
export function setArenaSize(width: number, height: number): void {
  setArena({ width, height });
  setSizeEntered(true);
  const b = arena.box;
  const f = frame();
  if (f?.kind === 'blank' && b && width > 0 && height > 0) {
    let w = b.w;
    let h = arena.shape === 'circle' ? w : (w * height) / width;
    const room = f.canvas.height - 2 * b.y; // keep the same margin below as above
    if (h > room) [w, h] = [(w * room) / h, room];
    if (Math.abs(h - b.h) > 0.5 || Math.abs(w - b.w) > 0.5) setArena('box', { ...b, w, h });
  }
}
