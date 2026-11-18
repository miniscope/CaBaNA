// View state of the Data setup page: which entry is open, each file's open section, and which
// entries have been opened (reviewed). Kept at module level so the page keeps its place when
// another step is visited. Reviewing is never required; it only marks what has been looked at.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
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

/** Open an entry, and optionally one of its sections. A loaded file counts as reviewed. */
export function openEntry(id: EntryId, sec?: SectionId): void {
  setEntry(id);
  if (sec && isSlot(id)) setSection(id, sec);
  if (id !== 'start' && (!isSlot(id) || loaded[id]?.summary)) setOpened(id, true);
}

export function openSection(slot: SlotId, sec: SectionId): void {
  setSection(slot, sec);
}

export const reviewed = (id: EntryId): boolean => !!opened[id];

/** Steps of a file that have been shown, and optional steps skipped, by `slot|section`. */
const [visits, setVisits] = createStore<Record<string, 'visited' | 'skipped'>>({});
const key = (slot: SlotId, sec: SectionId) => `${slot}|${sec}`;
export const visited = (slot: SlotId, sec: SectionId) => !!visits[key(slot, sec)];
export const skipped = (slot: SlotId, sec: SectionId) => visits[key(slot, sec)] === 'skipped';
/** Mark a step visited. A skipped step stays skipped unless the user opens it on purpose. */
export function markVisited(slot: SlotId, sec: SectionId, onPurpose = false): void {
  if (onPurpose || !visits[key(slot, sec)]) setVisits(key(slot, sec), 'visited');
}
export const markSkipped = (slot: SlotId, sec: SectionId) => setVisits(key(slot, sec), 'skipped');

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

/** Open a file's table at a row, from a QC finding. */
export function showRows(slot: SlotId, row: number): void {
  openEntry(slot, 'overview');
  setView(slot, 'table');
  setTableAt(slot, { row });
}

// A new dataset starts with nothing reviewed.
createRoot(() =>
  createEffect(
    on(
      sessionName,
      () => {
        setOpened((o) => Object.fromEntries(Object.keys(o).map((k) => [k, false])));
        setAppliedNote(undefined);
        setVisits(reconcile({}));
      },
      { defer: true },
    ),
  ),
);

/**
 * Experiment config: the one section showing all its fields. With none, every section shows its
 * key fields; with one, the others fold to their header bars with a summary.
 */
export const [configOpen, setConfigOpen] = createSignal<string>();
/** Show all fields of a section, or every section's key fields again when it is the open one. */
export const toggleAllFields = (id: string) => setConfigOpen(configOpen() === id ? undefined : id);
