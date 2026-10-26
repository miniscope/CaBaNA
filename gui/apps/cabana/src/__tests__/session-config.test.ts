import { describe, expect, it } from 'vitest';
import { flipY, readConfig } from '../lib/config-read.ts';
import { setArena, setPendingZones } from '../lib/arena.ts';
import { setPrep } from '../lib/preprocess.ts';
import { preprocessYaml, sessionYaml } from '../lib/session-config.ts';
import { setSource } from '../lib/store.ts';

describe('preprocess.yaml', () => {
  it('always writes the minimum speed, 2 cm/s by default', () => {
    expect(preprocessYaml()).toContain('"min_speed":2');
  });
  it('writes the Preprocess value after it is changed', () => {
    setPrep('minSpeed', 5);
    expect(preprocessYaml()).toContain('"min_speed":5');
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
