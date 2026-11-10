// A file's values as loaded, a window at a time: the rows of a table, or cells x frames of an
// array. Position rows inside a flagged jump or lost stretch are highlighted, so a QC finding can
// be checked against the numbers.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { setTableAt, tableAt } from '../../lib/data-setup-view.ts';
import { matrixWindow, tableWindow } from '../../lib/data-window.ts';
import { excludedRows } from '../../lib/position-corrections.ts';
import type { SlotId } from '../../lib/slots.ts';
import { slotMatrix, slotTable } from '../../lib/store.ts';
import { segments } from '../BehaviorQc.tsx';

const ROWS = 15;
const FRAMES = 8;

// The store keeps each file as read: an array has cells and frames, a table has rows.
const arrayOf = (slot: SlotId) => {
  const d = slotMatrix(slot);
  return d && 'frames' in d ? d : undefined;
};
const tableOf = (slot: SlotId) => {
  const d = slotTable(slot);
  return d && 'rows' in d ? d : undefined;
};

/** Whether a file has values to show as a table. Footprints are images, shown only as a map. */
export const hasTable = (slot: SlotId) =>
  slot !== 'footprints' && (!!tableOf(slot) || !!arrayOf(slot));

/** Position rows inside a flagged segment, and rows marked to leave out. */
const flaggedRows = createMemo(() => {
  const out = new Set<number>(excludedRows());
  for (const s of segments()) for (let i = s.first; i <= s.last; i++) out.add(i);
  return out;
});

export function DataTable(props: { slot: SlotId }): JSX.Element {
  const m = () => arrayOf(props.slot);
  const w = createMemo(() => {
    const p = tableAt(props.slot);
    const mm = m();
    if (mm) return matrixWindow(mm, p.row, ROWS, p.frame, FRAMES);
    const t = tableOf(props.slot);
    return t ? tableWindow(t, p.row, ROWS) : undefined;
  });
  const flag = (i: number) => props.slot === 'position' && flaggedRows().has(i);
  const go = (row: number) => setTableAt(props.slot, { row: Math.max(0, row) });
  const goFrame = (frame: number) => setTableAt(props.slot, { frame: Math.max(0, frame) });
  const word = () => (m() ? 'cells' : 'rows');
  return (
    <Show when={w()}>
      {(d) => (
        <div class="cb-ds-table">
          <div class="cb-ds-table__scroll">
            <table class="cb-ftab cb-ds-table__t">
              <thead>
                <tr>
                  <For each={d().columns}>{(c) => <th>{c}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={d().rows}>
                  {(r) => (
                    <tr classList={{ 'cb-ds-table__flag': flag(r.index) }}>
                      <td class="cb-muted">{r.label}</td>
                      <For each={r.values}>{(v) => <td>{v}</td>}</For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <div class="cb-ds-table__nav">
            <span class="cb-muted">
              {word()} {d().rows[0]?.index ?? 0}–{d().rows.at(-1)?.index ?? 0} of {d().total}
              {props.slot === 'position' ? ' · highlighted: flagged jumps and lost stretches' : ''}
            </span>
            <span class="cb-spacer" />
            <button
              class="btn-secondary btn-small"
              onClick={() => go(tableAt(props.slot).row - ROWS)}
            >
              ← Previous
            </button>
            <label>
              Go to {m() ? 'cell' : 'row'}{' '}
              <input
                type="number"
                min="0"
                value={tableAt(props.slot).row}
                onChange={(e) => go(e.currentTarget.valueAsNumber || 0)}
              />
            </label>
            <button
              class="btn-secondary btn-small"
              onClick={() => go(tableAt(props.slot).row + ROWS)}
            >
              Next →
            </button>
            <Show when={m()}>
              <label>
                frame{' '}
                <input
                  type="number"
                  min="0"
                  value={tableAt(props.slot).frame}
                  onChange={(e) => goFrame(e.currentTarget.valueAsNumber || 0)}
                />
              </label>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
