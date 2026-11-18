// Opening the arena editor from the Experimental setup pop-up and coming back to it on close.

import { createSignal } from 'solid-js';
import { closeEntry, openEntry, openSection } from '../../lib/data-setup-view.ts';

const [fromSetup, setFromSetup] = createSignal(false);

/** The arena editor is the position file's Arena and zones section; it also works with no file loaded. */
export function openArenaEditor(): void {
  setFromSetup(true);
  openEntry('position', 'arena');
}

/** Close the arena editor; when it was opened from Experimental setup, return to that pop-up. */
export function closeArenaEditor(): void {
  openSection('position', 'overview');
  if (fromSetup()) {
    setFromSetup(false);
    openEntry('config');
  } else closeEntry();
}
