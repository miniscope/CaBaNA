// Spatial setup: where it opens, which stage is next, and what its checks say, for a picture, a
// video, a blank canvas and configs with and without an arena.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { arena, frame, pendingZones, setArena, setFrame } from '../lib/arena.ts';
import { blankFrame } from '../lib/frame.ts';
import { sessionYaml } from '../lib/session-config.ts';
import {
  blocked,
  entryOf,
  firstOpen,
  openStage,
  spatialChecks,
  stagesFor,
  type SpatialSnapshot,
} from '../lib/spatial-checks.ts';
import {
  setSizeEntered,
  spatialSnapshot,
  startBlankCanvas,
  unverifiedZones,
  verifyZones,
} from '../lib/spatial-state.ts';
import { addFiles, clearAll, setSource } from '../lib/store.ts';

const none: SpatialSnapshot = {
  videoFrameChosen: false,
  outline: false,
  shape: 'rectangle',
  scaleMode: 'arena',
  lineDrawn: false,
  sizeEntered: false,
  sizeCm: [40, 40],
  positionUnit: 'cm',
  positionsLoaded: false,
  zones: 0,
  excluded: 0,
  pending: 0,
  unverified: 0,
  outside: 0,
};
const s = (over: Partial<SpatialSnapshot>): SpatialSnapshot => ({ ...none, ...over });
const drawn = s({ frameKind: 'image', outline: true, boxAspect: 2, pxPerCm: 10 });
const states = (x: SpatialSnapshot) =>
  Object.fromEntries(spatialChecks(x).map((c) => [c.key, c.state]));

describe('entry and stages', () => {
  it('opens on the landing screen until there is a background or an outline', () => {
    expect(entryOf(none)).toBe('landing');
    expect(entryOf(s({ frameKind: 'image' }))).toBe('workspace');
    expect(entryOf(s({ outline: true }))).toBe('workspace');
  });
  it('a video adds the frame stage first; an image and a blank canvas skip it', () => {
    expect(stagesFor(s({ frameKind: 'video' }))[0]).toBe('frame');
    expect(stagesFor(s({ frameKind: 'image' }))).toEqual(['outline', 'scale', 'zones', 'review']);
    expect(stagesFor(s({ frameKind: 'blank' }))).toEqual(['outline', 'scale', 'zones', 'review']);
  });
  it('opens the first stage with something left to do', () => {
    expect(openStage(s({ frameKind: 'video' }))).toBe('frame');
    expect(openStage(s({ frameKind: 'video', videoFrameChosen: true }))).toBe('outline');
    expect(openStage(s({ frameKind: 'image' }))).toBe('outline');
    expect(openStage(drawn)).toBe('scale');
    expect(openStage({ ...drawn, sizeEntered: true, sizeCm: [60, 30], unverified: 2 })).toBe(
      'zones',
    );
    expect(openStage({ ...drawn, sizeEntered: true, sizeCm: [60, 30] })).toBe('review');
  });
});

