// The Applied list of the Changes drawer: everything in this session that alters the data the
// analyses read, built from the stores that already hold it (rejected cells, position jump
// choices, annotation fixes, preprocessing settings). Pure, so the list can be tested; QC flags
// and review marks that change nothing are not listed.

import { STEPS, type StepId } from './prep-deps.ts';
import { stepValues } from './prep-log.ts';
import type { DEFAULT_PREP } from './preprocess.ts';
import type { SlotId } from './slots.ts';

export type ChangeGroup = 'correction' | 'prep';

/** What Undo or Edit acts on. */
export type ChangeAction =
  | { undo: 'cell'; cell: number }
  | { undo: 'jump'; index: number }
  | { undo: 'annotations' }
  | { edit: 'prep'; slot: SlotId; step: StepId }
  | { edit: 'analysis'; analysis: 'place' };

export interface ChangeEntry {
  /** Matches the refs of the history events, for the time it was applied. */
  ref: string;
  group: ChangeGroup;
  what: string;
  detail: string;
  /** How many cells or frames it touches, in words. */
  touches: string;
  action?: ChangeAction;
  /** Why Undo or Edit is unavailable. */
  blocked?: string;
}

export interface ChangesInput {
  rejected: number[];
  /** Reason per rejected cell, when one was given. */
  reasons?: Record<number, string>;
  /** Position jumps whose frames are left out: when (s) and how many frames. */
  jumps: { first: number; start: number; frames: number }[];
  /** One line per annotation fix applied (the store's log). */
  annotationFixes: string[];
  prep: typeof DEFAULT_PREP;
  defaults: typeof DEFAULT_PREP;
  /** Whether a file is loaded in a slot. */
  loaded: (slot: SlotId) => boolean;
  /** Neural frames gap filling adds a position to, when known. */
  filledFrames?: number;
}

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** The file whose Preprocess step holds each setting; the speed filter is a place-cell setting. */
const STEP_SLOTS: Partial<Record<StepId, SlotId[]>> = {
  positionOnFrames: ['position'],
  speed: ['position'],
  fillGaps: ['position'],
  posSmooth: ['position'],
  eventSmooth: ['neural_deconvolved'],
  traceSmooth: ['neural_denoised'],
  boutPad: ['behavior_annotations', 'zone_annotations'],
};

const STEP_DETAIL: Partial<Record<StepId, string>> = {
  positionOnFrames: 'Position on the neural frames',
  speed: 'Position to speed',
  fillGaps: 'Position, linear',
  posSmooth: 'Position',
  eventSmooth: 'Deconvolved events, Gaussian',
  traceSmooth: 'Denoised traces, Gaussian',
  boutPad: 'Behavior bouts, both sides',
  speedFilter: 'Frames used by spatial analyses',
};

function touchesOf(step: StepId, p: typeof DEFAULT_PREP, filled?: number): string {
  switch (step) {
    case 'fillGaps':
      return filled === undefined ? 'gaps up to this long' : plural(filled, 'frame');
    case 'eventSmooth':
    case 'traceSmooth':
      return 'all cells';
    case 'boutPad':
      return 'every bout';
    case 'speedFilter':
      return `frames below ${p.minSpeed} cm/s`;
    case 'positionOnFrames':
      return `gaps over ${p.maxGapS} s stay lost`;
    default:
      return 'all frames';
  }
}

function prepEntries(i: ChangesInput): ChangeEntry[] {
  return (Object.keys(STEPS) as StepId[])
    .filter((s) => STEPS[s].keys.some((k) => i.prep[k] !== i.defaults[k]))
    .map((s) => {
      const slot = STEP_SLOTS[s]?.find(i.loaded) ?? STEP_SLOTS[s]?.[0];
      const action: ChangeAction | undefined =
        s === 'speedFilter'
          ? { edit: 'analysis', analysis: 'place' }
          : slot && { edit: 'prep', slot, step: s };
      return {
        ref: `prep:${s}`,
        group: 'prep' as const,
        what: `${STEPS[s].label} ${stepValues(s, i.prep)}`,
        detail: `${STEP_DETAIL[s] ?? ''} · default ${stepValues(s, i.defaults)}`,
        touches: touchesOf(s, i.prep, i.filledFrames),
        action,
        blocked:
          action && 'slot' in action && !i.loaded(action.slot)
            ? 'The file this step acts on is not loaded.'
            : undefined,
      };
    });
}

export function buildChanges(i: ChangesInput): ChangeEntry[] {
  const cells: ChangeEntry[] = [...i.rejected]
    .sort((a, b) => a - b)
    .map((c) => ({
      ref: `cell:${c}`,
      group: 'correction',
      what: `Rejected cell ${c + 1}`,
      detail: i.reasons?.[c] ?? 'No reason given',
      touches: '1 cell',
      action: { undo: 'cell', cell: c },
    }));
  const jumps: ChangeEntry[] = i.jumps.map((j, index) => ({
    ref: `jump:${j.first}`,
    group: 'correction',
    what: `Left out the position jump at ${clock(j.start)}`,
    detail: 'Position, treated as lost frames',
    touches: plural(j.frames, 'frame'),
    action: { undo: 'jump', index },
  }));
  const fixes: ChangeEntry[] = i.annotationFixes.map((text) => ({
    ref: 'annotations',
    group: 'correction',
    what: text.replace(/\.$/, ''),
    detail:
      i.annotationFixes.length > 1
        ? 'Behavior annotations · Undo removes every fix'
        : 'Behavior annotations',
    touches: plural(
      Number(/\d+/.exec(text)?.[0] ?? 0),
      text.startsWith('Merged') ? 'pair' : 'bout',
    ),
    action: { undo: 'annotations' },
  }));
  return [...cells, ...jumps, ...fixes, ...prepEntries(i)];
}

/** Entries per group, for the chip and the tab. */
export function changeCounts(entries: ChangeEntry[]): { corrections: number; prep: number } {
  const corrections = entries.filter((e) => e.group === 'correction').length;
  return { corrections, prep: entries.length - corrections };
}
