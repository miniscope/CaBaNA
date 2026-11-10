// View state of the Data setup page: which entry is open, each file's open section, and which
// entries have been opened (reviewed). Kept at module level so the page keeps its place when
// another step is visited. Reviewing is never required; it only marks what has been looked at.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import { sectionsFor, type SectionId } from './file-sections.ts';
import type { SlotId } from './slots.ts';
import { loaded, sessionName } from './store.ts';

/** A data type, the cross-data timing check, or an unassigned file (by name). */
export type EntryId = SlotId | 'sync' | `file:${string}`;

export const [entry, setEntry] = createSignal<EntryId>('neural_deconvolved');
const [section, setSection] = createStore<Partial<Record<string, SectionId>>>({});
const [opened, setOpened] = createStore<Record<string, boolean>>({});

const isSlot = (id: EntryId): id is SlotId => id !== 'sync' && !id.startsWith('file:');

/** The open section of a data type; its first section until another is chosen. */
export function sectionOf(slot: SlotId): SectionId {
  const list = sectionsFor(slot);
  const s = section[slot];
  return s && list.includes(s) ? s : list[0];
}

/** Open an entry, and optionally one of its sections. A loaded file counts as reviewed. */
export function openEntry(id: EntryId, sec?: SectionId): void {
  setEntry(id);
  if (sec && isSlot(id)) setSection(id, sec);
  if (!isSlot(id) || loaded[id]?.summary) setOpened(id, true);
}

export function openSection(slot: SlotId, sec: SectionId): void {
  setSection(slot, sec);
}

export const reviewed = (id: EntryId): boolean => !!opened[id];

// A new dataset starts with nothing reviewed.
createRoot(() =>
  createEffect(
    on(
      sessionName,
      () => setOpened((o) => Object.fromEntries(Object.keys(o).map((k) => [k, false]))),
      { defer: true },
    ),
  ),
);
