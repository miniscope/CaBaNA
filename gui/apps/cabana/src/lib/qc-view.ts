// What the user is looking at on the Data QC page. Kept here, outside the panels, so switching
// category, tab or step keeps the selection, the plot zoom and the open sections.

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

export type QcTab = 'behavior' | 'neural';
export const [qcTab, setQcTab] = createSignal<QcTab>('behavior');
/** The selected category in each tab. */
export const [qcCategory, setQcCategory] = createStore<Record<QcTab, string>>({
  behavior: 'timing',
  neural: 'cells',
});

/** Categories the user marked as reviewed. Changes only the label: checks and pass or fail stay the same. */
export const [reviewed, setReviewed] = createStore<Record<string, boolean>>({});

/** Selected item in each list (flagged segments, flagged epochs of each file, flagged cells). */
export const [picked, setPicked] = createStore<Record<string, number>>({});
/** The page shown in each list. */
export const [listPage, setListPage] = createStore<Record<string, number>>({});

/** Time range shown in the position plots, in seconds; undefined is the whole session. */
export const [posRange, setPosRange] = createSignal<[number, number] | undefined>();

/** The open one of the folding right-hand boxes (Settings, Correction). */
export const [openFold, setOpenFold] = createSignal<string | undefined>('settings');
