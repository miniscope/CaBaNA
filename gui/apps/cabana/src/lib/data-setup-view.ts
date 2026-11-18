// View state of the Data setup page: which entry is open, each file's open section, and which
// entries have been opened (reviewed). Kept at module level so the page keeps its place when
// another step is visited. Reviewing is never required; it only marks what has been looked at.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import { sectionsFor, type SectionId } from './file-sections.ts';
import { SLOTS, type SlotId } from './slots.ts';
import { goToStep, loaded, sessionName, unrecognized } from './store.ts';

/** Get started, a data type, the cross-data timing check, or an unassigned file (by name). */
export type EntryId = 'start' | SlotId | 'sync' | `file:${string}`;

export const [entry, setEntry] = createSignal<EntryId>('start');

/** Nothing loaded, not even a file that failed to read or matched no data type: the start screen. */
export const nothingLoaded = (): boolean =>
  !SLOTS.some((s) => loaded[s.id]) && !unrecognized().length;

/** The line shown after settings from another session were applied; cleared with the session. */
export const [appliedNote, setAppliedNote] = createSignal<string>();
const [section, setSection] = createStore<Partial<Record<string, SectionId>>>({});
const [opened, setOpened] = createStore<Record<string, boolean>>({});

const isSlot = (id: EntryId): id is SlotId =>
  id !== 'start' && id !== 'sync' && !id.startsWith('file:');

/** The open section of a data type; its first section until another is chosen. */
export function sectionOf(slot: SlotId): SectionId {
  const list = sectionsFor(slot);
  const s = section[slot];
  return s && list.includes(s) ? s : list[0];
}

/** Whether the open entry is shown in its pop-up over the Data setup page. */
export const [popupOpen, setPopupOpen] = createSignal(false);
export const closeEntry = () => setPopupOpen(false);

/**
 * Open an entry in the pop-up, and optionally one of its sections. A loaded file counts as
 * reviewed. Get started has no pop-up: it is the Project library.
 */
export function openEntry(id: EntryId, sec?: SectionId): void {
  setEntry(id);
  setPopupOpen(id !== 'start');
  if (sec && isSlot(id)) setSection(id, sec);
  if (id !== 'start' && (!isSlot(id) || loaded[id]?.summary)) setOpened(id, true);
}

export function openSection(slot: SlotId, sec: SectionId): void {
  setSection(slot, sec);
}

export const reviewed = (id: EntryId): boolean => !!opened[id];

/** Mark an entry reviewed without opening it (a QC or Preprocess pop-up was applied or continued). */
export const markReviewed = (id: EntryId): void => setOpened(id, true);

/** Overview of a file: its plots, or its values as a table. */
const [view, setViewOf] = createStore<Partial<Record<string, 'plot' | 'table'>>>({});
export const viewOf = (slot: SlotId) => view[slot] ?? 'plot';
export const setView = (slot: SlotId, v: 'plot' | 'table') => setViewOf(slot, v);

/** Where the data table of each file starts: its first row (or cell) and, for arrays, frame. */
const [at, setAt] = createStore<Partial<Record<string, { row: number; frame: number }>>>({});
export const tableAt = (slot: SlotId) => at[slot] ?? { row: 0, frame: 0 };
export function setTableAt(slot: SlotId, p: Partial<{ row: number; frame: number }>): void {
  setAt(slot, { ...tableAt(slot), ...p });
}

/** Go to Data setup with an entry (and section) open: the link target for the former steps. */
export function openData(id: EntryId, sec?: SectionId): void {
  openEntry(id, sec);
  goToStep('data');
}

// A new dataset starts with nothing reviewed.
createRoot(() =>
  createEffect(
    on(
      sessionName,
      () => {
        setOpened((o) => Object.fromEntries(Object.keys(o).map((k) => [k, false])));
        setAppliedNote(undefined);
      },
      { defer: true },
    ),
  ),
);
