// View-only choices of Data visualization: what the plots draw, never the data or the results.
// Kept at module level so the choices stay while other pages are visited.

import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { onClear } from './store.ts';

/** Path of the animal, or the time spent in each arena bin. */
export const [trajMode, setTrajMode] = createSignal<'path' | 'time'>('path');

/** What the arena box draws; the picture of the arena itself is always shown. */
const ARENA_DEFAULT = { full: true, window: true, cursor: true, zones: true, excluded: true };
export const [arenaShow, setArenaShow] = createStore({ ...ARENA_DEFAULT });

export type CellVisibility = 'all' | 'hide-rejected' | 'flagged';

/** Rings on the footprint map, outlines of the cells, and which cells are drawn. */
const FOOTPRINT_DEFAULT = { flagged: true, overlap: true, selected: true, outlines: false };
export const [footprintShow, setFootprintShow] = createStore({ ...FOOTPRINT_DEFAULT });
export const [cellVisibility, setCellVisibility] = createSignal<CellVisibility>('all');

/**
 * Whether a cell is drawn on the footprint map. The selected cell is always drawn, so selecting
 * from another plot never leaves nothing to see.
 */
export function cellDrawn(
  cell: number,
  mode: CellVisibility,
  rejected: ReadonlySet<number>,
  flagged: ReadonlySet<number>,
  selected: number,
): boolean {
  if (cell === selected || mode === 'all') return true;
  return mode === 'hide-rejected' ? !rejected.has(cell) : flagged.has(cell);
}

onClear(() => {
  setTrajMode('path');
  setArenaShow(reconcile({ ...ARENA_DEFAULT }));
  setFootprintShow(reconcile({ ...FOOTPRINT_DEFAULT }));
  setCellVisibility('all');
});
