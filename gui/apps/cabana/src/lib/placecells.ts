// Place-cell analysis, following the CaBaNA framework (miniscope/CaBaNA, branch
// framework-demo, commit 57c0c4b): the `place_cell` recipe, which is Skaggs
// information, split-half stability and place fields, each tested against a
// circular-shift null, with smoothing and null timescale chosen from the data.
//
// Everything takes plain typed arrays and returns typed arrays, so it runs in a
// worker now and can be swapped for the Rust/WASM version without changing callers.
// The grid is 2-D: `shape` is [ny, nx] and state index = row * nx + column.

export interface PlaceInput {
  /** Neural data, one row per cell: cell * frames + frame. Non-negative (deconvolved events). */
  neural: Float32Array | Float64Array;
  cells: number;
  frames: number;
  /** Grid bin of each frame; -1 for frames that are not used (no position, too slow, outside the arena). */
  labels: Int32Array;
  shape: [number, number];
  fs: number;
}

const row = (m: PlaceInput, c: number) => m.neural.subarray(c * m.frames, (c + 1) * m.frames);

// ---- smoothing and rate maps -------------------------------------------------------------

/** Weights of `scipy.ndimage.gaussian_filter1d` with truncate=4: radius int(4 sigma + 0.5), sum 1. */
function gaussianWeights(sigma: number): Float64Array {
  const r = Math.trunc(4 * sigma + 0.5);
  const w = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let j = -r; j <= r; j++) sum += w[j + r] = Math.exp((-j * j) / (2 * sigma * sigma));
  return w.map((x) => x / sum);
}

/** Gaussian filter over a C-ordered grid, one axis at a time; samples outside the grid count as 0. */
function filterGrid(a: Float64Array, shape: number[], w: Float64Array): Float64Array {
  const r = (w.length - 1) / 2;
  let src = a;
  let stride = a.length;
  for (const n of shape) {
    stride /= n; // the last axis has stride 1
    const dst = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const k = Math.floor(i / stride) % n; // position along this axis
      let sum = 0;
      for (let j = Math.max(-r, -k); j <= Math.min(r, n - 1 - k); j++)
        sum += w[j + r] * src[i + j * stride];
      dst[i] = sum;
    }
    src = dst;
  }
  return src;
}

/**
 * `smooth_grid`: Gaussian smoothing of one value per grid state, `sigma` in bins.
 * Invalid states are left out: values and the 0/1 `valid` map are smoothed the same
 * way and divided, so edges and gaps do not pull the result toward 0. States with
 * no valid state in reach come out 0.
 */
export function smoothGrid(
  values: Float64Array,
  valid: ArrayLike<number>,
  shape: number[],
  sigma: number,
): Float64Array {
  const w = gaussianWeights(sigma);
  const norm = filterGrid(Float64Array.from(valid), shape, w);
  const out = filterGrid(values, shape, w);
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 0 ? out[i] / norm[i] : 0;
  return out;
}

/** `contiguous_folds`: fold id (0..k-1) of n time-ordered frames, in equal blocks. */
export function contiguousFolds(n: number, k: number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor((i * k) / Math.max(n, 1));
  return out;
}

export interface Mapper {
  /** States with enough occupancy. */
  valid: Uint8Array;
  /** `rate_map`: per-state sums to rates per second; NaN at invalid states. */
  rate(sums: Float64Array): Float64Array;
}

/**
 * `rate_map` for one occupancy: everything that does not depend on the sums (valid
 * states, smoothed occupancy) is done once, so the same mapper serves every shuffle.
 */
