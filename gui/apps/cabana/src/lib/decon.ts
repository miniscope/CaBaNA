// Checks on deconvolved events. Stand-ins that run in the browser, like qc.ts,
// and meant to move into `cabana` once settled. None of them needs the kernel
// the pipeline used: they compare the events with the traces.

import type { Matrix } from './parse.ts';
import { noiseSigma, type Check } from './qc.ts';

export interface Indicator {
  id: string;
  label: string;
  tauRise: number;
  tauDecay: number;
}

/**
 * Starting values for the double-exponential kernel. Published kinetics are half-times from different
 * preparations (for example GCaMP6f: half-decay 142 ms after 1 AP in vivo, 400 ms after 10 APs in culture;
 * Chen et al. 2013, doi:10.1038/nature12354), so the time constants are set from them roughly. Always editable.
 */
export const PRESET_NOTE =
  'Starting values for the double-exponential kernel. Published indicator kinetics are half-times measured in different preparations (for example GCaMP6f: half-decay 142 ms after 1 AP in vivo, 400 ms after 10 APs in culture; Chen et al. 2013, doi:10.1038/nature12354). The kernel time constants are set from these roughly and are always editable. jGCaMP8f uses half-rise 7.1 ms and half-decay 67.4 ms (Zhang et al. 2023, doi:10.1038/s41586-023-05828-9).';

export const INDICATORS: Indicator[] = [
  { id: 'gcamp6f', label: 'GCaMP6f', tauRise: 0.1, tauDecay: 0.6 },
  { id: 'gcamp6m', label: 'GCaMP6m', tauRise: 0.15, tauDecay: 0.9 },
  { id: 'gcamp6s', label: 'GCaMP6s', tauRise: 0.4, tauDecay: 1.8 },
  // Zhang et al. 2023, Nature 615:884: half-rise 7.1 ms, half-decay 67.4 ms (Janelia GENIE page).
  // tauDecay = 67.4 ms / ln 2 = 97 ms; tauRise 14 ms gives a kernel half-rise of about 7 ms.
  { id: 'jgcamp8f', label: 'jGCaMP8f', tauRise: 0.014, tauDecay: 0.1 },
  { id: 'ogb1', label: 'OGB-1', tauRise: 0.05, tauDecay: 1.5 },
  { id: 'custom', label: 'Custom', tauRise: 0.1, tauDecay: 0.5 },
];

/** Events convolved with a double exponential (peak 1), using two running sums. */
export function reconvolve(
  events: ArrayLike<number>,
  start: number,
  n: number,
  fs: number,
  tauRise: number,
  tauDecay: number,
): Float64Array {
  const ad = Math.exp(-1 / (fs * tauDecay));
  const ar = tauRise > 0 ? Math.exp(-1 / (fs * Math.min(tauRise, 0.95 * tauDecay))) : 0;
  let peak = 1;
  if (tauRise > 0) {
    peak = 0;
    for (let t = 0; t < Math.min(n, 10 * fs * tauDecay); t++)
      peak = Math.max(peak, ad ** t - ar ** t);
  }
  const out = new Float64Array(n);
  let yd = 0;
  let yr = 0;
  for (let t = 0; t < n; t++) {
    const e = events[start + t];
    yd = ad * yd + e;
    yr = ar * yr + e;
    out[t] = (tauRise > 0 ? yd - yr : yd) / peak;
  }
  return out;
}

