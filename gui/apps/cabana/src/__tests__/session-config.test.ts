import { describe, expect, it } from 'vitest';
import { flipY, readConfig } from '../lib/config-read.ts';
import { setArena, setPendingZones } from '../lib/arena.ts';
import { prep, setPrep } from '../lib/preprocess.ts';
import { preprocessYaml, sessionYaml } from '../lib/session-config.ts';
import { addFiles, setSource } from '../lib/store.ts';

describe('preprocess.yaml', () => {
  it('always writes the minimum speed, 2 cm/s by default', () => {
    expect(preprocessYaml()).toContain('"min_speed":2');
  });
  it('writes the Preprocess value after it is changed', () => {
    setPrep('minSpeed', 5);
    expect(preprocessYaml()).toContain('"min_speed":5');
  });
});

describe('position steps', () => {
  it('writes the gap limit, then fills gaps before smoothing, as the GUI runs them', async () => {
    await addFiles([new File(['frame,x,y\n0,1,1\n'], 'position.csv')]);
    setPrep({ maxGapS: 0.3, fillGapS: 0.4, posWindowS: 0.25 });
    expect(readConfig(sessionYaml()).values.maxGapS).toBe(0.3);
    const yaml = preprocessYaml();
    expect(yaml).toContain('"name":"interpolate_gaps","signal":["x","y"],"max_gap_s":0.4');
    expect(yaml.indexOf('interpolate_gaps')).toBeLessThan(yaml.indexOf('smooth_signal'));
    expect(yaml.indexOf('smooth_signal')).toBeLessThan(yaml.indexOf('"name":"speed"'));
  });
  it('leaves the fill step out at 0', () => {
    setPrep('fillGapS', 0);
    expect(preprocessYaml()).not.toContain('interpolate_gaps');
    expect(prep.maxGapS).toBe(0.3);
  });
});

describe('y increases down', () => {
  const zone = {
    name: 'tri',
    kind: 'zone' as const,
    shape: 'polygon' as const,
    pts: [
      [0, 2],
      [10, 2],
      [5, 9],
    ] as [number, number][],
  };
  it('flips y with the arena height', () => {
    expect([3, 30].map((y) => flipY(y, 38))).toEqual([35, 8]);
  });
  it('writes the setting and flipped zones to the config, and reads them back', () => {
    setArena({ width: 60, height: 38 });
    setSource('yDown', true);
    setPendingZones([zone]);
    const text = sessionYaml();
    expect(text).toContain('y_increases: down');
    const back = readConfig(text);
    expect(back.values.yDown).toBe(true);
    expect(back.values.zones![0].pts).toEqual(zone.pts);
    // the file holds the zone in the position file's frame
    expect(text).toContain('tri: [[0, 36], [10, 36], [5, 29]]');
  });
  it('leaves zones alone when y is up', () => {
    const cfg = 'neural: {file: a.npy}\narena: {size: [60, 38], zones: {a: [0, 2, 10, 9]}}\n';
    expect(readConfig(cfg).values.zones![0].pts).toEqual([
      [0, 2],
      [10, 9],
    ]);
    expect(readConfig(cfg + 'metadata: {y_increases: down}\n').values.zones![0].pts).toEqual([
      [0, 36],
      [10, 29],
    ]);
  });
});
