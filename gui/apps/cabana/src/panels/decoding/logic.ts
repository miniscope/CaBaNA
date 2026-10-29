// Decoding page logic with no screen code: checks that explain why a run cannot start, which
// choices the installed framework lacks, and frame counts per behavior. Nothing here computes a
// result; reported numbers come from the framework.

import type { CapabilityName } from '../../lib/bridge-client.ts';
import { CAPABILITY_TEXT } from '../../lib/bridge-status.ts';
import {
  OTHER_NAME,
  type BehaviorDecoding,
  type DecodeTarget,
} from '../../lib/decoding-settings.ts';
import { foldSpans } from '../../lib/fold-strip.ts';

/** Plain-language statement of each missing framework feature (contract codes stay in details). */
export const PLAIN_REQUIREMENT: Partial<Record<CapabilityName, string>> = {
  decoding_fold_gap:
    'Leaving a gap of frames around each test fold out of training is not in the installed framework. Without it, neighboring frames leak between training and test.',
  decoding_fold_local_window:
    'The installed framework builds the Bayesian window across fold borders.',
  decoding_overall_test:
    'The installed framework does not test the overall value. The per-bin and per-behavior tests are unaffected.',
  overlap_policy:
    'Excluding frames where behaviors overlap is not in the installed framework, so overlapping behaviors cannot be decoded as separate classes.',
  bayes_input_check:
    'The installed framework does not check that the Bayesian decoder gets unsmoothed deconvolved events. The page checks this itself.',
  bin_eligibility:
    'Minimum occupancy per bin from training frames is not in the installed framework.',
  preview_flag: 'The installed framework does not mark preview results as preliminary.',
};

const SHORT_REQUIREMENT: Partial<Record<CapabilityName, string>> = {
  decoding_fold_gap: 'fold gap is not in the installed framework',
  overlap_policy: 'overlap policy is not in the installed framework',
};

export interface FrameworkItem {
  text: string;
  /** One short phrase for the line beside the Run button. */
  short: string;
  /** Contract code and text, shown only under Technical details. */
  code: string;
}

/** Framework features the run needs and the installed framework lacks. */
export function frameworkItems(
  requires: string[],
  has: (c: CapabilityName) => boolean,
): FrameworkItem[] {
  return requires
    .filter((c) => !has(c as CapabilityName))
    .map((c) => ({
      text: PLAIN_REQUIREMENT[c as CapabilityName] ?? c,
      short: SHORT_REQUIREMENT[c as CapabilityName] ?? `${c} is missing`,
      code: CAPABILITY_TEXT[c as CapabilityName] ?? c,
    }));
}

/** A choice the installed framework lacks: greyed, with the reason on the page. */
export interface Gate {
  disabled: boolean;
  reason: string;
}
export interface Gates {
  foldGap: Gate;
  /** Frames where behaviors overlap are left out. */
  overlapExclude: Gate;
  multiclass: Gate;
}
const open: Gate = { disabled: false, reason: '' };
export function choiceGates(has: (c: CapabilityName) => boolean): Gates {
  return {
    foldGap: has('decoding_fold_gap')
      ? open
      : {
          disabled: true,
          reason: 'Not applied by the installed framework; the value is kept for when it is.',
        },
    overlapExclude: has('overlap_policy')
      ? open
      : { disabled: true, reason: PLAIN_REQUIREMENT.overlap_policy! },
    multiclass: has('overlap_policy')
      ? open
      : {
          disabled: true,
          reason: 'Multiclass needs one class per frame, which needs the overlap feature.',
        },
  };
}

export interface InputFacts {
  /** Neural data loaded, and whether it is deconvolved events. */
  neuralLoaded: boolean;
  deconvolved: boolean;
  positionLoaded: boolean;
  arenaOutline: boolean;
  usableBehaviors: string[];
  /** Behaviors that will be decoded (the selection, or all usable ones). */
  selected: string[];
  /** Frames per selected class after the overlap policy; undefined when not countable. */
  usable?: ClassCounts;
  minFramesPerClass: number;
}

/** What the user can fix, in the order the page lists it. */
export function localChecks(target: DecodeTarget, f: InputFacts): string[] {
  const out: string[] = [];
  if (!f.neuralLoaded) out.push('Load neural data.');
  else if (!f.deconvolved)
    out.push(
      'The loaded neural data is not deconvolved events. Decoding reads unsmoothed deconvolved events; load that file.',
    );
  if (target === 'position') {
    if (!f.positionLoaded) out.push('Load a position file.');
    if (!f.arenaOutline) out.push('Draw the arena outline in Experimental setup (Spatial).');
  } else {
    if (f.usableBehaviors.length < 2)
      out.push(
        `Behavior decoding needs at least 2 usable behavior labels (found ${f.usableBehaviors.length}).`,
      );
    else if (f.selected.length < 2) out.push('Select at least 2 behaviors to decode.');
    else if (f.usable) {
      const enough = Object.values(f.usable.perClass).filter((n) => n >= f.minFramesPerClass);
      if (enough.length < 1)
        out.push(
          `No behavior has ${f.minFramesPerClass} frames or more. Lower the minimum frames per class or choose other behaviors.`,
        );
    }
  }
  return out;
}

