// Quality checks. These are stand-ins that run in the browser so the panels
// have something to show. Each one is meant to move into `cabana` (Python),
// then Rust/WASM, once its definition is settled, with the same inputs and
// outputs.

import { column, type Footprints, type Matrix, type Table } from './parse.ts';
import type { TimingReport } from './framework.ts';

export type Status = 'pass' | 'warn' | 'fail';
export interface Check {
  id: string;
  group: 'Behavior' | 'Neural' | 'Events';
  title: string;
  status: Status;
  detail: string;
  /** Headline number and its limit, for the dashboard card. */
  value?: string;
  limit?: string;
  /** What to do about it outside CaBaNA. */
  fix?: string;
  /** Cell pairs to list under the check; each cell is clickable. */
  pairs?: { a: number; b: number; note: string }[];
}

export interface PositionQc {
  checks: Check[];
  /** Position per frame, NaN where the tracker lost the animal. */
  x: number[];
  y: number[];
  /** Frame index of each speed sample. */
  idx: number[];
  /** Speed between consecutive tracked frames. */
  t: number[];
  speed: number[];
}

/** Percent allowed before a check fails. */
export const failIfOver = (pct: number, allowed: number): Status =>
  pct > allowed ? 'fail' : 'pass';

export function positionQc(
  pos: Table,
  ts: Table,
  maxSpeed: number,
  tol: { lostPct: number; jumpPct: number },
  /** Position units per cm: 1 when position is in cm. */
  scale = 1,
): PositionQc {
  const frame = column(pos, 'frame');
  const x = column(pos, 'x');
  const y = column(pos, 'y');
  const frameNo = column(ts, 'frame number');
  const ms = column(ts, 'time stamp');
  const timeOf = new Map(frameNo.map((f, i) => [f, ms[i] / 1000]));

  const lost = (i: number) => !Number.isFinite(x[i] + y[i]) || (x[i] === -1 && y[i] === -1);
  let missing = 0;
  let run = 0;
  let longest = 0;
  const t: number[] = [];
  const speed: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (lost(i)) {
      missing++;
      longest = Math.max(longest, ++run);
      continue;
    }
    run = 0;
    if (i > 0 && !lost(i - 1)) {
      const dt = (timeOf.get(frame[i]) ?? NaN) - (timeOf.get(frame[i - 1]) ?? NaN);
      if (dt > 0) {
        idx.push(i);
        t.push(timeOf.get(frame[i])!);
        speed.push(Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / scale / dt);
      }
    }
  }
  const dtFrame = frame.length > 1 ? (ms[ms.length - 1] - ms[0]) / 1000 / (ms.length - 1) : 0;
  const missingPct = (100 * missing) / frame.length;
  const jumps = speed.filter((v) => v > maxSpeed).length;
  return {
    t,
    speed,
    idx,
    x: x.map((v, i) => (lost(i) ? NaN : v)),
    y: y.map((v, i) => (lost(i) ? NaN : v)),
    checks: [
      {
        id: 'missing',
        group: 'Behavior',
        title: 'Lost position frames',
        status: failIfOver(missingPct, tol.lostPct),
        value: `${missingPct.toFixed(1)}%`,
        limit: `allow ${tol.lostPct}%`,
        detail: `${missingPct.toFixed(1)}% of ${frame.length.toLocaleString()} frames are lost (allowed: ${tol.lostPct}%).`,
        fix: 'Fill short gaps below. Long dropouts cannot be filled: re-run tracking or exclude that stretch.',
      },
      {
        id: 'gap',
        group: 'Behavior',
        title: 'Longest lost stretch',
        status: longest * dtFrame > 1 ? 'warn' : 'pass',
        value: `${(longest * dtFrame).toFixed(2)} s`,
        limit: 'allow 1 s',
        detail: `${(longest * dtFrame).toFixed(2)} s (${longest} frames). Stretches over 1 s are noted.`,
      },
      {
        id: 'jumps',
        group: 'Behavior',
        title: 'Implausible jumps',
        status: failIfOver((100 * jumps) / Math.max(speed.length, 1), tol.jumpPct),
        value: `${jumps} of ${speed.length.toLocaleString()}`,
        detail: `${jumps} of ${speed.length.toLocaleString()} frame steps (${((100 * jumps) / Math.max(speed.length, 1)).toFixed(3)}%) are faster than ${maxSpeed} cm/s (allowed: ${tol.jumpPct}%). Fastest: ${Math.max(0, ...speed).toFixed(1)} cm/s.`,
        fix: 'Apply the median filter below, or fix the tracker (identity swaps, reflections) and re-run tracking.',
      },
    ],
  };
}

