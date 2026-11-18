// Values the Preprocess pop-ups read: the neural frame rate, the frame labels per behavior, and
// how the lost position runs would be filled.

import { createMemo } from 'solid-js';
import { boutFrames, dilateMask } from './framework.ts';
import type { PrepKey } from './prep-deps.ts';
import { prep, setPrep } from './preprocess.ts';
import { gapRuns, positionOnNeural } from './prepared.ts';
import { annotationResults, frameTimes, samplingRate } from './store.ts';

export const fs = () => samplingRate() ?? 30;

export type NumKey = Exclude<PrepKey, 'posMethod'>;
export function setValue(k: NumKey, v: number) {
  setPrep(k, v);
}

const runs = createMemo(() => {
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

// ---- Frame labels
const epochs = createMemo(() =>
  annotationResults().flatMap((a) => (a.error ? [] : a.epochs.filter((e) => e.stop > e.start))),
);
const labels = createMemo(() => [...new Set(epochs().map((e) => e.label))]);

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
