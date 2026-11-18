// Recent sessions on the Project library: newest first, with the experiment type and a short date.

import { describe, expect, it } from 'vitest';
import { recentSessions, savedWhen } from '../lib/project-library.ts';
import type { SavedDataset } from '../lib/settings-template.ts';

const now = new Date(2026, 10, 17, 15, 0);
const at = (d: number, h: number) => new Date(2026, 10, d, h, 5).toISOString();
const ds = (name: string, savedAt: string, experiment?: string): SavedDataset => ({
  name,
  savedAt,
  settings: experiment ? { setup: { experiment } } : {},
});

describe('recent sessions', () => {
  it('says today, yesterday, or the date', () => {
    expect(savedWhen(at(17, 9), now)).toMatch(/^Today 09:05$/);
    expect(savedWhen(at(16, 22), now)).toMatch(/^Yesterday 22:05$/);
    expect(savedWhen(at(12, 9), now)).not.toMatch(/Today|Yesterday|2026/);
    expect(savedWhen(new Date(2025, 0, 3).toISOString(), now)).toMatch(/2025/);
    expect(savedWhen('not a date', now)).toBe('');
  });

  it('lists the newest first and names the experiment type unless it is custom', () => {
    const list = recentSessions(
      [ds('M23', at(16, 10), 'custom'), ds('M24', at(17, 14), 'open_field'), ds('old', at(1, 8))],
      now,
    );
    expect(list.map((r) => r.name)).toEqual(['M24', 'M23', 'old']);
    expect(list[0].task).toBe('Open field');
    expect(list[1].task).toBeUndefined();
    expect(list[2].task).toBeUndefined();
  });
});