export function makeMapper(
  occFrames: Float64Array,
  fs: number,
  minOccS: number,
  shape: number[],
  sigma: number,
): Mapper {
  const n = occFrames.length;
  const occS = occFrames.map((v) => v / fs);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) valid[i] = occS[i] >= minOccS && occS[i] > 0 ? 1 : 0;
  if (!(sigma > 0)) {
    return {
      valid,
      rate(sums) {
        const r = new Float64Array(n);
        for (let i = 0; i < n; i++) r[i] = valid[i] ? sums[i] / occS[i] : NaN;
        return r;
      },
    };
  }
  const w = gaussianWeights(sigma);
  const norm = filterGrid(Float64Array.from(valid), shape, w);
  const occSm = filterGrid(occS, shape, w);
  for (let i = 0; i < n; i++) occSm[i] = norm[i] > 0 ? occSm[i] / norm[i] : 0;
  return {
    valid,
    rate(sums) {
      const s = filterGrid(sums, shape, w);
      const r = new Float64Array(n);
      for (let i = 0; i < n; i++)
        r[i] = valid[i] ? (norm[i] > 0 ? s[i] / norm[i] : 0) / occSm[i] : NaN;
      return r;
    },
  };
}

// ---- sums, shifts, null ------------------------------------------------------------------

/** The frames in use and the states they fall in, optionally one subset of them. */
interface Frames {
  idx: Int32Array;
  lab: Int32Array;
}

function framesOf(labels: Int32Array, keep?: (j: number) => boolean): Frames {
  const idx: number[] = [];
  const lab: number[] = [];
  let j = 0;
  for (let t = 0; t < labels.length; t++)
    if (labels[t] >= 0) {
      if (!keep || keep(j)) {
        idx.push(t);
        lab.push(labels[t]);
      }
      j++;
    }
  return { idx: Int32Array.from(idx), lab: Int32Array.from(lab) };
}

function occupancy(f: Frames, nStates: number): Float64Array {
  const occ = new Float64Array(nStates);
  for (const s of f.lab) occ[s]++;
  return occ;
}

/**
 * Seconds in each bin over the used frames: the whole session, and the first and second half of those
 * frames (the halves stability compares). The same split `analyzePlaceCells` makes.
 */
export function occupancySeconds(labels: Int32Array, nStates: number, fs: number) {
  const all = framesOf(labels);
  const block = contiguousFolds(all.idx.length, 2);
  const secs = (f: Frames) => occupancy(f, nStates).map((v) => v / fs);
  return {
    all: secs(all),
    a: secs(framesOf(labels, (j) => block[j] === 0)),
    b: secs(framesOf(labels, (j) => block[j] === 1)),
  };
}

/** `shifted_label_sums` for one cell: sums of roll(x, k) by state, with roll(x, k)[t] = x[(t - k) mod n]. */
function shiftedSums(x: ArrayLike<number>, f: Frames, nStates: number, k: number): Float64Array {
  const out = new Float64Array(nStates);
  const n = x.length;
  for (let j = 0; j < f.idx.length; j++) {
    let src = f.idx[j] - k;
    if (src < 0) src += n;
    else if (src >= n) src -= n;
    out[f.lab[j]] += x[src];
  }
  return out;
}

/** Small seeded generator (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `draw_shifts`: n distinct frame offsets in [minShift, nTime - minShift], with the minimum
 * clamped below half the recording. With fewer distinct offsets than shuffles they repeat.
 */
