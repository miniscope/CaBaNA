// Spatial analyses stay unavailable while the outline has no real scale (size not entered, known
// distance not drawn) or pixel positions sit on a blank canvas. The reason reaches the card, the
// analysis status and the pages through the existing readiness code, and clears once fixed.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arena,
  calibrationIssue,
  scaleIssue,
  setArena,
  setFrame,
  setSizeEntered,
} from '../lib/arena.ts';
import type { FrameSource } from '../lib/frame.ts';
import { positionIssue } from '../lib/prepared.ts';
import { analysisNeeds } from '../lib/readiness.ts';
import { buildSnapshot } from '../lib/readiness-snapshot.ts';
import { setupSnapshot, spatialReason, statusOf } from '../lib/setup-status.ts';
import { startBlankCanvas } from '../lib/spatial-state.ts';
import { addFiles, clearAll, setSource } from '../lib/store.ts';

const spatial = () => statusOf('spatial', setupSnapshot());
const placeNeeds = () => analysisNeeds(buildSnapshot(), 'place').input.map((n) => n.text);
const positions = () =>
  addFiles([
    new File(['frame,x,y\n0,5,3\n1,6,8\n'], 'position.csv'),
    new File(['frame number,time stamp\n0,0\n1,33\n'], 'behavior_timestamps.csv'),
  ]);
const video = (): FrameSource =>
  ({ kind: 'video', name: 'v.mp4', canvas: {} as HTMLCanvasElement, scale: 1 }) as FrameSource;

describe('the real size', () => {
  it('an outline with the starting size blocks spatial analyses, with the reason, until the size is entered', async () => {
    clearAll();
    await positions();
    setFrame(video());
    setArena({ box: { x: 0, y: 0, w: 400, h: 400 } });
    expect(scaleIssue()).toMatch(/real size has not been entered/);
    expect(spatial()).not.toBe('Complete');
    expect(spatialReason(setupSnapshot())).toBe(scaleIssue());
    expect(placeNeeds()).toContain(scaleIssue());
    expect(
      analysisNeeds(buildSnapshot(), 'place').input.find((n) => n.text === scaleIssue())?.link
        ?.item,
    ).toBe('data');

    setArena({ width: 40, height: 40 });
    setSizeEntered(true);
    expect(scaleIssue()).toBeUndefined();
    expect(spatial()).toBe('Complete');
    expect(placeNeeds().some((t) => /Spatial/.test(t))).toBe(false);
  });

  it('pixel positions get no cm until the scale is set', async () => {
    clearAll();
    setSource('positionUnit', 'px');
    await positions();
    setFrame(video());
    setArena({ box: { x: 0, y: 0, w: 400, h: 400 } });
    expect(calibrationIssue()).toBe(scaleIssue());
    expect(positionIssue()).toBe(scaleIssue());
    setSizeEntered(true);
    expect(calibrationIssue()).toBeUndefined();
  });

  it('a known distance counts once it is drawn', () => {
    clearAll();
    setFrame(video());
    setArena({ box: { x: 0, y: 0, w: 400, h: 400 }, scaleMode: 'distance' });
    expect(scaleIssue()).toMatch(/known distance has not been drawn/);
    setArena('line', [
      [0, 0],
      [100, 0],
    ]);
    expect(scaleIssue()).toBeUndefined();
  });
});

describe('pixel positions on a blank canvas', () => {
  it('block until the outline is on a video frame or the positions are in cm', async () => {
    clearAll();
    setSource('positionUnit', 'px');
    await positions();
    setArena({ width: 60, height: 30 });
    setSizeEntered(true);
    startBlankCanvas();
    expect(calibrationIssue()).toMatch(/blank canvas, which has no video pixels/);
    expect(positionIssue()).toBe(calibrationIssue());
    expect(spatial()).not.toBe('Complete');
    expect(placeNeeds()).toContain(calibrationIssue());

    setSource('positionUnit', 'cm');
    expect(calibrationIssue()).toBeUndefined();
    expect(spatial()).toBe('Complete');

    setSource('positionUnit', 'px');
    setFrame(video());
    expect(calibrationIssue()).toBeUndefined();
    expect(arena.box).toBeDefined();
  });
});

const EXAMPLES = resolve(process.cwd(), '../../../example_data');
const filesOf = (dir: string) =>
  readdirSync(resolve(EXAMPLES, dir))
    .filter((n) => /\.(csv|ya?ml)$/i.test(n))
    .map((n) => new File([readFileSync(resolve(EXAMPLES, dir, n))], n));

describe('examples whose configs give the scale stay unblocked', () => {
  it.each(readdirSync(EXAMPLES).filter((d) => d.startsWith('simulated_')))('%s', async (dir) => {
    clearAll();
    await addFiles(filesOf(dir));
    expect(scaleIssue()).toBeUndefined();
    expect(calibrationIssue()).toBeUndefined();
    expect(spatial()).toBe('Complete');
  });

  // Real recordings, kept out of the repository: positions in cm and no outline, so nothing new
  // applies (Spatial setup stays as it was).
  const f1647 = ['t1', 't2', 't3', 't4'].map((t) => `f1647_opp2_${t}`);
  it.skipIf(!f1647.every((d) => existsSync(resolve(EXAMPLES, d, 'position.csv'))))(
    'F1647 trials: no scale or pixel blocker, positions still in cm',
    async () => {
      for (const dir of f1647) {
        clearAll();
        await addFiles(filesOf(dir));
        expect(scaleIssue()).toBeUndefined();
        expect(calibrationIssue()).toBeUndefined();
        expect(positionIssue()).toBeUndefined();
      }
    },
  );
});
