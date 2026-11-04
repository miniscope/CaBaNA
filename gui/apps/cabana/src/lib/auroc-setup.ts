// What the auROC setup page offers and counts, as plain functions: which comparison types and
// reference groups can be chosen (and why not), the condition sources, the frame counts of the
// comparison, the frame-selection counts and the comparison timeline. No state, no calculation of
// auROC itself; the counts come from the same plan the run uses.

import type { AurocInput } from './auroc.ts';
import { pairUnavailable } from './auroc-view.ts';

export type ComparisonTypeId = 'labeled' | 'windows' | 'sessions';

export interface Choice<Id extends string = string> {
  id: Id;
  title: string;
  blurb: string;
  /** Why it cannot be chosen yet; absent when it can. */
  unavailable?: string;
}

/** The comparison types. Only labeled conditions has a method behind it. */
export const COMPARISON_TYPES: Choice<ComparisonTypeId>[] = [
  {
    id: 'labeled',
    title: 'Labeled conditions',
    blurb: 'Compare frames labeled with a behavior against a reference group of frames.',
  },
  {
    id: 'windows',
    title: 'Time windows',
    blurb: 'Compare neural data in windows before and after an event.',
    unavailable:
      'Event-aligned pre/post windows need a trial-level null, which is not built. Frames in a window are not independent, so the frame-level test does not apply.',
  },
  {
    id: 'sessions',
    title: 'Sessions or manipulations',
    blurb: 'Compare recordings, such as control against stimulation.',
    unavailable:
      'The app holds one session at a time, and comparing sessions needs cell identity across them.',
  },
];

export const isComparisonAvailable = (id: ComparisonTypeId) =>
  !COMPARISON_TYPES.find((t) => t.id === id)?.unavailable;

export type ReferenceId = 'rest' | 'behavior' | 'unlabeled';

/** The reference groups for Condition A. `labels` are the behaviors in the annotation file. */
export function referenceChoices(labels: string[]): Choice<ReferenceId>[] {
  return [
    {
      id: 'rest',
      title: 'All other eligible frames',
      blurb:
        'Every frame outside the behavior that is still eligible: unlabeled frames and frames with other behaviors. Eligible means kept after frame selection.',
    },
    {
      id: 'behavior',
      title: 'Another behavior',
      blurb:
        'Only the frames of a second behavior. Frames in neither behavior, and frames in both, are left out.',
      unavailable: pairUnavailable(labels),
    },
    {
      id: 'unlabeled',
      title: 'Unlabeled frames only',
      blurb: 'Frames with no label at all.',
      unavailable:
        'A later extension: it changes which frames form the reference, so it needs its own checks.',
    },
  ];
}

/** A source of conditions, grouped by the file it comes from. */
export interface ConditionGroup {
  id: string;
  /** The file or setup the conditions come from. */
  source: string;
  conditions: string[];
  /** Why none of the group can be chosen; absent when they can. */
  disabled?: string;
}

/** Zone conditions stay off until the zone question is decided. */
export const ZONES_WAIT = 'Zone conditions wait for approval.';

export function conditionGroups(behaviors: string[]): ConditionGroup[] {
  return [
    { id: 'behavior', source: 'Behavior annotation file', conditions: behaviors },
    { id: 'zone-file', source: 'Zone annotation file', conditions: [], disabled: ZONES_WAIT },
    {
      id: 'zone-drawn',
      source: 'Zones drawn in Spatial setup',
      conditions: [],
      disabled: ZONES_WAIT,
    },
  ];
}

export interface GroupCounts {
  label: string;
  /** Frames in the condition among eligible frames. */
  behavior: number;
  /** Frames in the comparison group. */
  comparison: number;
  /** Eligible frames in neither group (or, against another behavior, in neither or both behaviors). */
  leftOut: number;
  /** Eligible frames, after frame selection. */
  eligible: number;
}

/** Counts per tested row, from the plan the run uses (`info` holds during / outside per row). */
export function groupCounts(
  plan: { labels: string[]; info: { during: number; outside: number }[] },
  eligible: number,
): GroupCounts[] {
  return plan.labels.map((label, i) => ({
    label,
    behavior: plan.info[i].during,
    comparison: plan.info[i].outside,
    leftOut: eligible - plan.info[i].during - plan.info[i].outside,
    eligible,
  }));
}

export const countOf = (mask: ArrayLike<number>) => {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i] ? 1 : 0;
  return n;
};

export const percentOf = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');

export interface FrameSelection {
  total: number;
  kept: number;
  slow: number;
  missingSpeed: number;
  /** The speed filter's minimum, or undefined when it is off. */
  minSpeed?: number;
}

export function frameSelection(data: {
  frames: number;
  mask: ArrayLike<number>;
  excluded: { slow: number; missingSpeed: number; minSpeed?: number };
}): FrameSelection {
  return {
    total: data.frames,
    kept: countOf(data.mask),
    slow: data.excluded.slow,
    missingSpeed: data.excluded.missingSpeed,
    minSpeed: data.excluded.minSpeed,
  };
}

/** One sentence on what the frame selection does now. */
export function frameSelectionText(f: FrameSelection): string {
  if (f.minSpeed === undefined)
    return 'Speed filter off: every frame is kept, including frames with missing position.';
  return `${f.slow.toLocaleString()} frames below ${f.minSpeed} cm/s and ${f.missingSpeed.toLocaleString()} frames with missing speed are excluded.`;
}

export type FrameClass = 'behavior' | 'comparison' | 'excluded' | 'leftOut';

/**
 * What each frame is in one tested row. Excluded: removed by frame selection. Left out: eligible
 * but in neither group (against another behavior, in neither or both behaviors).
 */
export function frameClasses(
  eligibleMask: ArrayLike<number>,
  input: Pick<AurocInput, 'behaviors' | 'mask' | 'frames'>,
  row: number,
): FrameClass[] {
  const { frames } = input;
  return Array.from({ length: frames }, (_, t) => {
    if (!eligibleMask[t]) return 'excluded';
    if (!input.mask[t]) return 'leftOut';
    return input.behaviors[row * frames + t] ? 'behavior' : 'comparison';
  });
}

export interface Segment {
  cls: FrameClass;
  /** Seconds. */
  start: number;
  stop: number;
}

/** Runs of equal class, in seconds, for drawing. */
export function segments(classes: FrameClass[], fs: number): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < classes.length) {
    let j = i;
    while (j < classes.length && classes[j] === classes[i]) j++;
    out.push({ cls: classes[i], start: i / fs, stop: j / fs });
    i = j;
  }
  return out;
}
