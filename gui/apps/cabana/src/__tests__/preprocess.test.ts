import { describe, expect, it } from 'vitest';
import {
  boutFrames,
  dilateMask,
  interpolateGaps,
  resampleLinear,
  smoothNeural,
  smoothSignal,
  speedOver,
  timingReport,
} from '../lib/framework.ts';
import ref from './framework_reference.json';

// framework_reference.json holds what the Python framework returned for these inputs
// (made by make_framework_reference.py). The browser versions must give the same numbers.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const same = (got: ArrayLike<number>, want: (number | null)[]) => {
  const w = nan(want);
  expect(got.length).toBe(w.length);
  w.forEach((x, i) => {
    if (Number.isNaN(x)) expect(got[i], `index ${i}`).toBeNaN();
    else expect(got[i], `index ${i}`).toBeCloseTo(x, 9);
  });
};
const v = nan(ref.v);

describe('framework functions in the browser', () => {
  for (const [g, want] of Object.entries(ref.interpolate))
    it(`interpolate_gaps, ${g} s`, () => same(interpolateGaps(v, ref.fs, +g).out, want));

  for (const [k, want] of Object.entries(ref.smooth))
    it(`smooth_signal ${k}`, () => {
      const [m, w] = k.split('-');
      same(smoothSignal(v, ref.fs, m as 'median' | 'gaussian', +w), want);
    });

  for (const [w, want] of Object.entries(ref.speed))
    it(`speed, ${w} s window`, () => same(speedOver(v, ref.y, ref.t, ref.fs, +w), want));

  for (const [s, want] of Object.entries(ref.smooth_activity))
    it(`smooth_activity, sigma ${s} s`, () => same(smoothNeural(ref.activity, ref.fs, +s), want));

  for (const [gap, want] of Object.entries(ref.resample.out))
    it(`resample_signal, max gap ${gap}`, () =>
      same(
        resampleLinear(ref.resample.tb, nan(ref.resample.vb), ref.t, gap === 'None' ? null : +gap),
        want,
      ));

  it('bouts_to_states', () => {
    const b = ref.bout_times;
    const bouts = b.start.map((start, i) => ({ start, stop: b.stop[i] }));
    expect(boutFrames(bouts, ref.t)).toEqual(ref.bouts);
  });

  for (const [d, want] of Object.entries(ref.dilate))
    it(`clean_mask dilate_s ${d}`, () => expect(dilateMask(ref.bouts, ref.fs, +d)).toEqual(want));

  it('timing_report', () => {
    const r = timingReport(ref.timing.t);
    expect(r.fsMedian).toBeCloseTo(ref.timing.fs_median, 9);
    expect(r.fsMean).toBeCloseTo(ref.timing.fs_mean, 9);
    expect(r.nDropped).toBe(ref.timing.n_dropped_frames);
    expect(r.droppedFraction).toBeCloseTo(ref.timing.dropped_fraction, 12);
    expect(r.gapFrames).toEqual(ref.timing.gap_n_frames);
    expect(r.jitterS).toBeCloseTo(ref.timing.jitter_sd_s, 12);
  });
});

describe('edge cases', () => {
  it('leaves the window alone at 0 s', () => {
    same(smoothSignal(v, ref.fs, 'median', 0), ref.v);
    expect(Array.from(smoothNeural([1, 2, 3], 10, 0))).toEqual([1, 2, 3]);
  });
  it('does not widen a label that has no frames', () => {
    expect(dilateMask([false, false], 10, 0.5)).toEqual([false, false]);
  });
});
