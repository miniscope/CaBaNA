// What the header's Saved indicator says. It starts as engine-off until the engine is found.

import { createSignal } from 'solid-js';

export interface SavedFile {
  name: string;
  at: Date;
}

export type SaveStatus =
  | { kind: 'saved'; at: Date; dir: string; files: SavedFile[] }
  | { kind: 'saving' }
  | { kind: 'engine-off' }
  /** The engine is on but no project is open (files not saved to a project yet). */
  | { kind: 'no-project' }
  /** Example data: a project that has not been saved yet. */
  | { kind: 'example' }
  /** The engine refused a write. */
  | { kind: 'error'; message: string }
  /** Manual saving mode with edits not yet written. */
  | { kind: 'unsaved' };

export type SaveTone = 'neutral' | 'flag' | 'accent';

const [saveStatus, setSaveStatus] = createSignal<SaveStatus>({ kind: 'engine-off' });
export { saveStatus, setSaveStatus };

/** 24-hour clock, as in "Saved 10:42". */
export function clockText(at: Date): string {
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function saveText(status: SaveStatus): { text: string; tone: SaveTone } {
  switch (status.kind) {
    case 'saved':
      return { text: `Saved ${clockText(status.at)}`, tone: 'neutral' };
    case 'saving':
      return { text: 'Saving…', tone: 'neutral' };
    case 'engine-off':
      return { text: 'Not saved: engine off', tone: 'flag' };
    case 'no-project':
      return { text: 'Not saved: no project open', tone: 'flag' };
    case 'example':
      return { text: 'Example data · Unsaved', tone: 'neutral' };
    case 'error':
      return { text: 'Not saved: engine error', tone: 'flag' };
    case 'unsaved':
      return { text: 'Unsaved changes · Save project', tone: 'accent' };
  }
}

/** More than the indicator's words, for the readings that are not in the list below. */
export function saveNote(status: SaveStatus): string | undefined {
  if (status.kind === 'no-project')
    return 'Files loaded without a project are not saved. Start a project with + Project.';
  if (status.kind === 'example')
    return 'Example data is a project that has not been saved yet. Save it with Manage project → Save as project…, which keeps the work done so far.';
  if (status.kind === 'error') return status.message;
  return undefined;
}

/** The readings of the indicator, explained in its popover. */
export const SAVE_STATES: { text: string; tone: SaveTone; detail: string }[] = [
  { text: 'Saved 10:42', tone: 'neutral', detail: 'All changes are in the project folder.' },
  {
    text: 'Example data · Unsaved',
    tone: 'neutral',
    detail: 'Not in a project folder yet (Manage project → Save as project…).',
  },
  { text: 'Saving…', tone: 'neutral', detail: 'Written about a second after a change stops.' },
  {
    text: 'Not saved: engine off',
    tone: 'flag',
    detail: 'Work is kept in this browser and written when the engine is back.',
  },
  {
    text: 'Unsaved changes · Save project',
    tone: 'accent',
    detail: 'Only with manual saving (Project settings → Saving).',
  },
];
