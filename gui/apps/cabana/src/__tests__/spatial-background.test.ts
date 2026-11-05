// Image, video and blank canvas feed the same stages, and replacing the background keeps the
// outline, scale and regions. jsdom cannot decode media, so the decoder is replaced by a stub.

import { describe, expect, it, vi } from 'vitest';
import type { FrameSource } from '../lib/frame.ts';

vi.mock('../lib/frame.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/frame.ts')>();
  const canvas = (w: number, h: number) =>
    Object.assign(document.createElement('canvas'), { width: w, height: h });
  return {
    ...real,
    loadFrameFile: async (file: File): Promise<FrameSource> =>
      file.name.endsWith('.mp4')
        ? {
            kind: 'video',
            name: file.name,
            canvas: canvas(640, 480),
            scale: 1,
            duration: 60,
            video: document.createElement('video'),
          }
        : { kind: 'image', name: file.name, canvas: canvas(800, 600), scale: 1 },
    seekVideo: async () => undefined,
    backgroundFrame: async () => undefined,
  };
});

const { arena, frame, setArena } = await import('../lib/arena.ts');
const bg = await import('../lib/spatial-background.ts');
const { openStage, entryOf } = await import('../lib/spatial-checks.ts');
const st = await import('../lib/spatial-state.ts');
const { clearAll } = await import('../lib/store.ts');

const stage = () => st.chosenStage() ?? openStage(st.spatialSnapshot());

describe('one workflow for image, video and blank canvas', () => {
  it('an image opens the outline stage', async () => {
    clearAll();
    await bg.loadBackground(new File(['x'], 'arena.png', { type: 'image/png' }));
    expect(frame()?.kind).toBe('image');
    expect(entryOf(st.spatialSnapshot())).toBe('workspace');
    expect(stage()).toBe('outline');
  });

  it('a video opens the frame stage; choosing a frame moves on to the outline', async () => {
    clearAll();
    await bg.loadBackground(new File(['x'], 'session.mp4', { type: 'video/mp4' }));
    expect(frame()?.kind).toBe('video');
    expect(stage()).toBe('frame');
    expect(bg.scrubT()).toBe(1);
    await bg.showVideoAt(12.5);
    bg.useShownFrame();
    expect(st.videoChoice()).toEqual({ t: 12.5 });
    expect(stage()).toBe('outline');
    await bg.useEmptyArena();
    expect(st.videoChoice()).toEqual({ median: true });
  });

  it('a blank canvas outlines the arena and asks for its size; the outline follows the size', () => {
    clearAll();
    bg.useBlankCanvas();
    expect(frame()?.kind).toBe('blank');
    expect(arena.box).toBeDefined();
    expect(stage()).toBe('scale');
    bg.setArenaSize(60, 30);
    expect(st.sizeEntered()).toBe(true);
    expect(arena.box!.h).toBeCloseTo(arena.box!.w / 2);
    st.setChosenStage(undefined);
    expect(stage()).toBe('review');
  });

  it('replacing the background keeps the outline, scale and regions, and notes a size change', async () => {
    clearAll();
    await bg.loadBackground(new File(['x'], 'a.png', { type: 'image/png' }));
    setArena({ box: { x: 10, y: 20, w: 400, h: 200 }, width: 60, height: 30 });
    setArena('zones', [
      {
        name: 'center',
        kind: 'zone',
        shape: 'rect',
        pts: [
          [100, 50],
          [200, 150],
        ],
      },
    ]);
    await bg.loadBackground(new File(['x'], 'b.mp4', { type: 'video/mp4' }));
    expect(arena.box).toEqual({ x: 10, y: 20, w: 400, h: 200 });
    expect(arena.zones.length).toBe(1);
    expect(bg.replacedSize()).toEqual([800, 600]);
    expect(stage()).toBe('frame');
  });

  it('no file chosen changes nothing', async () => {
    clearAll();
    await bg.loadBackground(undefined);
    expect(frame()).toBeUndefined();
    expect(entryOf(st.spatialSnapshot())).toBe('landing');
  });
});