export interface ClassCounts {
  /** Frames per class that remain after the overlap policy. */
  perClass: Record<string, number>;
  /** Frames covered by two or more selected behaviors. */
  overlapFrames: number;
  /** Frames covered by none of the selected behaviors. */
  noneFrames: number;
  totalFrames: number;
}

interface Bout {
  label: string;
  start: number;
  stop: number;
}
const lowerBound = (times: ArrayLike<number>, t: number): number => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * Frames per selected behavior on the neural clock, and how the overlap policy changes them. A frame
 * belongs to a bout when start <= t < stop. `exclude` drops frames covered by two or more selected
 * behaviors; `priority` gives each such frame to the first behavior in `labels`.
 */
export function frameCounts(
  bouts: Bout[],
  times: ArrayLike<number>,
  labels: string[],
  policy: BehaviorDecoding['overlap'],
  other: boolean,
): ClassCounts {
  const index = new Map(labels.map((l, i) => [l, i]));
  const covered: Set<number>[] = new Array(times.length);
  for (const b of bouts) {
    const k = index.get(b.label);
    if (k === undefined) continue;
    for (let i = lowerBound(times, b.start); i < lowerBound(times, b.stop); i++)
      (covered[i] ??= new Set()).add(k);
  }
  const perClass: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
  let overlapFrames = 0;
  let noneFrames = 0;
  for (let i = 0; i < times.length; i++) {
    const set = covered[i];
    if (!set) {
      noneFrames++;
      continue;
    }
    if (set.size > 1) overlapFrames++;
    if (set.size === 1 || policy === 'priority') perClass[labels[Math.min(...set)]]++;
  }
  if (other) perClass[OTHER_NAME] = noneFrames;
  return { perClass, overlapFrames, noneFrames, totalFrames: times.length };
}

/** A frame count text such as "1,234 frames (41.1 s)". */
export const framesText = (n: number, fs: number) =>
  `${n.toLocaleString()} frames (${(n / fs).toFixed(1)} s)`;

/** Fold strip drawing inputs: each fold's block and its leave-out gaps as fractions of the session. */
export interface StripBlock {
  fold: number;
  x0: number;
  x1: number;
  gapBefore: [number, number];
  gapAfter: [number, number];
}
export function stripBlocks(n: number, k: number, fs: number, gapS: number): StripBlock[] {
  const total = n / fs;
  return foldSpans(n, k, fs, gapS).map((s) => ({
    fold: s.fold,
    x0: s.startS / total,
    x1: s.stopS / total,
    gapBefore: [s.gapBeforeS[0] / total, s.gapBeforeS[1] / total],
    gapAfter: [s.gapAfterS[0] / total, s.gapAfterS[1] / total],
  }));
}

/** Valid range text, shown beside each numeric setting. */
export const RANGE = {
  folds: 'whole number from 2',
  foldGapS: '0 or more seconds',
  shuffles: 'whole number from 1',
  blockS: 'more than 0 seconds',
  alpha: 'between 0 and 1',
  windowS: '0 or more seconds (0 = one frame)',
  smoothSigmaBins: '0 or more bins (0 = off)',
  minFramesPerClass: 'whole number from 1',
  C: 'more than 0',
  binS: 'more than 0 seconds',
} as const;

/** The correction family named on the page and in the results (D-39). */
export const correctionFamily = (target: DecodeTarget) =>
  target === 'position' ? 'across eligible bins' : 'across behaviors';

type Num = number;
interface RangeSettings {
  folds: Num;
  foldGapS: Num;
  shuffles: Num;
  blockS: Num;
  alpha: Num;
  windowS: Num;
  smoothSigmaBins: Num;
  minFramesPerClass: Num;
  C?: Num;
  binS?: Num;
}

/** Settings outside their valid range, in words. The run is blocked until they are fixed. */
export function settingProblems(s: RangeSettings, logistic: boolean): string[] {
  const out: string[] = [];
  const bad = (ok: boolean, text: string) => ok || out.push(text);
  bad(Number.isInteger(s.folds) && s.folds >= 2, `Folds: ${RANGE.folds}.`);
  bad(s.foldGapS >= 0, `Fold gap: ${RANGE.foldGapS}.`);
  bad(Number.isInteger(s.shuffles) && s.shuffles >= 1, `Shuffles: ${RANGE.shuffles}.`);
  bad(s.blockS > 0, `Block length: ${RANGE.blockS}.`);
  bad(s.alpha > 0 && s.alpha < 1, `Alpha: ${RANGE.alpha}.`);
  bad(
    Number.isInteger(s.minFramesPerClass) && s.minFramesPerClass >= 1,
    `Minimum frames: ${RANGE.minFramesPerClass}.`,
  );
  if (logistic) {
    bad((s.C ?? 1) > 0, `C: ${RANGE.C}.`);
    bad((s.binS ?? 1) > 0, `Time bin: ${RANGE.binS}.`);
  } else {
    bad(s.windowS >= 0, `Window: ${RANGE.windowS}.`);
    bad(s.smoothSigmaBins >= 0, `Map smoothing: ${RANGE.smoothSigmaBins}.`);
  }
  return out;
}
