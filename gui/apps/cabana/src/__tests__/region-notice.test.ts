// Regions are drawn on the picture. When the outline, scale or picture changes with regions
// drawn, nothing moves silently: the user chooses, and arena analyses wait for the choice.

import { beforeEach, describe, expect, it } from 'vitest';
import { arena, setArena, setFrame, setPendingZones, toCm, type Zone } from '../lib/arena.ts';
import type { FrameSource } from '../lib/frame.ts';
import {
  keepInCm,
  keepOnPicture,
  regionNotice,
  regionNoticeProblem,
  removeRegions,
  reprojected,
  undoChange,
} from '../lib/region-notice.ts';
import { clearAll } from '../lib/store.ts';

const picture = (name: string, w = 800, h = 400) =>
  ({ kind: 'image', name, canvas: { width: w, height: h }, scale: 1 }) as unknown as FrameSource;
const BOX = { x: 100, y: 50, w: 400, h: 200 }; // 40 x 20 cm at 10 px per cm
const ZONE: Zone = {
  name: 'left',
  kind: 'zone',
  shape: 'rect',
  pts: [
    [100, 50],
    [200, 250],
  ],
};
const cmOf = (z: Zone) => z.pts.map((p) => toCm(p)!.map((v) => Math.round(v * 1000) / 1000));

beforeEach(() => {
  clearAll();
  setFrame(picture('arena.png'));
  setArena({ width: 40, height: 20, box: { ...BOX } });
  setArena('zones', [structuredClone(ZONE)]);
});

describe('after the outline changes', () => {
  it('asks, blocks arena analyses, and keeps the cm coordinates on request', () => {
    const before = cmOf(arena.zones[0]);
    setArena('box', { x: 150, y: 50, w: 400, h: 200 });
    expect(regionNotice()?.kind).toBe('outline');
    expect(regionNoticeProblem()).toMatch(/Spatial setup/);
    expect(arena.zones[0].pts[0]).toEqual([100, 50]); // nothing moved yet
    keepInCm();
    expect(regionNotice()).toBeUndefined();
    expect(cmOf(arena.zones[0])).toEqual(before);
    expect(arena.zones[0].pts[0]).toEqual([150, 50]);
  });

  it('keeps the regions on the picture on request', () => {
    setArena('box', { x: 150, y: 50, w: 400, h: 200 });
    keepOnPicture();
    expect(regionNotice()).toBeUndefined();
    expect(arena.zones[0].pts).toEqual(ZONE.pts);
  });

  it('removes the regions on request', () => {
    setArena('box', { x: 150, y: 50, w: 400, h: 200 });
    removeRegions();
    expect(arena.zones).toEqual([]);
    expect(regionNotice()).toBeUndefined();
  });

  it('can undo the change', () => {
    setArena('box', { x: 150, y: 50, w: 400, h: 200 });
    undoChange();
    expect(arena.box).toEqual(BOX);
    expect(regionNotice()).toBeUndefined();
  });
});

describe('other changes', () => {
  it('keeps the order of the regions when they move', () => {
    setArena('zones', (zs) => [...zs, { ...structuredClone(ZONE), name: 'right' }]);
    setArena('box', { x: 150, y: 50, w: 400, h: 200 });
    keepInCm();
    expect(arena.zones.map((z) => z.name)).toEqual(['left', 'right']);
  });

  it('a new scale asks too', () => {
    setArena('width', 80);
    expect(regionNotice()?.kind).toBe('scale');
  });

  it('a new picture asks, and keeping cm waits for the new outline', () => {
    setFrame(picture('other.png'));
    setArena('box', undefined);
    const n = regionNotice()!;
    expect(n.kind).toBe('picture');
    expect(reprojected(n)).toBeUndefined();
    setArena('box', { x: 0, y: 0, w: 400, h: 200 });
    expect(reprojected(n)?.[0].pts[0]).toEqual([0, 0]);
  });

  it('moving to another frame of the same video, or adding a region, does not ask', () => {
    setFrame(picture('arena.png'));
    setArena('zones', (zs) => [...zs, { ...structuredClone(ZONE), name: 'right' }]);
    expect(regionNotice()).toBeUndefined();
  });

  it('placing config zones on a first outline does not ask', () => {
    clearAll();
    setPendingZones([
      {
        name: 'left',
        kind: 'zone',
        shape: 'rect',
        pts: [
          [0, 0],
          [10, 20],
        ],
      },
    ]);
    setFrame(picture('arena.png'));
    setArena({ width: 40, height: 20, box: { ...BOX } });
    expect(arena.zones.length).toBe(1);
    expect(regionNotice()).toBeUndefined();
  });
});