/** The framework's `timing_check`: more than 1% of frames dropped, or interval jitter over a quarter of a frame. */
export function timingChecks(name: string, r: TimingReport): Check[] {
  const limit = 0.25 / r.fsMedian;
  const bad = r.droppedFraction > 0.01 || r.jitterS > limit;
  return [
    {
      id: `timing-${name}`,
      group: 'Behavior',
      title: `${name} frame times`,
      status: bad ? 'warn' : 'pass',
      value: `${r.nDropped} dropped`,
      limit: `${r.nFrames.toLocaleString()} frames`,
      detail: `${r.nFrames.toLocaleString()} frames at ${r.fsMean.toFixed(2)} Hz. ${r.nDropped} dropped (${(100 * r.droppedFraction).toFixed(2)}%, limit 1%) in ${r.gapStart.length} gaps. Interval jitter ${(1000 * r.jitterS).toFixed(2)} ms (limit ${(1000 * limit).toFixed(1)} ms).`,
      fix: 'Dropped frames shift the clock. Check the acquisition log, and align the two clocks again if the camera and miniscope drifted apart.',
    },
  ];
}

export interface CellQc {
  /** Peak (99th percentile minus median) over frame-to-frame noise. */
  snr: number[];
  /** Highest correlation with any other cell. */
  maxCorr: number[];
  /** The cell that correlates most with each cell. */
  partner: number[];
}

const pct = (sorted: Float64Array, p: number) => sorted[Math.floor(p * (sorted.length - 1))];

/** Noise SD of a trace: the median frame-to-frame step, scaled for white noise. */
export function noiseSigma(row: ArrayLike<number>): number {
  const diff = new Float64Array(row.length - 1);
  for (let i = 1; i < row.length; i++) diff[i - 1] = Math.abs(row[i] - row[i - 1]);
  return pct(diff.sort(), 0.5) / (0.6745 * Math.SQRT2);
}

/** With `centers`, only cells closer than `maxDist` count as neighbors in the correlation check. Without, every pair counts. */
export function cellQc(m: Matrix, centers?: [number, number][], maxDist = Infinity): CellQc {
  const { data, cells, frames } = m;
  const ds = Math.max(1, Math.floor(frames / 1000));
  const nb = Math.floor(frames / ds);
  const binned = new Float64Array(cells * nb);
  const snr: number[] = [];
  for (let c = 0; c < cells; c++) {
    const row = Float64Array.from(data.subarray(c * frames, (c + 1) * frames));
    const noise = noiseSigma(row);
    const sorted = row.slice().sort();
    snr.push((pct(sorted, 0.99) - pct(sorted, 0.5)) / (noise || Infinity));
    // Average in bins, then z-score, for the correlation below.
    let mean = 0;
    for (let b = 0; b < nb; b++) {
      let s = 0;
      for (let k = 0; k < ds; k++) s += row[b * ds + k];
      binned[c * nb + b] = s / ds;
      mean += s / ds / nb;
    }
    let ss = 0;
    for (let b = 0; b < nb; b++) ss += (binned[c * nb + b] -= mean) ** 2;
    const sd = Math.sqrt(ss) || 1;
    for (let b = 0; b < nb; b++) binned[c * nb + b] /= sd;
  }
  const maxCorr = new Array<number>(cells).fill(-1);
  const partner = new Array<number>(cells).fill(-1);
  for (let a = 0; a < cells; a++) {
    for (let b = a + 1; b < cells; b++) {
      if (
        centers &&
        Math.hypot(centers[a][0] - centers[b][0], centers[a][1] - centers[b][1]) >= maxDist
      )
        continue;
      let r = 0;
      for (let i = 0; i < nb; i++) r += binned[a * nb + i] * binned[b * nb + i];
      if (r > maxCorr[a]) [maxCorr[a], partner[a]] = [r, b];
      if (r > maxCorr[b]) [maxCorr[b], partner[b]] = [r, a];
    }
  }
  return { snr, maxCorr, partner };
}

