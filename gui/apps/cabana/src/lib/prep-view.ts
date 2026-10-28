// State and derived values for the Preprocess page: the selected step, the preview window, the
// help drawer, and what each step's preview and impact line read.

import { createMemo, createSignal } from 'solid-js';
import { boutFrames, dilateMask, lowerBound } from './framework.ts';
import { STEPS, usedBy, type PrepKey, type StepId } from './prep-deps.ts';
import { DEFAULT_PREP, prep, setPrep } from './preprocess.ts';
import { gapRuns, positionIssue, positionOnNeural } from './prepared.ts';
import { annotationResults, deconvolved, frameTimes, samplingRate } from './store.ts';
import { span } from './viz.ts';

export type PlotId =
  'events' | 'fillPos' | 'traj' | 'smoothPos' | 'smoothSpeed' | 'labels' | 'onFrames' | 'speed';

export const STEP_PLOTS: Partial<Record<StepId, PlotId[]>> = {
  eventSmooth: ['events'],
  fillGaps: ['fillPos', 'traj'],
  posSmooth: ['smoothPos', 'smoothSpeed'],
  boutPad: ['labels'],
  boutLabels: ['labels'],
  positionOnFrames: ['onFrames'],
  speed: ['speed'],
};

export const PLOT_TITLE: Record<PlotId, string> = {
  events: 'Events over time',
  fillPos: 'Position over time (x, cm)',
  traj: 'Trajectory (cm)',
  smoothPos: 'Position over time (x, cm)',
  smoothSpeed: 'Speed over time (cm/s)',
  labels: 'Behavior labels over time',
  onFrames: 'Position on neural frames (x, cm)',
  speed: 'Speed over time (cm/s)',
};

export const [prepStep, setPrepStep] = createSignal<StepId>('eventSmooth');
/** The open help drawer's tab; undefined when it is closed. */
export const [helpTab, setHelpTab] = createSignal<'about' | PlotId>();

// ---- Preview window, shared by every step
export const [winS, setWinS] = createSignal(20);
export const [winFrom, setWinFrom] = createSignal(0);
export const winStart = () =>
  Math.min(Math.max(winFrom(), span()[0]), Math.max(span()[0], span()[1] - winS()));
export const prepWindow = (): [number, number] => [winStart(), winStart() + winS()];
export const fs = () => samplingRate() ?? 30;

/** The neural frames inside the preview window. */
export const win = createMemo(() => {
  const t = frameTimes();
  if (!t) return undefined;
  const [a, b] = prepWindow();
  const lo = lowerBound(t, a);
  const hi = lowerBound(t, b);
  return { a, b, lo, hi, t: Array.from(t.slice(lo, hi)) };
});

// ---- On and off. A value of 0 is off; turning on again restores the last value used.
export type NumKey = Exclude<PrepKey, 'posMethod'>;
export const numKey = (s: StepId) => STEPS[s].keys.find((k) => k !== 'posMethod') as NumKey;
export const isOn = (s: StepId) => prep[numKey(s)] > 0;

const FIRST_VALUE: Partial<Record<NumKey, number>> = { eventSigmaS: 0.1, labelPadS: 0.1 };
const lastUsed: Partial<Record<NumKey, number>> = {};

export function setValue(k: NumKey, v: number) {
  if (v > 0) lastUsed[k] = v;
  setPrep(k, v);
}

export function setOn(s: StepId, on: boolean) {
  const k = numKey(s);
  if (!on) return setValue(k, 0);
  setValue(k, lastUsed[k] ?? (DEFAULT_PREP[k] > 0 ? DEFAULT_PREP[k] : (FIRST_VALUE[k] ?? 0.1)));
}

// ---- Which analyses use a step
export const usedList = (s: StepId) =>
  usedBy(s)
    .map((u) => (u.when ? `${u.label} ${u.when}` : u.label))
    .join(' · ');
export const usedLine = (s: StepId) =>
  usedBy(s).length ? `Used by ${usedList(s)}` : 'Not used by any analysis';

// ---- Position
export const frames = createMemo(() => {
  const p = positionOnNeural();
  if (!p) return undefined;
  let kept = 0;
  for (let i = 0; i < p.sx.length; i++) {
    const found = Number.isFinite(p.sx[i] + p.sy[i]);
    if (found && (prep.minSpeed <= 0 || p.speedAfter[i] >= prep.minSpeed)) kept++;
  }
  return { pct: (100 * kept) / p.sx.length };
});

export const runs = createMemo(() => {
  const p = positionOnNeural();
  return p ? gapRuns(p.rx, p.ry, fs(), prep.fillGapS) : [];
});

export const gapSummary = createMemo(() => {
  const by = (fate: string) => {
    const r = runs().filter((x) => x.fate === fate);
    return { n: r.length, frames: r.reduce((s, x) => s + x.len, 0) };
  };
  return { filled: by('filled'), long: by('long'), edge: by('edge') };
});

/** 1 on the frames position filling added, and on the tracked frame beside each, so lines join up. */
export const filledMask = createMemo(() => {
  const p = positionOnNeural();
  if (!p) return undefined;
  const ok = (i: number) => Number.isFinite(p.x[i] + p.y[i]);
  const added = Uint8Array.from(p.x, (_, i) =>
    !Number.isFinite(p.rx[i] + p.ry[i]) && ok(i) ? 1 : 0,
  );
  return Uint8Array.from(added, (a, i) => (a || (ok(i) && (added[i - 1] || added[i + 1])) ? 1 : 0));
});

// ---- Frame labels
const epochs = createMemo(() =>
  annotationResults().flatMap((a) => (a.error ? [] : a.epochs.filter((e) => e.stop > e.start))),
);
export const labels = createMemo(() => [...new Set(epochs().map((e) => e.label))]);

export const labelRows = createMemo(() => {
  const t = frameTimes();
  if (!t) return [];
  const sum = (a: boolean[]) => a.filter(Boolean).length;
  return labels().map((label) => {
    const asScored = boutFrames(
      epochs().filter((e) => e.label === label),
      t,
    );
    const padded = dilateMask(asScored, fs(), prep.labelPadS);
    return { label, asScored, padded, nScored: sum(asScored), nPadded: sum(padded) };
  });
});

/** Why a step's preview cannot be drawn, or undefined when it can. */
export function stepIssue(s: StepId): string | undefined {
  if (s === 'eventSmooth')
    return !deconvolved()
      ? 'Load deconvolved events to preview event smoothing.'
      : !frameTimes()
        ? 'Events need neural timestamps.'
        : undefined;
  if (s === 'boutPad' || s === 'boutLabels')
    return !labels().length
      ? 'Frame labels need behavior annotations.'
      : !frameTimes()
        ? 'Frame labels need neural timestamps.'
        : undefined;
  return positionIssue(true);
}
