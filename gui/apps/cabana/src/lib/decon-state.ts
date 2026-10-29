// Settings and results for the deconvolution check. Results are recomputed
// when the data or the kernel settings change.

import { createMemo, createSignal } from 'solid-js';
import {
  INDICATORS,
  SWEEP_TAUS,
  ceilingByCell,
  eventTraceChecks,
  eventTriggered,
  pveByCell,
  pveSweep,
} from './decon.ts';
import { noiseSigma, type Check } from './qc.ts';
import { deconvolved, denoisedTrace, rawTrace, rejected, samplingRate, tol } from './store.ts';

const [indicatorId, pickIndicator] = createSignal('gcamp6f');
const [tauRise, setTauRise] = createSignal(0.1);
const [tauDecay, setTauDecay] = createSignal(0.6);
const [compareTo, setCompareTo] = createSignal<'denoised' | 'raw'>('denoised');
export { indicatorId, tauRise, setTauRise, tauDecay, setTauDecay, compareTo, setCompareTo };

export function setIndicator(id: string): void {
  pickIndicator(id);
  const p = INDICATORS.find((i) => i.id === id);
  if (p && id !== 'custom') {
    setTauRise(p.tauRise);
    setTauDecay(p.tauDecay);
  }
}

/** Editing a time constant by hand turns the indicator into Custom. */
export function editTau(which: 'rise' | 'decay', v: number): void {
  pickIndicator('custom');
  (which === 'rise' ? setTauRise : setTauDecay)(v);
}

/** The trace the events are compared against. */
export const target = () => {
  const d = denoisedTrace();
  const r = rawTrace();
  return compareTo() === 'raw' ? (r ?? d) : (d ?? r);
};
export const targetName = () => (target() === rawTrace() ? 'raw' : 'denoised');

const noise = createMemo(() => {
  const m = rawTrace() ?? denoisedTrace();
  if (!m) return undefined;
  return Array.from({ length: m.cells }, (_, c) =>
    noiseSigma(m.data.subarray(c * m.frames, (c + 1) * m.frames)),
  );
});

/** Uses the raw trace when there is one, so the rise and the noise are in the same units. */
export const triggered = createMemo(() => {
  const ev = deconvolved();
  const tr = rawTrace() ?? denoisedTrace();
  const fs = samplingRate();
  const nz = noise();
  if (!ev || !tr || !fs || !nz || ev.frames !== tr.frames || ev.cells !== tr.cells)
    return undefined;
  return eventTriggered(ev, tr, nz, fs);
});

const comparable = () => {
  const ev = deconvolved();
  const tr = target();
  const fs = samplingRate();
  return ev && tr && fs && ev.frames === tr.frames && ev.cells === tr.cells
    ? { ev, tr, fs }
    : undefined;
};

export const pve = createMemo(() => {
  const c = comparable();
  return c ? pveByCell(c.ev, c.tr, c.fs, tauRise(), tauDecay()) : undefined;
});

export const sweep = createMemo(() => {
  const c = comparable();
  return c ? pveSweep(c.ev, c.tr, c.fs, tauRise(), SWEEP_TAUS) : undefined;
});

export const eventTraceCheckList = createMemo<Check[]>(() => {
  const ev = deconvolved();
  return ev
    ? eventTraceChecks(
        ev,
        rawTrace() ?? denoisedTrace(),
        (triggered()?.rise ?? []).map((v, c) => (rejected().has(c) ? NaN : v)),
        tol,
      )
    : [];
});

const medianOf = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** Per cell: fraction of the raw trace explained by the reconvolved events, and the most any events could explain. */
export const pveVsRaw = createMemo(() => {
  const ev = deconvolved();
  const raw = rawTrace();
  const fs = samplingRate();
  if (!ev || !raw || !fs || ev.frames !== raw.frames || ev.cells !== raw.cells) return undefined;
  return { pve: pveByCell(ev, raw, fs, tauRise(), tauDecay()), ceiling: ceilingByCell(raw) };
});

export const kernelChecks = createMemo<Check[]>(() => {
  const p = pve();
  const sw = sweep();
  if (!p || !sw) return [];
  const vsRaw = targetName() === 'raw' ? pveVsRaw() : undefined;
  // Against raw, noise caps what events can explain, so compare with each cell's own ceiling.
  const score = vsRaw
    ? medianOf(vsRaw.pve.map((v, i) => (vsRaw.ceiling[i] > 0.2 ? v / vsRaw.ceiling[i] : NaN)))
    : medianOf(p);
  const best = SWEEP_TAUS[sw.indexOf(Math.max(...sw.filter(Number.isFinite)))];
  const ratio = best / tauDecay();
  const atEdge = best <= SWEEP_TAUS[0] * 1.01;
  return [
    {
      id: 'pve',
      group: 'Events',
      title: 'Reconvolved events explain the trace',
      status: score * 100 >= tol.minPve ? 'pass' : 'fail',
      value: `${(100 * score).toFixed(0)}%`,
      limit: `need ${tol.minPve}%`,
      detail: vsRaw
        ? `The events reach a median of ${(100 * score).toFixed(0)}% of the most any events could explain of the raw trace (needed: ${tol.minPve}%).`
        : `Median ${(100 * score).toFixed(0)}% of the ${targetName()} trace variance is explained after a cell-by-cell fit of scale and offset (needed: ${tol.minPve}%).`,
      fix: 'Check the kernel settings first. If the shapes still disagree, re-run deconvolution with the right kernel, or with a higher noise threshold if it is fitting noise.',
    },
    {
      id: 'tau',
      group: 'Events',
      title: 'Decay time matches the data',
      status: ratio > 1.5 || ratio < 1 / 1.5 ? 'warn' : 'pass',
      value: `${atEdge ? '≤' : '~'}${best.toFixed(2)} s`,
      limit: `kernel ${tauDecay().toFixed(2)} s`,
      detail: `The events match the trace best with a decay time of ${atEdge ? 'at most ' : 'about '}${best.toFixed(2)} s. Your kernel uses ${tauDecay().toFixed(2)} s, so it ${ratio < 1 ? 'decays more slowly' : 'decays faster'} than the data.`,
      fix: 'Enter the decay time your pipeline used. If it matches your pipeline but not the data, the indicator or the pipeline settings may differ from what you expect. This only matters for how the kernel plots look.',
    },
  ];
});
