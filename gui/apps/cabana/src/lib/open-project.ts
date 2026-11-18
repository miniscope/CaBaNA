// The project open in this window, if any, and the state of its data files. Kept apart from the
// open and save code so both can read it.

import { createSignal } from 'solid-js';
import type { DataFile, ProjectSummary } from './projects-client.ts';
import type { SlotId } from './slots.ts';

export const [openProject, setOpenProject] = createSignal<ProjectSummary>();
/** Data files of the open project with their status when it was opened. */
export const [dataFiles, setDataFiles] = createSignal<DataFile[]>([]);

/** The registered file of a data type, when the project has one. */
export const dataFileOf = (slot: SlotId): DataFile | undefined =>
  dataFiles().find((f) => f.slot === slot);

/** A file the project lists but could not be found at its recorded path. */
export const missingFileOf = (slot: SlotId): DataFile | undefined => {
  const f = dataFileOf(slot);
  return f?.status === 'missing' ? f : undefined;
};
