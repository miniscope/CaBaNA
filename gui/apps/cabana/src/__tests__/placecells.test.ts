import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLACE,
  analyzePlaceCells,
  autocorrTime,
  fieldCentroid,
  pUpper,
  selectMinShift,
  selectSigma,
  type PlaceInput,
} from '../lib/placecells.ts';
import ref from './placecells_reference.json';

// placecells_reference.json holds what the Python framework returned for these inputs
// (made by make_placecells_reference.py). The browser versions must give the same numbers.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const same = (got: ArrayLike<number>, want: (number | null)[], digits = 9) => {
  const w = nan(want);
  expect(got.length).toBe(w.length);
  w.forEach((x, i) => {
    if (Number.isNaN(x)) expect(got[i], `index ${i}`).toBeNaN();
    else expect(got[i], `index ${i}`).toBeCloseTo(x, digits);
  });
};

const input: PlaceInput = {
  neural: Float64Array.from(ref.neural),
  cells: ref.cells,
  frames: ref.frames,
  labels: Int32Array.from(ref.labels),
  shape: ref.shape as [number, number],
  fs: ref.fs,
};
const params = { ...DEFAULT_PLACE, sigma: ref.sigma };
const result = analyzePlaceCells(input, params, Int32Array.from(ref.shifts));
const nStates = ref.shape[0] * ref.shape[1];
// p-values the way the framework counts them, from its own shifted values
const pOf = (r: { observed: (number | null)[]; shifted: (number | null)[][] }) =>
  nan(r.observed).map((o, c) => pUpper(o, nan(r.shifted.map((s) => s[c]))));

describe('place cells in the browser', () => {
  it('information_content', () => same(result.information, ref.information.observed));
  it('split_half_stability', () => same(result.stability, ref.stability.observed));
  it('place_fields in/out ratio', () => same(result.inOut, ref.fields.observed));
  it('place_fields count', () => same(result.nFields, ref.fields.n_fields));
  it('rate map of every cell', () =>
    ref.fields.rate_map.forEach((r, c) =>
      same(result.rate.subarray(c * nStates, (c + 1) * nStates), r, 4),
    ));
  it('field labels', () =>
    ref.fields.labels.forEach((l, c) =>
      expect(Array.from(result.fieldLabels.subarray(c * nStates, (c + 1) * nStates))).toEqual(l),
    ));
  it('p-values from the same shifts', () => {
    same(result.pInformation, pOf(ref.information));
    same(result.pStability, pOf(ref.stability));
    same(result.pFields, pOf(ref.fields));
  });
  it('keeps the shifted values the p-values came from', () => {
    expect(result.nullInformation.length).toBe(ref.cells * ref.shifts.length);
    for (let c = 0; c < ref.cells; c++) {
      const own = result.nullInformation.subarray(c * result.nShifts, (c + 1) * result.nShifts);
      const p = pUpper(result.information[c], own);
      if (Number.isNaN(result.pInformation[c])) expect(p).toBeNaN();
      else expect(p).toBeCloseTo(result.pInformation[c], 1);
    }
  });
  it('centroid of the largest field, weighted by rate', () => {
    const labels = Uint8Array.from([1, 1, 0, 0, 0, 0, 2, 0, 0]); // 3 x 3, field 1 is larger
    const rate = [1, 3, 0, 0, 0, 0, 9, 0, 0];
    const [x, y] = fieldCentroid(rate, labels, 3)!;
    expect(x).toBeCloseTo((0.5 * 1 + 1.5 * 3) / 4);
    expect(y).toBeCloseTo(0.5);
    expect(fieldCentroid(rate, new Uint8Array(9), 3)).toBeUndefined();
  });
  it('auto_smooth_sigma scores', () => {
    const c = selectSigma(input, ref.sigma_scores.candidates, { oneSe: false });
    same(c.scores, ref.sigma_scores.mean, 6);
    same(c.se, ref.sigma_scores.se, 6);
  });
  it('autocorrelation times', () => {
    const used = Uint8Array.from(ref.labels, (l) => (l >= 0 ? 1 : 0));
    ref.acf.cell_taus.forEach((want, c) => {
      const got = autocorrTime(
        input.neural.subarray(c * ref.frames, (c + 1) * ref.frames),
        used,
        ref.fs,
        60,
      );
      if (want === null) expect(got).toBeNaN();
      else expect(got).toBeCloseTo(want, 9);
    });
    const choice = selectMinShift(input);
    expect(choice.tauPositionS).toBeCloseTo(ref.acf.state_tau, 9);
  });
});
