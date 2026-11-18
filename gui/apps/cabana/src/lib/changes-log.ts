// A log of every correction applied or undone and every preprocessing setting changed in this
// window, for the History tab of Changes. It only records what the existing actions did; it is
// kept in memory and cleared with the session. Nothing reads it to change data.

import { createSignal } from 'solid-js';

export type LogAction = 'apply' | 'undo' | 'change';
export type LogGroup = 'correction' | 'prep';

export interface LogEvent {
  /** Milliseconds since the epoch. */
  at: number;
  action: LogAction;
  group: LogGroup;
  text: string;
}

const [history, setHistory] = createSignal<LogEvent[]>([]);
export { history };

/** Add one event, stamped with the current time. */
export function logChange(action: LogAction, group: LogGroup, text: string): void {
  setHistory((h) => [...h, { at: Date.now(), action, group, text }]);
}

export const clearHistory = () => setHistory([]);

/** When something matching `text` was last applied or changed, for the time beside an entry. */
export function lastApplied(match: (e: LogEvent) => boolean): number | undefined {
  const h = history();
  for (let i = h.length - 1; i >= 0; i--) if (h[i].action !== 'undo' && match(h[i])) return h[i].at;
  return undefined;
}

/** "Cell 4", or "Cells 4, 9 and 12" (1-based, as the cell lists show them). */
export function cellsText(cells: number[]): string {
  const ids = [...cells].sort((a, b) => a - b).map((c) => String(c + 1));
  if (ids.length === 1) return `Cell ${ids[0]}`;
  const shown = ids.length > 6 ? [...ids.slice(0, 5), `${ids.length - 5} more`] : ids;
  return `Cells ${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}