export function drawShifts(
  nTime: number,
  nShuffles: number,
  minShift: number,
  rng: () => number,
): { shifts: Int32Array; distinct: number } {
  if (nTime < 4) throw new Error('need at least 4 frames to shuffle');
  const lo = Math.max(1, Math.min(minShift, Math.floor((nTime - 1) / 2)));
  const hi = nTime - lo;
  const count = hi - lo + 1;
  const shifts = new Int32Array(nShuffles);
  if (count >= nShuffles) {
    const pool = Int32Array.from({ length: count }, (_, i) => lo + i);
    for (let i = 0; i < nShuffles; i++) {
      const j = i + Math.floor(rng() * (count - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      shifts[i] = pool[i];
    }
  } else {
    for (let i = 0; i < nShuffles; i++) shifts[i] = lo + Math.floor(rng() * count);
  }
  return { shifts, distinct: Math.min(count, nShuffles) };
}

/** `_p_values`, upper tail: (count of null >= observed + 1) / (finite null draws + 1); NaN if undefined. */
export function pUpper(observed: number, nullDraws: ArrayLike<number>): number {
  if (!Number.isFinite(observed)) return NaN;
  let ge = 0;
  let n = 0;
  for (let i = 0; i < nullDraws.length; i++) {
    const v = nullDraws[i];
    if (!Number.isFinite(v)) continue;
    n++;
    if (v >= observed) ge++;
  }
  return n === 0 ? NaN : Math.min(1, (ge + 1) / (n + 1));
}

// ---- metrics -----------------------------------------------------------------------------

/** `skaggs_information` (bits per event): sum_i P_i (l_i / lbar) log2(l_i / lbar). NaN for a silent cell. */
export function skaggsInformation(
  rate: Float64Array,
  occ: Float64Array,
  valid: Uint8Array,
): number {
  let total = 0;
  for (let i = 0; i < occ.length; i++) if (valid[i]) total += occ[i];
  if (!(total > 0)) return NaN;
  let mean = 0;
  for (let i = 0; i < occ.length; i++) if (valid[i]) mean += rate[i] * (occ[i] / total);
  if (!(mean > 0)) return NaN;
  let si = 0;
  for (let i = 0; i < occ.length; i++) {
    if (!valid[i] || !(rate[i] > 0)) continue;
    const rel = rate[i] / mean;
    si += (occ[i] / total) * rel * Math.log2(rel);
  }
  return si;
}

/** `_pearson_valid`: Pearson r over the states valid in both maps; NaN with fewer than 3 or a constant map. */
export function pearsonValid(a: Float64Array, b: Float64Array, both: Uint8Array): number {
  let n = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++)
    if (both[i]) {
      n++;
      ma += a[i];
      mb += b[i];
    }
  if (n < 3) return NaN;
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++)
    if (both[i]) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : NaN;
}

/**
 * `label_components`, 2-D: 0 is background; fields are numbered by the first bin met
 * scanning row by row. `diagonals` also joins corner neighbors (connectivity 2).
 */
export function labelComponents(
  mask: Uint8Array,
  ny: number,
  nx: number,
  diagonals = false,
): { labels: Int32Array; n: number } {
  const labels = new Int32Array(mask.length);
  const steps: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  if (diagonals) steps.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
  let n = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    labels[start] = ++n;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const j = Math.floor(p / nx);
      const i = p % nx;
      for (const [dj, di] of steps) {
        const jj = j + dj;
        const ii = i + di;
        if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue;
        const q = jj * nx + ii;
        if (mask[q] && !labels[q]) {
          labels[q] = n;
          stack.push(q);
        }
      }
    }
  }
  return { labels, n };
}

export interface FieldOptions {
  /** A bin is in a field when its rate is at least this fraction of the cell's peak (threshold_mode peak_fraction). */
  threshold: number;
  /** Smallest field, in bins. */
  minFieldBins: number;
}

export interface Fields {
  /** 0 outside fields, 1.. in order of first bin. */
  labels: Uint8Array;
  nFields: number;
  /** Mean rate inside fields over mean rate outside, among valid bins. NaN with no field. */
  inOut: number;
  peak: number;
}

/** `PlaceFields._candidates`, `_fields_one`, `_in_out`: field bins of one rate map and the in/out ratio. */
export function findFields(
  rate: Float64Array,
  valid: Uint8Array,
  shape: [number, number],
  opt: FieldOptions,
): Fields {
  const n = rate.length;
  const labels = new Uint8Array(n);
  let peak = -Infinity;
  for (let i = 0; i < n; i++) if (Number.isFinite(rate[i]) && rate[i] > peak) peak = rate[i];
  if (peak === -Infinity) return { labels, nFields: 0, inOut: NaN, peak: NaN }; // untestable cell
  const cand = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++)
    if (Number.isFinite(rate[i]) && rate[i] > 0 && rate[i] >= opt.threshold * peak) {
      cand[i] = 1;
      count++;
    }
  let nFields = 0;
  if (count >= opt.minFieldBins) {
    const { labels: lab, n: nc } = labelComponents(cand, shape[0], shape[1]);
    const size = new Int32Array(nc + 1);
    for (const l of lab) size[l]++;
    const remap = new Uint8Array(nc + 1);
    for (let l = 1; l <= nc; l++) if (size[l] >= opt.minFieldBins) remap[l] = ++nFields;
    for (let i = 0; i < n; i++) labels[i] = remap[lab[i]];
  }
  let nIn = 0;
  let nOut = 0;
  let sumIn = 0;
  let sumOut = 0;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    if (labels[i]) {
      nIn++;
      sumIn += rate[i];
    } else {
      nOut++;
      sumOut += rate[i];
    }
  }
  const mOut = sumOut / nOut;
  const inOut = nIn > 0 && nOut > 0 && mOut > 0 ? sumIn / nIn / mOut : NaN;
  return { labels, nFields, inOut, peak };
}

