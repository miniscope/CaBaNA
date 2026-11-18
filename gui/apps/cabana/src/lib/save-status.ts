// What the header's Saved indicator says. Nothing writes to disk yet, so it starts as engine-off.

import { createSignal } from 'solid-js';

export interface SavedFile {
  name: string;
  at: Date;
}

export type SaveStatus =
  | { kind: 'saved'; at: Date; dir: string; files: SavedFile[] }
  | { kind: 'saving' }
  | { kind: 'engine-off' }
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
    case 'unsaved':
      return { text: 'Unsaved changes · Save project', tone: 'accent' };
  }
}

/** The four readings of the indicator, explained in its popover. */
export const SAVE_STATES: { text: string; tone: SaveTone; detail: string }[] = [
  { text: 'Saved 10:42', tone: 'neutral', detail: 'All changes are in the project folder.' },
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
