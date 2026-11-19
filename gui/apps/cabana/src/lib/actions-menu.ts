// Data and pure helpers behind components/ActionsMenu.tsx.
// Rule: two panels at most. The menu itself is the first; a category item opens the second beside
// it, and a category inside the second replaces its contents in place (with Back), never a third.
// Hover timing lives here as a small reducer so it can be tested without a browser: the component
// only turns `pending` into a real timer and sends `timer-fired` when it runs out.

export type MenuItem =
  | {
      kind: 'action';
      label: string;
      sub?: string;
      danger?: boolean;
      disabled?: string;
      /** Leave the menu open after the action (a view setting that updates the plot at once). */
      keepOpen?: boolean;
      onSelect: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | { kind: 'category'; label: string; items: MenuItem[] }
  /** One-of option: a mark column, shown on the chosen one. The menu stays open. */
  | {
      kind: 'one';
      label: string;
      checked: boolean;
      /** Why the option cannot be chosen; shown on the row. */
      disabled?: string;
      onSelect: () => void;
    }
  /** Many-of option: a checkbox. The menu stays open. */
  | { kind: 'many'; label: string; checked: boolean; onToggle: (next: boolean) => void };

export type MenuSource = MenuItem[] | (() => MenuItem[]);

export interface ResolvedPanel {
  /** Contents of the second panel; null when only the menu is open. */
  items: MenuItem[] | null;
  /** Category name shown as the small-caps header after Back; null at the panel's first level. */
  title: string | null;
  canGoBack: boolean;
  /** Label of the menu's own category item that owns the second panel. */
  owner: string | null;
}

/** Which panel contents the category path selects. A label no longer in the items ends the walk. */
export function resolvePanel(items: MenuItem[], path: string[]): ResolvedPanel {
  let current = items;
  const walked: string[] = [];
  for (const label of path) {
    const next = current.find((i) => i.kind === 'category' && i.label === label);
    if (!next || next.kind !== 'category') break;
    current = next.items;
    walked.push(label);
  }
  if (!walked.length) return { items: null, title: null, canGoBack: false, owner: null };
  const nested = walked.length > 1;
  return {
    items: current,
    title: nested ? walked[walked.length - 1] : null,
    canGoBack: nested,
    owner: walked[0],
  };
}

/** The row to focus after an arrow key; wraps around. Returns null for keys that do not move. */
export function stepFocus(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Pointer rests on a different category row this long before the submenu switches to it. */
export const SWITCH_DELAY_MS = 120;
/** The submenu closes this long after the pointer has left both the parent row and the submenu. */
export const CLOSE_DELAY_MS = 300;

export interface HoverState {
  /** Label of the menu's category row whose submenu is showing. */
  open: string | null;
  /** Opened by a click: stays until another category is clicked, Escape, or the menu closes. */
  pinned: boolean;
  /** What happens when the timer runs out; the component keeps at most one timer for it. */
  pending: { kind: 'switch' | 'close'; label: string | null } | null;
}

export type HoverEvent =
  | { type: 'enter-category'; label: string }
  | { type: 'enter-action' }
  | { type: 'leave' }
  | { type: 'enter-submenu' }
  | { type: 'click-category'; label: string }
  | { type: 'timer-fired' }
  | { type: 'escape' };

export const HOVER_START: HoverState = { open: null, pinned: false, pending: null };

export function pendingDelay(state: HoverState): number {
  return state.pending?.kind === 'switch' ? SWITCH_DELAY_MS : CLOSE_DELAY_MS;
}

export function hoverStep(state: HoverState, event: HoverEvent): HoverState {
  const idle = { ...state, pending: null };
  const closeSoon = (): HoverState =>
    state.pinned || state.open === null
      ? idle
      : { ...state, pending: { kind: 'close', label: null } };
  switch (event.type) {
    case 'enter-category':
      if (state.pinned || state.open === event.label) return idle;
      // Nothing showing yet: open at once. Otherwise wait for the pointer to rest.
      if (state.open === null) return { ...idle, open: event.label };
      return { ...state, pending: { kind: 'switch', label: event.label } };
    case 'enter-action':
    case 'leave':
      return closeSoon();
    case 'enter-submenu':
      return idle;
    case 'click-category':
      return { open: event.label, pinned: true, pending: null };
    case 'timer-fired':
      if (state.pending?.kind === 'switch') return { ...idle, open: state.pending.label };
      if (state.pending?.kind === 'close') return { ...idle, open: null };
      return state;
    case 'escape':
      return HOVER_START;
  }
}
