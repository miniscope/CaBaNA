// Data and pure helpers behind components/ActionsMenu.tsx.
// Rule: two panels at most. The menu itself is the first; a category item opens the second beside
// it, and a category inside the second replaces its contents in place (with Back), never a third.

export type MenuItem =
  | {
      kind: 'action';
      label: string;
      sub?: string;
      danger?: boolean;
      disabled?: string;
      onSelect: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | { kind: 'category'; label: string; items: MenuItem[] }
  /** One-of option: a mark column, shown on the chosen one. The menu stays open. */
  | { kind: 'one'; label: string; checked: boolean; onSelect: () => void }
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
