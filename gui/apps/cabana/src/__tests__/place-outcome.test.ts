import { describe, expect, it } from 'vitest';
import { outcomeOf, whyUndefined } from '../lib/place-outcome.ts';
import { DEFAULT_PLACE_SETTINGS, type PlaceOutcome } from '../lib/place-run.ts';
import { DEFAULT_PLACE, analyzePlaceCells, type PlaceInput } from '../lib/placecells.ts';
import ref from './placecells_reference.json';

// The reference session has a silent cell (13). The outcome of a real run on it is what the panel shows.
const input: PlaceInput = {
  neural: Float64Array.from(ref.neural),
  cells: ref.cells,
  frames: ref.frames,
  labels: Int32Array.from(ref.labels),
  shape: ref.shape as [number, number],
  fs: ref.fs,
};
const result = analyzePlaceCells(
  input,
  { ...DEFAULT_PLACE, sigma: 1 },
  Int32Array.from(ref.shifts),
);
const out = {
  data: { input },
  result,
  settings: { ...DEFAULT_PLACE_SETTINGS, alpha: 0.1 }, // 12 shifts: the smallest possible p is 1/13
} as unknown as PlaceOutcome;

describe('place-cell outcomes', () => {
  it('every cell gets one outcome; an undefined test means cannot evaluate, not fail', () => {
    for (let i = 0; i < ref.cells; i++) {
      const o = outcomeOf(out, i);
      expect(o.overall === 'cannot').toBe(o.info === 'undef' || o.stab === 'undef');
    }
    expect(outcomeOf(out, 13)).toMatchObject({ info: 'undef', overall: 'cannot' });
  });
  it('a placed cell with a clear field meets the criteria', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].some((i) => outcomeOf(out, i).overall === 'both')).toBe(true);
  });
  it('says why the silent cell is undefined', () => {
    expect(whyUndefined(out, 13, 'information')).toMatch(/silent/);
    expect(whyUndefined(out, 0, 'information')).toBeUndefined();
  });
  it('says why a half map cannot be compared', () => {
    const few = { ...result, rateB: result.rateB.map(() => NaN) } as typeof result;
    const o = {
      ...out,
      result: { ...few, stability: few.stability.map(() => NaN) },
    } as unknown as PlaceOutcome;
    expect(whyUndefined(o, 0, 'stability')).toMatch(/Only 0 bins/);
  });
});
