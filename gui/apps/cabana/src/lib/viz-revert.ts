// What the Revert changes window lists for one box, and which saved results its selection would
// leave needing a rerun. Pure; the actions themselves are the Undo and Edit of the Changes drawer.

import type { ChangeEntry } from './changes.ts';
import { DEPS, ANALYSIS_LABEL, type StepId } from './prep-deps.ts';

export interface RevertRow {
  ref: string;
  group: 'correction' | 'prep';
  what: string;
  /** Where it came from, e.g. "applied Nov 18, 10:42"; or "at default (off)". */
  note: string;
  /** What reverting does. */
  restore: string;
  /** Nothing to revert: the setting is already at its default. */
  idle?: boolean;
  entry?: ChangeEntry;
}

/** Applied items first, then the settings that are at their defaults (greyed, nothing to restore). */
export function revertRows(
  applied: ChangeEntry[],
  atDefault: { ref: string; what: string; value: string }[],
  when: (ref: string) => string,
): RevertRow[] {
  const rows: RevertRow[] = applied.map((e) => ({
    ref: e.ref,
    group: e.group,
    what: e.what,
    note: [when(e.ref) && `applied ${when(e.ref)}`, e.detail].filter(Boolean).join(' · '),
    restore: e.restore,
    entry: e,
  }));
  return [
    ...rows,
    ...atDefault.map((d) => ({
      ref: d.ref,
      group: 'prep' as const,
      what: d.what,
      note: `at default (${d.value})`,
      restore: 'nothing to restore',
      idle: true,
    })),
  ];
}

/** Whether an analysis reads what the entry changed: its rejected cells, position, labels or a step. */
function reads(analysis: keyof typeof DEPS, ref: string): boolean {
  if (ref.startsWith('cell:')) return true; // rejected cells are part of every run
  if (ref.startsWith('jump:')) return !!DEPS[analysis].positionOnFrames;
  if (ref === 'annotations') return !!DEPS[analysis].boutLabels;
  return ref.startsWith('prep:') && !!DEPS[analysis][ref.slice(5) as StepId];
}

/** Labels of the analyses with a saved result that read something the selected items change. */
export function rerunAnalyses(refs: string[], saved: string[]): string[] {
  return (Object.keys(DEPS) as (keyof typeof DEPS)[])
    .filter((id) => saved.includes(id) && refs.some((r) => reads(id, r)))
    .map((id) => ANALYSIS_LABEL[id]);
}

/** The blue note under the list; nothing when no saved result is affected. */
export function rerunNote(names: string[]): string | undefined {
  if (!names.length) return undefined;
  return `Reverting the selected ${names.length === 1 ? 'item changes' : 'items change'} data used by saved results: ${names.join(', ')}. They will need a rerun; the saved results are kept.`;
}