/** The rate-weighted center of the largest field, in bin units from the bottom-left corner (bin centers are at +0.5). */
export function fieldCentroid(
  rate: ArrayLike<number>,
  labels: Uint8Array,
  nx: number,
): [number, number] | undefined {
  const size = new Map<number, number>();
  for (const l of labels) if (l) size.set(l, (size.get(l) ?? 0) + 1);
  if (!size.size) return undefined;
  const big = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  let sw = 0;
  let sx = 0;
  let sy = 0;
  labels.forEach((l, k) => {
    if (l !== big) return;
    const w = Number.isFinite(rate[k]) ? rate[k] : 0;
    sw += w;
    sx += w * ((k % nx) + 0.5);
    sy += w * (Math.floor(k / nx) + 0.5);
  });
  return sw > 0 ? [sx / sw, sy / sw] : undefined;
}

// ---- the analysis ------------------------------------------------------------------------

export interface PlaceParams {
  /** Smoothing in grid bins (from selectSigma, or set by hand). */
  sigma: number;
  nShuffles: number;
  /** Smallest circular shift in seconds (from nullTimescale, or set by hand). */
  minShiftS: number;
  seed: number;
  alpha: number;
  field: FieldOptions;
  /** Minimum seconds in a bin: for information, stability (each half), and fields. */
  minOccInfoS: number;
  minOccStabS: number;
  minOccFieldsS: number;
}

export const DEFAULT_PLACE: PlaceParams = {
  sigma: 1,
  nShuffles: 1000,
  minShiftS: 20,
  seed: 0,
  alpha: 0.05,
  field: { threshold: 0.5, minFieldBins: 2 },
  minOccInfoS: 0.05,
  minOccStabS: 0.05,
  minOccFieldsS: 0.1,
};

export interface PlaceResult {
  cells: number;
  nStates: number;
  /** Per cell: information (bits per event) and its p, split-half stability r and its p, field in/out ratio and its p. */
  information: Float64Array;
  pInformation: Float64Array;
  stability: Float64Array;
  pStability: Float64Array;
  inOut: Float64Array;
  pFields: Float64Array;
  nFields: Float64Array;
  peak: Float64Array;
  /** Information AND stability significant at alpha: the framework's `place_cell_criteria`. */
  placeCell: Uint8Array;
  /** Rate maps used for display: all frames (the field map), first half, second half. cell * nStates + state. */
  rate: Float32Array;
  rateA: Float32Array;
  rateB: Float32Array;
  /** Field label of each bin in the field map. */
  fieldLabels: Uint8Array;
  /** The shifted values behind the p-values, cell * nShifts + shift (NaN where undefined), for plots. */
  nShifts: number;
  nullInformation: Float32Array;
  nullStability: Float32Array;
  nullInOut: Float32Array;
}

/**
 * The three place-cell analyses on every cell of `input`. Shift 0 is the observed value; the others
 * are the null. One pass over the frames gives the sums for all three: the first and second half of
 * the used frames, whose total is the full map.
 */
