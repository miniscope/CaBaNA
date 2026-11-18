// The pills in the title row of each Data visualization box: QC findings, corrections applied and
// preprocessing changed. Pure functions of counts the QC tests and the Changes list already have.

import type { PillTone } from '../components/Pill.tsx';
import type { StepId } from './prep-deps.ts';

export type VizBox = 'footprints' | 'neural' | 'arena' | 'behavior';

export interface BoxPill {
  kind: 'qc' | 'correction' | 'prep';
  text: string;
  tone: PillTone;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** QC pill: amber with the counts that are not zero, green "none flagged" otherwise. */
export function qcPill(c: { flagged?: number; notes?: number; overlaps?: number }): BoxPill {
  const parts = [
    c.flagged ? `${c.flagged} flagged` : '',
    c.overlaps ? n(c.overlaps, 'overlap', 'overlaps') : '',
    c.notes ? n(c.notes, 'note', 'notes') : '',
  ].filter(Boolean);
  return parts.length
    ? { kind: 'qc', text: `QC: ${parts.join(' · ')}`, tone: 'flag' }
    : { kind: 'qc', text: 'QC: none flagged', tone: 'ok' };
}

/** Blue pill for applied corrections; kept apart from QC flags that are still open. */
export const correctionPill = (count: number): BoxPill | undefined =>
  count > 0
    ? { kind: 'correction', text: `${n(count, 'correction', 'corrections')} applied`, tone: 'corr' }
    : undefined;

export const preprocessPill = (changed: number): BoxPill => ({
  kind: 'prep',
  text: changed > 0 ? `Preprocess: ${changed} changed` : 'Preprocess: defaults',
  tone: 'prep',
});

const POSITION_STEPS = ['positionOnFrames', 'speed', 'fillGaps', 'posSmooth'];

/** Which boxes show the data an entry of the Applied list changes (its `ref`). */
export function boxesOf(ref: string): VizBox[] {
  if (ref.startsWith('cell:')) return ['neural', 'footprints'];
  if (ref.startsWith('jump:')) return ['arena', 'behavior'];
  if (ref === 'annotations') return ['behavior'];
  const step = ref.startsWith('prep:') ? (ref.slice(5) as StepId) : undefined;
  if (!step) return [];
  if (step === 'eventSmooth' || step === 'traceSmooth') return ['neural'];
  if (step === 'boutPad') return ['behavior'];
  if (step === 'speedFilter') return ['arena'];
  return POSITION_STEPS.includes(step) ? ['arena', 'behavior'] : [];
}

/** The entries (anything with a `ref`) that belong to a box. */
export const forBox = <T extends { ref: string }>(entries: T[], box: VizBox): T[] =>
  entries.filter((e) => boxesOf(e.ref).includes(box));

export const BOX_TITLE: Record<VizBox, string> = {
  footprints: 'Footprints',
  neural: 'Neural data',
  arena: 'Arena',
  behavior: 'Behavior and position',
};
