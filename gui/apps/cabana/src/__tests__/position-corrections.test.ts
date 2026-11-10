// Jump corrections: which frames a jump replaces, the config round trip, and that interpolated
// frames leave the position the analyses use (as lost frames), like the framework's exclude_frames.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config-read.ts';
import {
  excludedFrames,
  excludedRows,
  jumpRows,
  keptFrames,
  restoreChoices,
  setChoice,
} from '../lib/position-corrections.ts';
import type { Segment } from '../lib/qc-segments.ts';
import { sessionYaml } from '../lib/session-config.ts';
import { addFiles, clearAll, positionFrames } from '../lib/store.ts';

const DIR = resolve(process.cwd(), '../../../example_data/simulated_3chamber');
const files = () =>
  readdirSync(DIR)
    .filter((n) => /\.(csv|ya?ml)$/i.test(n))
    .map((n) => new File([readFileSync(resolve(DIR, n))], n));
const jump = (first: number, last: number): Segment => ({
  kind: 'jump',
  first,
  last,
  start: 0,
  stop: 0,
  n: 2,
  peak: 100,
});

describe('position corrections', () => {
  it('replaces the frames inside a jump, and none for a single step', () => {
    expect(jumpRows(jump(9, 11))).toEqual([10]);
    expect(jumpRows(jump(9, 13))).toEqual([10, 11, 12]);
    expect(jumpRows(jump(9, 10))).toEqual([]);
    expect(jumpRows({ ...jump(9, 20), kind: 'lost' })).toEqual([]);
  });

  it('writes interpolated and kept frames to the config and reads them back', async () => {
    clearAll();
    await addFiles(files());
    const frames = positionFrames()!;
    expect(sessionYaml()).not.toMatch(/exclude_frames/);
    setChoice(jump(9, 11), 'interpolate');
    setChoice(jump(99, 102), 'keep');
    expect(excludedFrames()).toEqual([frames[10]]);
    expect(keptFrames()).toEqual([frames[100], frames[101]]);
    expect([...excludedRows()]).toEqual([10]);
    const v = readConfig(sessionYaml()).values;
    expect(v.excludeFrames).toEqual([frames[10]]);
    expect(v.keptFrames).toEqual([frames[100], frames[101]]);
    restoreChoices([], []);
    expect(excludedFrames()).toEqual([]);
    restoreChoices(v.excludeFrames, v.keptFrames);
    expect(excludedFrames()).toEqual([frames[10]]);
  });

  it('clears with the dataset', () => {
    clearAll();
    expect(excludedFrames()).toEqual([]);
    expect(keptFrames()).toEqual([]);
  });
});