export function analyzePlaceCells(
  input: PlaceInput,
  p: PlaceParams,
  shifts: Int32Array,
  progress?: (done: number) => void,
): PlaceResult {
  const { cells, fs, shape } = input;
  const nStates = shape[0] * shape[1];
  const all = framesOf(input.labels);
  const block = contiguousFolds(all.idx.length, 2);
  const A = framesOf(input.labels, (j) => block[j] === 0);
  const B = framesOf(input.labels, (j) => block[j] === 1);
  const occ = occupancy(all, nStates);
  const occA = occupancy(A, nStates);
  const occB = occupancy(B, nStates);
  const mInfo = makeMapper(occ, fs, p.minOccInfoS, shape, p.sigma);
  const mFields = makeMapper(occ, fs, p.minOccFieldsS, shape, p.sigma);
  const mA = makeMapper(occA, fs, p.minOccStabS, shape, p.sigma);
  const mB = makeMapper(occB, fs, p.minOccStabS, shape, p.sigma);
  const both = mA.valid.map((v, i) => v & mB.valid[i]);

  const out: PlaceResult = {
    cells,
    nStates,
    information: new Float64Array(cells).fill(NaN),
    pInformation: new Float64Array(cells).fill(NaN),
    stability: new Float64Array(cells).fill(NaN),
    pStability: new Float64Array(cells).fill(NaN),
    inOut: new Float64Array(cells).fill(NaN),
    pFields: new Float64Array(cells).fill(NaN),
    nFields: new Float64Array(cells).fill(NaN),
    peak: new Float64Array(cells).fill(NaN),
    placeCell: new Uint8Array(cells),
    rate: new Float32Array(cells * nStates).fill(NaN),
    rateA: new Float32Array(cells * nStates).fill(NaN),
    rateB: new Float32Array(cells * nStates).fill(NaN),
    fieldLabels: new Uint8Array(cells * nStates),
    nShifts: shifts.length,
    nullInformation: new Float32Array(cells * shifts.length).fill(NaN),
    nullStability: new Float32Array(cells * shifts.length).fill(NaN),
    nullInOut: new Float32Array(cells * shifts.length).fill(NaN),
  };

  /** The three statistics for one shift of one cell, and the maps they came from. */
  const statsAt = (x: ArrayLike<number>, k: number) => {
    const sA = shiftedSums(x, A, nStates, k);
    const sB = shiftedSums(x, B, nStates, k);
    const s = sA.map((v, i) => v + sB[i]);
    const rA = mA.rate(sA);
    const rB = mB.rate(sB);
    const rF = mFields.rate(s);
    const f = findFields(rF, mFields.valid, shape, p.field);
    return {
      info: skaggsInformation(mInfo.rate(s), occ, mInfo.valid),
      stab: pearsonValid(rA, rB, both),
      fields: f,
      rA,
      rB,
      rF,
    };
  };

  for (let c = 0; c < cells; c++) {
    const x = row(input, c);
    if (x.some((v) => !Number.isFinite(v))) {
      progress?.(c + 1);
      continue; // a cell with any non-finite sample is untestable
    }
    const obs = statsAt(x, 0);
    out.information[c] = obs.info;
    out.stability[c] = obs.stab;
    out.inOut[c] = obs.fields.inOut;
    out.nFields[c] = obs.fields.nFields;
    out.peak[c] = obs.fields.peak;
    out.rate.set(obs.rF, c * nStates);
    out.rateA.set(obs.rA, c * nStates);
    out.rateB.set(obs.rB, c * nStates);
    out.fieldLabels.set(obs.fields.labels, c * nStates);

    const nInfo = new Float64Array(shifts.length);
    const nStab = new Float64Array(shifts.length);
    const nFields = new Float64Array(shifts.length);
    for (let i = 0; i < shifts.length; i++) {
      const s = statsAt(x, shifts[i]);
      nInfo[i] = s.info;
      nStab[i] = s.stab;
      nFields[i] = s.fields.inOut;
    }
    out.nullInformation.set(nInfo, c * shifts.length);
    out.nullStability.set(nStab, c * shifts.length);
    out.nullInOut.set(nFields, c * shifts.length);
    out.pInformation[c] = pUpper(obs.info, nInfo);
    out.pStability[c] = pUpper(obs.stab, nStab);
    out.pFields[c] = pUpper(obs.fields.inOut, nFields);
    out.placeCell[c] = out.pInformation[c] < p.alpha && out.pStability[c] < p.alpha ? 1 : 0;
    progress?.(c + 1);
  }
  return out;
}

// ---- choosing the settings from the data -------------------------------------------------

export interface SigmaChoice {
  /** The chosen smoothing, in grid bins. */
  sigma: number;
  candidates: number[];
  /** Held-out score of each candidate, higher is better, and the standard error over folds. */
  scores: number[];
  se: number[];
  best: number;
}

