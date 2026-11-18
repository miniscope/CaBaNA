// The Project library start screen: sessions whose settings this browser kept, newest first,
// with the facts the saved settings hold. The browser cannot reopen a session's files by itself,
// so a recent session is reopened by choosing its folder again (see ProjectLibrary.tsx).

import { PARADIGMS } from './experiments.ts';
import type { SavedDataset } from './settings-template.ts';

export interface RecentSession {
  name: string;
  /** The experiment type, when one other than custom was chosen. */
  task?: string;
  /** When the settings were last saved, for display. */
  when: string;
  saved: SavedDataset;
}

/** "Today 14:32", "Yesterday 10:18", or "Nov 12" for older dates. */
export function savedWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** Saved sessions, newest first. */
export function recentSessions(list: SavedDataset[], now = new Date()): RecentSession[] {
  return [...list]
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map((d) => {
      const id = (d.settings.setup as { experiment?: unknown } | undefined)?.experiment;
      const task = id && id !== 'custom' ? PARADIGMS.find((p) => p.id === id)?.label : undefined;
      return { name: d.name, task, when: savedWhen(d.savedAt, now), saved: d };
    });
}