/** Least-squares line y = a*x + b through a cell's trace, and the fraction of variance it explains. */
export function fitLine(y: ArrayLike<number>, start: number, x: Float64Array) {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let t = 0; t < n; t++) {
    mx += x[t] / n;
    my += y[start + t] / n;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let t = 0; t < n; t++) {
    const dx = x[t] - mx;
    const dy = y[start + t] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { a: 0, b: my, pve: NaN };
  const a = sxy / sxx;
  return { a, b: my - a * mx, pve: a > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}

const median = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** Fraction of each cell's trace variance explained by its reconvolved events. NaN for silent cells. */
export function pveByCell(events: Matrix, trace: Matrix, fs: number, rise: number, decay: number) {
  const pve: number[] = [];
  for (let c = 0; c < events.cells; c++) {
    const x = reconvolve(events.data, c * events.frames, events.frames, fs, rise, decay);
    pve.push(fitLine(trace.data, c * trace.frames, x).pve);
  }
  return pve;
}

/** Median fraction explained across a spread of cells, for each decay time constant. */
export function pveSweep(events: Matrix, trace: Matrix, fs: number, rise: number, taus: number[]) {
  const step = Math.max(1, Math.floor(events.cells / 60));
  return taus.map((tau) => {
    const pve: number[] = [];
    for (let c = 0; c < events.cells; c += step) {
      const x = reconvolve(
        events.data,
        c * events.frames,
        events.frames,
        fs,
        Math.min(rise, 0.9 * tau),
        tau,
      );
      pve.push(fitLine(trace.data, c * trace.frames, x).pve);
    }
    return median(pve);
  });
}

export const SWEEP_TAUS = Array.from({ length: 24 }, (_, i) => 0.1 * 30 ** (i / 23));

export interface EventTriggered {
  t: number[];
  /** Average trace after an event, each cell scaled to its own peak, then averaged over cells. */
  pop: number[];
  /** Rise after an event, in noise SDs, per cell. NaN when a cell has fewer than 5 events. */
  rise: number[];
  /** Decay time constant read from the average, in seconds. */
  tauDecay?: number;
}

/** Average of the trace around each event, relative to the quiet period just before it. */
export function eventTriggered(
  events: Matrix,
  trace: Matrix,
  noise: number[],
  fs: number,
): EventTriggered {
  const lo = -Math.round(fs);
  const hi = Math.round(5 * fs);
  const len = hi - lo + 1;
  const pre0 = -Math.round(fs);
  const pre1 = -Math.round(0.2 * fs);
  const near = Math.round(fs);
  const pop = new Float64Array(len);
  let used = 0;
  const rise: number[] = [];
  for (let c = 0; c < events.cells; c++) {
    const eta = new Float64Array(len);
    let n = 0;
    for (let t = -lo; t + hi < events.frames; t++) {
      if (events.data[c * events.frames + t] <= 0) continue;
      let base = 0;
      for (let k = pre0; k <= pre1; k++)
        base += trace.data[c * trace.frames + t + k] / (pre1 - pre0 + 1);
      for (let k = 0; k < len; k++) eta[k] += trace.data[c * trace.frames + t + lo + k] - base;
      n++;
    }
    if (n < 5) {
      rise.push(NaN);
      continue;
    }
    let peak = 0;
    let peakNear = 0;
    for (let k = 0; k < len; k++) {
      eta[k] /= n;
      peak = Math.max(peak, eta[k]);
      if (k >= -lo && k <= -lo + near) peakNear = Math.max(peakNear, eta[k]);
    }
    rise.push(peakNear / (noise[c] || Infinity));
    if (peak > 0) {
      for (let k = 0; k < len; k++) pop[k] += eta[k] / peak;
      used++;
    }
  }
  const avg = Array.from(pop, (v) => (used ? v / used : 0));
  const t = Array.from({ length: len }, (_, k) => (lo + k) / fs);
  return { t, pop: avg, rise, tauDecay: fitDecay(t, avg) };
}

/** Straight-line fit to the log of the average, from its peak down to 15% of the peak. */
function fitDecay(t: number[], y: number[]): number | undefined {
  let p = 0;
  for (let k = 0; k < y.length; k++) if (t[k] >= 0 && y[k] > y[p]) p = k;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = p; k < y.length && y[k] > 0.15 * y[p]; k++) {
    xs.push(t[k]);
    ys.push(Math.log(y[k]));
  }
  if (xs.length < 3) return undefined;
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (ys[i] - my);
  });
  const slope = sxy / sxx;
  return slope < 0 ? -1 / slope : undefined;
}

export function eventTraceChecks(
  events: Matrix,
  trace: Matrix | undefined,
  rise: number[],
  tol: { riseLowPct: number },
): Check[] {
  const checks: Check[] = [];
  if (trace && (trace.cells !== events.cells || trace.frames !== events.frames))
    checks.push({
      id: 'ev-shape',
      group: 'Events',
      title: 'Events match traces',
      status: 'fail',
      detail: `Events are ${events.cells} x ${events.frames}, traces are ${trace.cells} x ${trace.frames}.`,
      fix: 'Export events and traces from the same run, with the same cells and frames.',
    });
  const rated = rise.filter(Number.isFinite);
  if (rated.length) {
    const low = rated.filter((v) => v < 1).length;
    const pct = (100 * low) / rated.length;
    checks.push({
      id: 'ev-rise',
      group: 'Events',
      title: 'Events line up with trace rises',
      status: pct > tol.riseLowPct ? 'fail' : 'pass',
      detail: `After an event the trace rises by a median of ${median(rated).toFixed(1)} noise SDs. ${low} of ${rated.length} cells (${pct.toFixed(1)}%) rise by less than 1 SD, so their events sit at noise level (allowed: ${tol.riseLowPct}%).`,
      fix: 'Re-run deconvolution with a higher noise threshold or sparsity penalty, or reject the cells.',
    });
  }
  return checks;
}

/** The most any events could explain of a raw trace: all of its variance except the noise. */
export function ceilingByCell(raw: Matrix): number[] {
  return Array.from({ length: raw.cells }, (_, c) => {
    const row = raw.data.subarray(c * raw.frames, (c + 1) * raw.frames);
    let mean = 0;
    for (const v of row) mean += v / row.length;
    let variance = 0;
    for (const v of row) variance += (v - mean) ** 2 / row.length;
    return Math.max(0, 1 - noiseSigma(row) ** 2 / variance);
  });
}