/** Each footprint divided by its own peak, so cells of different brightness compare. */
export function normalizeFootprints(f: Footprints): Float32Array {
  const px = f.height * f.width;
  const out = new Float32Array(f.data.length);
  for (let c = 0; c < f.cells; c++) {
    let peak = 0;
    for (let i = 0; i < px; i++) peak = Math.max(peak, f.data[c * px + i]);
    for (let i = 0; i < px; i++) out[c * px + i] = peak > 0 ? f.data[c * px + i] / peak : 0;
  }
  return out;
}

/** A cell's pixels are those above this fraction of its peak (half maximum). */
export const FOOTPRINT_CUTOFF = 0.5;

export interface FootprintOverlap {
  /** Cell pairs sharing more than 50% of the smaller footprint's pixels: [a, b, fraction]. */
  pairs: [number, number, number][];
  empty: number[];
}

export function footprintOverlap(f: Footprints, norm: Float32Array): FootprintOverlap {
  const px = f.height * f.width;
  const area = new Array<number>(f.cells).fill(0);
  const shared = new Map<number, number>();
  for (let i = 0; i < px; i++) {
    const here: number[] = [];
    for (let c = 0; c < f.cells; c++) if (norm[c * px + i] > FOOTPRINT_CUTOFF) here.push(c);
    for (const a of here) area[a]++;
    for (let j = 0; j < here.length; j++)
      for (let k = j + 1; k < here.length; k++) {
        const key = here[j] * f.cells + here[k];
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
  }
  const pairs: [number, number, number][] = [];
  for (const [key, n] of shared) {
    const a = Math.floor(key / f.cells);
    const b = key % f.cells;
    const frac = n / Math.min(area[a], area[b]);
    if (frac > 0.5) pairs.push([a, b, frac]);
  }
  return { pairs, empty: area.flatMap((n, c) => (n === 0 ? [c] : [])) };
}

export function footprintChecks(
  f: Footprints,
  traceCells: number | undefined,
  tol: { overlapPct: number },
  rejected: ReadonlySet<number>,
): Check[] {
  const all = footprintOverlap(f, normalizeFootprints(f));
  const pairs = all.pairs.filter(([a, b]) => !rejected.has(a) && !rejected.has(b));
  const empty = all.empty;
  const active = f.cells - rejected.size;
  const checks: Check[] = [];
  if (traceCells !== undefined && traceCells !== f.cells)
    checks.push({
      id: 'fp-count',
      group: 'Neural',
      title: 'Footprints match traces',
      status: 'fail',
      detail: `${f.cells} footprints but ${traceCells} cells in the traces.`,
      fix: 'Export footprints and traces from the same source extraction run, in the same cell order.',
    });
  checks.push({
    id: 'fp-overlap',
    group: 'Neural',
    title: 'Overlapping footprints',
    status: failIfOver((100 * pairs.length) / Math.max(active, 1), tol.overlapPct),
    value: `${pairs.length} pairs`,
    limit: `allow ${tol.overlapPct}%`,
    detail: pairs.length
      ? `${pairs.length} cell pairs (${((100 * pairs.length) / Math.max(active, 1)).toFixed(1)}% of cells) share over half of the smaller footprint (allowed: ${tol.overlapPct}%). Click a cell to see it on the map.`
      : 'No cell pairs overlap by more than half.',
    fix: 'Reject one cell of each pair below, or merge duplicates in your source extraction and re-export.',
    pairs: pairs
      .sort((x, y) => y[2] - x[2])
      .map(([a, b, f]) => ({ a, b, note: `${Math.round(100 * f)}% shared` })),
  });
  if (empty.length)
    checks.push({
      id: 'fp-empty',
      group: 'Neural',
      title: 'Empty footprints',
      status: 'warn',
      detail: `${empty.length} cells have an all-zero footprint.`,
    });
  return checks;
}

/** Centre of each footprint (row, column), weighted by brightness. */
export function footprintCentroids(f: Footprints, norm: Float32Array): [number, number][] {
  const px = f.height * f.width;
  return Array.from({ length: f.cells }, (_, c) => {
    let sum = 0;
    let sy = 0;
    let sx = 0;
    for (let i = 0; i < px; i++) {
      const v = norm[c * px + i];
      sum += v;
      sy += v * Math.floor(i / f.width);
      sx += v * (i % f.width);
    }
    return [sy / (sum || 1), sx / (sum || 1)];
  });
}
