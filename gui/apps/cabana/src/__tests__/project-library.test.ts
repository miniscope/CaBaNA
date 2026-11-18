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

describe('project pages and renaming', () => {
  it('knows which pages are not workflow steps', async () => {
    const { isProjectPage } = await import('../lib/store.ts');
    for (const id of ['welcome', 'new', 'library', 'about']) expect(isProjectPage(id)).toBe(true);
    for (const id of ['data', 'viz', 'analyze', 'results']) expect(isProjectPage(id)).toBe(false);
  });

  it('opens on Welcome and closing a session returns there', async () => {
    const { closeSession, goToStep, stepId } = await import('../lib/store.ts');
    expect(stepId()).toBe('welcome');
    goToStep('data');
    closeSession();
    expect(stepId()).toBe('welcome');
  });

  it('keeps the saved settings under the new name', async () => {
    // The list is read from the browser when the module loads, so it is seeded first.
    localStorage.setItem(
      'cabana.settings-by-dataset',
      JSON.stringify([ds('old', at(1, 8)), ds('new', at(2, 8))]),
    );
    const { renameSaved, savedDatasets } = await import('../lib/settings-template.ts');
    const { setSessionName } = await import('../lib/store.ts');
    setSessionName('other');
    renameSaved('old', 'new');
    expect(savedDatasets().map((d) => d.name)).toEqual(['new']);
    expect(savedDatasets()[0].savedAt).toBe(at(1, 8));
  });
});
