// Corrections for flagged position jumps, chosen in Position → QC. "Interpolate" treats the frames
// inside a jump as lost: they are left out of the position (config.yaml
// behavior.position.exclude_frames, read by the framework's loader), and the usual gap settings
// decide whether they are filled. "Keep" records that the jump was looked at and is real
// (metadata.position_kept_frames; the framework ignores it). Frames are camera frame numbers from
// the position file, so a saved config applies to the same file however it is sorted.

import { createMemo, createRoot } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Segment } from './qc-segments.ts';
import { onClear, positionFrames } from './store.ts';

export type Choice = 'interpolate' | 'keep';

/** Choice per camera frame number. */
const [choices, setChoices] = createStore<Record<number, Choice>>({});
onClear(() => setChoices(reconcile({})));

/**
 * Rows (indices into the position file) that a jump would replace: the frames between the last
 * good frame before it and the first good frame after it. A single step has none: the animal (or
 * the tracker) moved and stayed, so there is no frame to replace.
 */
export function jumpRows(s: Segment): number[] {
  if (s.kind !== 'jump') return [];
  return Array.from({ length: Math.max(0, s.last - s.first - 1) }, (_, i) => s.first + 1 + i);
}

const framesOf = (s: Segment): number[] => {
  const f = positionFrames();
  return f ? jumpRows(s).map((i) => f[i]) : [];
};

/** The choice made for a jump, if any. */
export function choiceOf(s: Segment): Choice | undefined {
  const fr = framesOf(s);
  return fr.length ? choices[fr[0]] : undefined;
}

/** Set (or with `undefined`, clear) the choice for every frame of a jump. */
export function setChoice(s: Segment, c: Choice | undefined): void {
  for (const f of framesOf(s)) setChoices(f, c as Choice);
}

const sortedWith = (c: Choice) =>
  Object.entries(choices)
    .filter(([, v]) => v === c)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);

export const excludedFrames = createRoot(() => createMemo(() => sortedWith('interpolate')));
export const keptFrames = createRoot(() => createMemo(() => sortedWith('keep')));

/** Rows of the position file to treat as lost. */
export const excludedRows = createRoot(() =>
  createMemo(() => {
    const f = positionFrames();
    const ex = new Set(excludedFrames());
    if (!f || !ex.size) return new Set<number>();
    return new Set(f.flatMap((v, i) => (ex.has(v) ? [i] : [])));
  }),
);

/** From a loaded config: the frames to leave out and the jumps already kept. */
export function restoreChoices(exclude: number[] = [], keep: number[] = []): void {
  setChoices(
    reconcile({
      ...Object.fromEntries(keep.map((f) => [f, 'keep' as const])),
      ...Object.fromEntries(exclude.map((f) => [f, 'interpolate' as const])),
    }),
  );
}
