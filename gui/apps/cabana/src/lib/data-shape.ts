// The data shape shown on each Data setup row, from the loaded data: "(9,000)" for timestamps,
// "(180, 9,000)" for traces, "(180, 160, 160)" for footprints, "(15,002, 2)" for tables (value
// columns, without the frame or time column), "30 bouts" for annotations and "640 × 480 px" for
// the behavior video frame.

import type { SlotId } from './slots.ts';

const n = (x: number) => x.toLocaleString('en-US');
export const dims = (...xs: number[]): string => `(${xs.map(n).join(', ')})`;
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/** Columns that number or time the rows rather than hold values. */
const INDEX_COLUMN = /^\s*(frame|time\s*stamp|timestamp|time)\b/i;

/** What was loaded, as much of it as the shape needs. */
export type Loaded =
  | { kind: 'matrix'; cells: number; frames: number }
  | { kind: 'footprints'; cells: number; height: number; width: number }
  | { kind: 'table'; columns: string[]; rows: number }
  | { kind: 'count'; count: number }
  | { kind: 'image'; width: number; height: number };

export function shapeText(slot: SlotId, d: Loaded): string {
  switch (d.kind) {
    case 'matrix':
      return dims(d.cells, d.frames);
    case 'footprints':
      return dims(d.cells, d.height, d.width);
    case 'image':
      return `${n(d.width)} × ${n(d.height)} px`;
    case 'count':
      return slot === 'zone_annotations'
        ? plural(d.count, 'epoch', 'epochs')
        : slot === 'time_markers'
          ? plural(d.count, 'marker', 'markers')
          : plural(d.count, 'bout', 'bouts');
    case 'table':
      if (slot === 'neural_timestamps' || slot === 'behavior_timestamps') return dims(d.rows);
      return dims(d.rows, d.columns.filter((c) => !INDEX_COLUMN.test(c)).length);
  }
}