export const SIGMA_CANDIDATES = [0, 0.5, 1, 1.5, 2, 3, 4];

/**
 * `auto_smooth_sigma` (poisson scoring rule, population-pooled). The used frames are cut into
 * contiguous folds; maps built on the other folds score each held-out fold, summed over cells.
 * With `oneSe`, the smallest sigma within one standard error of the best is chosen.
 */
export function selectSigma(
  input: PlaceInput,
  candidates = SIGMA_CANDIDATES,
  { nFolds = 5, minOccS = 0.05, oneSe = true } = {},
): SigmaChoice {
  const { frames, fs, shape } = input;
  const nStates = shape[0] * shape[1];
  const all = framesOf(input.labels);
  if (all.idx.length < nFolds * 2)
    throw new Error(`only ${all.idx.length} usable frames for ${nFolds} folds`);
  const cellIds: number[] = [];
  for (let c = 0; c < input.cells; c++) {
    const x = row(input, c);
    let ok = true;
    for (let t = 0; t < frames; t++)
      if (!Number.isFinite(x[t])) {
        ok = false;
        break;
      }
    if (ok) cellIds.push(c);
  }
  if (!cellIds.length) throw new Error('no cell has finite neural data');
  const cands = [...new Set(candidates)].sort((a, b) => a - b);
  const dt = 1 / fs;
  const fold = contiguousFolds(all.idx.length, nFolds);
  const eps = cellIds.map((c) => {
    let s = 0;
    for (const v of row(input, c)) s += v;
    return 1e-6 * Math.max(s / frames, 1e-12);
  });
  const total = cellIds.map((c) => shiftedSums(row(input, c), all, nStates, 0));
  const totalN = occupancy(all, nStates);
  const perFold = Array.from({ length: nFolds }, () => new Float64Array(cands.length));
  for (let k = 0; k < nFolds; k++) {
    const te = framesOf(input.labels, (j) => fold[j] === k);
    const teN = occupancy(te, nStates);
    const trN = totalN.map((v, i) => v - teN[i]);
    const teS = cellIds.map((c) => shiftedSums(row(input, c), te, nStates, 0));
    const trS = total.map((s, ci) => s.map((v, i) => v - teS[ci][i]));
    cands.forEach((sigma, j) => {
      const m = makeMapper(trN, fs, minOccS, shape, sigma);
      let score = 0;
      cellIds.forEach((_, ci) => {
        const lam = m.rate(trS[ci]);
        for (let i = 0; i < nStates; i++) {
          if (!m.valid[i]) continue;
          const mu = lam[i] * dt;
          score += teS[ci][i] * Math.log(mu + eps[ci]) - teN[i] * mu;
        }
      });
      perFold[k][j] = score;
    });
  }
  const mean = cands.map((_, j) => perFold.reduce((s, f) => s + f[j], 0) / nFolds);
  const se = cands.map((_, j) => {
    const sd = Math.sqrt(perFold.reduce((s, f) => s + (f[j] - mean[j]) ** 2, 0) / (nFolds - 1));
    return sd / Math.sqrt(nFolds);
  });
  const best = mean.indexOf(Math.max(...mean));
  const pick = oneSe ? mean.findIndex((v) => v >= mean[best] - se[best]) : best;
  return { sigma: cands[pick], candidates: cands, scores: mean, se, best: cands[best] };
}

/**
 * `_acf_rows` + `_tau_from_acf` for one series: the first lag, in seconds, at which the
 * autocorrelation over the valid frames falls below 1/e. `maxLagS` if it never does, NaN if
 * the series has no variance or too few frames.
 */
