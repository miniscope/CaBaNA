// Data types the user names with Other… on Data setup ("Lick sensor"). Each has an id other_<n>,
// the name, and its file once one is added. They are listed with the project (the engine keeps the
// name in project.yaml as data_labels) and are never read or analyzed.

import { createStore, produce } from 'solid-js/store';
import type { OtherId } from './slots.ts';

export interface OtherType {
  id: OtherId;
  name: string;
  /** The file added for it: its name and size, and where it is on disk when known. */
  file?: { name: string; size: number; path?: string };
}

const [others, setOthers] = createStore<OtherType[]>([]);
export { others };

/** The next free id: one more than the highest in use. */
export const nextOtherId = (list: { id: string }[]): OtherId =>
  `other_${Math.max(0, ...list.map((o) => Number(o.id.slice(6)) || 0)) + 1}`;

/** Add an unnamed data type and return its id. */
export function addOther(name = '', file?: OtherType['file']): OtherId {
  const id = nextOtherId(others);
  setOthers(others.length, { id, name, file });
  return id;
}

export function renameOther(id: OtherId, name: string): void {
  setOthers((o) => o.id === id, 'name', name);
}

export function setOtherFile(id: OtherId, file: OtherType['file']): void {
  setOthers((o) => o.id === id, 'file', file);
}

export function removeOther(id: OtherId): void {
  setOthers(
    produce(
      (list) =>
        void list.splice(
          list.findIndex((o) => o.id === id),
          1,
        ),
    ),
  );
}

/** Put back the named data types of an opened project, or forget them all. */
export function setAllOthers(list: OtherType[]): void {
  setOthers(list);
}

/** How many named data types have a file: each counts as a behavioral activity file. */
export const othersWithFiles = (): number => others.filter((o) => o.file).length;