describe('checks', () => {
  it('an outline with the starting size is not Complete, and says why in plain words', () => {
    const c = spatialChecks(drawn);
    expect(blocked(c)).toBe(true);
    expect(firstOpen(c)).toMatch(
      /outline is complete, but the arena's real size has not been entered/,
    );
  });
  it('a known distance sets the scale once it is drawn', () => {
    expect(states({ ...drawn, scaleMode: 'distance' }).scale).toBe('block');
    expect(states({ ...drawn, scaleMode: 'distance', lineDrawn: true }).scale).toBe('ok');
  });
  it('keeps set, valid and verified apart', () => {
    const c = spatialChecks({
      ...drawn,
      sizeEntered: true,
      sizeCm: [60, 30],
      positionsLoaded: true,
      insideShare: 0.99,
    });
    expect(c.find((x) => x.key === 'outline')!.level).toBe('set');
    expect(c.find((x) => x.key === 'scale')!.level).toBe('valid');
    expect(c.find((x) => x.key === 'position')!.level).toBe('verified');
    expect(blocked(c)).toBe(false);
  });
  it('flags positions outside the arena and outlines with the wrong proportions', () => {
    const x = {
      ...drawn,
      sizeEntered: true,
      sizeCm: [60, 60] as [number, number],
      positionsLoaded: true,
      insideShare: 0.6,
    };
    expect(states(x).position).toBe('warn');
    expect(states(x).proportions).toBe('warn');
  });
  it('pixel positions on a blank canvas are a blocker', () => {
    const x = {
      ...drawn,
      frameKind: 'blank' as const,
      positionUnit: 'px' as const,
      positionsLoaded: true,
      sizeEntered: true,
      sizeCm: [60, 30] as [number, number],
    };
    expect(states(x).position).toBe('block');
  });
  it('loaded zones are not placement-verified until checked; no zones is fine', () => {
    const ok = { ...drawn, sizeEntered: true, sizeCm: [60, 30] as [number, number] };
    expect(states({ ...ok, zones: 3, unverified: 3 }).zones).toBe('warn');
    expect(blocked(spatialChecks({ ...ok, zones: 3 }))).toBe(false);
    expect(states(ok).zones).toBe('info');
    expect(blocked(spatialChecks(ok))).toBe(false);
  });
  it('an unchosen video frame is a step to do', () => {
    expect(states(s({ frameKind: 'video' })).background).toBe('todo');
  });
});

const EXAMPLES = resolve(process.cwd(), '../../../example_data');
const filesOf = (dir: string) =>
  readdirSync(resolve(EXAMPLES, dir))
    .filter((n) => /\.(csv|ya?ml)$/i.test(n))
    .map((n) => new File([readFileSync(resolve(EXAMPLES, dir, n))], n));

describe('configs', () => {
  it('a config with an arena and cm positions opens on a blank canvas with its zones placed', async () => {
    clearAll();
    await addFiles(filesOf('simulated_3chamber'));
    expect(frame()?.kind).toBe('blank');
    expect(arena.box).toBeDefined();
    expect(pendingZones()).toBeUndefined();
    expect(arena.zones.length).toBe(7);
    const snap = spatialSnapshot();
    expect(entryOf(snap)).toBe('workspace');
    expect(snap.sizeEntered).toBe(true);
    expect(snap.unverified).toBe(7);
    expect(openStage(snap)).toBe('zones');
    verifyZones();
    expect(unverifiedZones().size).toBe(0);
    expect(openStage(spatialSnapshot())).toBe('review');
  });

  it.each(readdirSync(EXAMPLES).filter((d) => d.startsWith('simulated_')))(
    '%s: opening on a blank canvas leaves Download config unchanged',
    async (dir) => {
      clearAll();
      await addFiles(filesOf(dir));
      expect(JSON.stringify(parse(sessionYaml()))).toBe(
        JSON.stringify(parse(readFileSync(resolve(EXAMPLES, dir, 'config.yaml'), 'utf8'))),
      );
    },
  );

  it('a partial config (no arena) stays on the landing screen', async () => {
    clearAll();
    await addFiles([new File(['neural: {file: n.npy}\n'], 'config.yaml')]);
    expect(entryOf(spatialSnapshot())).toBe('landing');
  });

  it('a blank canvas started by hand keeps an existing outline', () => {
    clearAll();
    setArena({ width: 60, height: 30 });
    setSizeEntered(true);
    startBlankCanvas();
    const box = { ...arena.box! };
    setFrame(blankFrame(800, 400));
    startBlankCanvas();
    expect(arena.box).toEqual(box);
  });

  it('pixel positions are not put on a blank canvas automatically', async () => {
    clearAll();
    setSource('positionUnit', 'px');
    await addFiles([
      new File(
        ['arena: {size: [60, 30], units: cm}\nbehavior: {position: {file: p.csv, units: px}}\n'],
        'config.yaml',
      ),
    ]);
    expect(frame()).toBeUndefined();
    expect(entryOf(spatialSnapshot())).toBe('landing');
  });
});
