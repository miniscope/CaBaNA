import { describe, expect, it } from 'vitest';
import { cvPredict, DEFAULT_LINEAR, decodeLinear, fitLogistic, type LinearInput } from '../lib/decode-linear.ts';
import { contiguousFolds } from '../lib/placecells.ts';
import ref from './decoding_reference.json';

// decoding_reference.json holds scikit-learn's LogisticRegression (class_weight="balanced") and the
// framework's DecodeStates on 0.5 s bins (made by make_decoding_reference.py).
//
// What agrees, and how closely:
// - Weights: the framework fits with scikit-learn's default tolerance (1e-4); this solver runs to a
//   gradient of 1e-7. Against scikit-learn run to tolerance 1e-12 the weights agree to 1e-6 and the
//   intercept to 1e-6.
// - Held-out predictions and balanced accuracy against the framework (default tolerance): frames on the
//   decision boundary can fall on either side, so the test allows at most one differing frame per fold
//   and per behavior, and balanced accuracy within the change that one frame makes.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
type Ref = typeof ref.linear;

function setup(L: Ref) {
  const input: LinearInput = {
    neural: Float64Array.from(nan((L.neural as (number | null)[][]).flat())),
    cells: ref.cells,
    frames: L.frames,
    fs: L.fs,
    labels: Int32Array.from(L.labels),
    mask: new Uint8Array(L.frames).fill(1),
    nStates: L.n_states,
  };
  const idx = [...input.labels].flatMap((l, t) => (l >= 0 ? [t] : []));
  const n = idx.length;
  const x = new Float64Array(n * input.cells); // labeled frames x cells
  idx.forEach((t, i) => {
    for (let c = 0; c < input.cells; c++) x[i * input.cells + c] = (input.neural as Float64Array)[c * input.frames + t];
  });
  return { input, idx, n, x };
}

/** The standardized fold-0 training problem of behavior 1. */
function foldZero(L: Ref) {
  const { input, idx, n, x } = setup(L);
  const y = Uint8Array.from(idx, (t) => (input.labels[t] === 1 ? 1 : 0));
  const folds = contiguousFolds(n, 5);
  const tr = [...folds].flatMap((f, i) => (f !== 0 ? [i] : []));
  const mu = new Float64Array(input.cells);
  const sd = new Float64Array(input.cells);
  for (const i of tr) for (let c = 0; c < input.cells; c++) mu[c] += x[i * input.cells + c] / tr.length;
  for (const i of tr) for (let c = 0; c < input.cells; c++) sd[c] += (x[i * input.cells + c] - mu[c]) ** 2 / tr.length;
  for (let c = 0; c < input.cells; c++) sd[c] = Math.sqrt(sd[c]) > 1e-12 ? Math.sqrt(sd[c]) : 1;
  const xt = new Float64Array(tr.length * input.cells);
  tr.forEach((i, r) => {
    for (let c = 0; c < input.cells; c++) xt[r * input.cells + c] = (x[i * input.cells + c] - mu[c]) / sd[c];
  });
  return { input, xt, yt: Uint8Array.from(tr, (i) => y[i]), n: tr.length };
}

for (const [name, L] of [
  ['behaviors, easy', ref.linear],
  ['arena quadrants, harder', ref.linear_hard],
] as [string, Ref][]) {
  describe(`logistic regression against scikit-learn: ${name}`, () => {
    const { input, xt, yt, n } = foldZero(L);
    L.fit.C.forEach((C, k) => {
      it(`weights and intercept at C = ${C}`, () => {
        const fit = fitLogistic(xt, yt, n, input.cells, C);
        expect(fit.gradient).toBeLessThan(1e-6);
        L.fit.coef[k].forEach((w, j) => expect(fit.w[j]).toBeCloseTo(w, 5));
        expect(fit.b).toBeCloseTo(L.fit.intercept[k], 5);
      });
    });
  });

  describe(`one-vs-rest decoding against the framework (DecodeStates, logistic): ${name}`, () => {
    const { input, idx, n, x } = setup(L);
    const out = decodeLinear(input, DEFAULT_LINEAR);
    it('decodes the same behaviors with the same frame counts', () => {
      expect(Array.from(out.nFrames)).toEqual(L.n_frames);
      nan(L.values as (number | null)[]).forEach((w, s) => expect(Number.isNaN(out.values[s])).toBe(Number.isNaN(w)));
    });
    it('held-out predictions differ from scikit-learn on at most one frame per fold', () => {
      const folds = contiguousFolds(n, 5);
      for (const [state, want] of Object.entries(L.predictions)) {
        const y = Uint8Array.from(idx, (t) => (input.labels[t] === +state ? 1 : 0));
        const got = cvPredict(x, y, n, input.cells, DEFAULT_LINEAR)!;
        for (let f = 0; f < 5; f++) {
          let diff = 0;
          for (let i = 0; i < n; i++) if (folds[i] === f && got[i] !== (want as number[])[i]) diff++;
          expect(diff, `behavior ${state}, fold ${f}`).toBeLessThanOrEqual(1);
        }
      }
    });
    it('balanced accuracy is within the change of a few frames', () => {
      nan(L.values as (number | null)[]).forEach((w, s) => {
        if (Number.isNaN(w)) return;
        // one frame moves the recall of the smaller class by 1 / its size, so balanced accuracy by half of that
        const oneFrame = 0.5 / Math.min(L.n_frames[s], n - L.n_frames[s]);
        expect(Math.abs(out.values[s] - w)).toBeLessThanOrEqual(5 * oneFrame + 1e-12);
      });
      expect(Math.abs(out.overall - L.overall)).toBeLessThan(0.02);
    });
    it('counts a 2 x 2 confusion per decoded behavior that sums to the labeled frames', () => {
      out.values.forEach((v, s) => {
        const c = out.confusion.slice(s * 4, s * 4 + 4);
        if (Number.isNaN(v)) expect(c[0]).toBeNaN();
        else expect(c.reduce((a, b) => a + b, 0)).toBe(n);
      });
    });
  });
}
