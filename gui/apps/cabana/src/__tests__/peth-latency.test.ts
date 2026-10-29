// The same-direction latency rule is a GUI departure from the framework: the framework counts any
// bins outside the band (checked by peth.test.ts against the reference), the GUI needs them all above
// or all below it.

import { describe, expect, it } from 'vitest';
import { firstBandRun } from '../lib/peth.ts';

const timeS = [-1, 0, 1, 2, 3, 4];
const lo = timeS.map(() => -1);
const hi = timeS.map(() => 1);

describe('firstBandRun', () => {
  it('finds a run above the band and reports its direction', () => {
    expect(firstBandRun([0, 0, 2, 3, 0, 0], lo, hi, timeS, 2, true)).toEqual({ bin: 2, dir: 1 });
  });
  it('finds a run below the band', () => {
    expect(firstBandRun([0, 0, 0, -2, -2, 0], lo, hi, timeS, 2, true)).toEqual({ bin: 3, dir: -1 });
  });
  it('a flip from above to below does not make a run', () => {
    expect(firstBandRun([0, 0, 2, -2, 0, 0], lo, hi, timeS, 2, true)).toBeNull();
    // the framework rule counts it
    expect(firstBandRun([0, 0, 2, -2, 0, 0], lo, hi, timeS, 2, false)).toEqual({ bin: 2, dir: 1 });
  });
  it('a flip starts a new run', () => {
    expect(firstBandRun([0, 0, 2, -2, -3, 0], lo, hi, timeS, 2, true)).toEqual({ bin: 3, dir: -1 });
  });
  it('ignores bins before time 0 and bins with no band', () => {
    expect(firstBandRun([2, 2, 0, 0, 0, 0], lo, hi, timeS, 2, true)).toBeNull();
    expect(firstBandRun([0, 2, 2, 0, 0, 0], [NaN, -1, -1, -1, -1, -1], hi, timeS, 2, true)).toEqual({ bin: 1, dir: 1 });
  });
  it('a run length of 1 accepts the first bin outside', () => {
    expect(firstBandRun([0, 0, 0, 2, 0, 0], lo, hi, timeS, 1, true)).toEqual({ bin: 3, dir: 1 });
  });
  it('returns null when there is no run', () => {
    expect(firstBandRun([0, 0, 0, 0, 0, 0], lo, hi, timeS, 2, true)).toBeNull();
  });
});