export function autocorrTime(
  x: ArrayLike<number>,
  valid: Uint8Array,
  fs: number,
  maxLagS: number,
): number {
  const n = x.length;
  let cnt = 0;
  let sum = 0;
  for (let t = 0; t < n; t++)
    if (valid[t]) {
      cnt++;
      sum += x[t];
    }
  if (cnt < 10) return NaN;
  const mean = sum / cnt;
  const xc = new Float64Array(n);
  let var0 = 0;
  let maxAbs = 0;
  for (let t = 0; t < n; t++)
    if (valid[t]) {
      xc[t] = x[t] - mean;
      var0 += xc[t] * xc[t];
      maxAbs = Math.max(maxAbs, Math.abs(xc[t]));
    }
  var0 /= cnt;
  if (!(var0 > 1e-12 * Math.max(1, maxAbs * maxAbs))) return NaN;
  const maxLag = Math.min(Math.round(maxLagS * fs), n - 1);
  for (let k = 1; k <= maxLag; k++) {
    let acov = 0;
    let pairs = 0;
    for (let t = 0; t < n - k; t++) {
      acov += xc[t] * xc[t + k];
      pairs += valid[t] & valid[t + k];
    }
    if (pairs >= 10 && acov / pairs / var0 < Math.exp(-1)) return k / fs;
  }
  return maxLagS;
}

export interface TimescaleChoice {
  /** The chosen smallest circular shift, in seconds. */
  minShiftS: number;
  tauNeuralS: number;
  tauPositionS: number;
  note: string;
}

/**
 * `auto_null_timescale` for a circular-shift null: 3 times the longer of the neural and the
 * position autocorrelation time, at least 5 s and at most a quarter of the recording.
 * The neural time is the median over cells; the position time is the average over bins of
 * the autocorrelation time of "is the animal in this bin", weighted by time in the bin.
 */
export function selectMinShift(
  input: PlaceInput,
  { multiple = 3, floorS = 5, maxFraction = 0.25, maxLagS = 60 } = {},
): TimescaleChoice {
  const { frames, fs, shape } = input;
  const nStates = shape[0] * shape[1];
  const used = Uint8Array.from(input.labels, (l) => (l >= 0 ? 1 : 0));
  const taus: number[] = [];
  for (let c = 0; c < input.cells; c++) {
    const t = autocorrTime(row(input, c), used, fs, maxLagS);
    if (Number.isFinite(t)) taus.push(t);
  }
  taus.sort((a, b) => a - b);
  const mid = taus.length >> 1;
  const tauNeural = taus.length
    ? taus.length % 2
      ? taus[mid]
      : (taus[mid - 1] + taus[mid]) / 2
    : NaN;

  const occ = occupancy(framesOf(input.labels), nStates);
  let wsum = 0;
  let tsum = 0;
  const ind = new Float64Array(frames);
  for (let s = 0; s < nStates; s++) {
    if (!occ[s]) continue;
    for (let t = 0; t < frames; t++) ind[t] = input.labels[t] === s ? 1 : 0;
    const tau = autocorrTime(ind, used, fs, maxLagS);
    if (Number.isFinite(tau)) {
      wsum += occ[s];
      tsum += occ[s] * tau;
    }
  }
  const tauPos = wsum > 0 ? tsum / wsum : NaN;

  const minShiftS = minShiftFromTaus(tauNeural, tauPos, frames / fs, { multiple, floorS, maxFraction });
  return { ...minShiftS, tauNeuralS: tauNeural, tauPositionS: tauPos };
}

/**
 * The rule of `auto_null_timescale` once the two autocorrelation times are known: `multiple`
 * times the longer one, at least `floorS` and at most `maxFraction` of the recording.
 */
export function minShiftFromTaus(
  tauNeural: number,
  tauTarget: number,
  durationS: number,
  { multiple = 3, floorS = 5, maxFraction = 0.25 } = {},
): { minShiftS: number; note: string } {
  const finite = [tauNeural, tauTarget].filter(Number.isFinite);
  if (!finite.length) throw new Error('no autocorrelation time could be computed');
  const raw = multiple * Math.max(...finite);
  const cap = maxFraction * durationS;
  let value = Math.max(raw, floorS);
  let note = `${multiple} x ${Math.max(...finite).toFixed(2)} s = ${raw.toFixed(1)} s`;
  if (raw < floorS) note += `, raised to ${floorS} s`;
  if (value > cap) {
    value = cap;
    note += `, capped at a quarter of the recording (${cap.toFixed(1)} s)`;
  }
  return { minShiftS: Math.round(value * 1000) / 1000, note };
}
