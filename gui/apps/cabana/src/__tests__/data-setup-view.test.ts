// The Data setup page's view state: open entry, open section per file, and reviewed marks.

import { describe, expect, it } from 'vitest';
import { sectionsFor } from '../lib/file-sections.ts';
import { entry, openEntry, openSection, reviewed, sectionOf } from '../lib/data-setup-view.ts';
import { addFiles, clearAll } from '../lib/store.ts';

const stamps = () =>
  new File(['Frame Number,Time Stamp (ms)\n0,0\n1,33.3\n2,66.7\n'], 'neural_timestamps.csv');

describe('data setup view', () => {
  it('opens a file on its first section and ignores a section it does not have', () => {
    expect(sectionOf('neural_timestamps')).toBe(sectionsFor('neural_timestamps')[0]);
    openSection('neural_timestamps', 'arena');
    expect(sectionOf('neural_timestamps')).toBe(sectionsFor('neural_timestamps')[0]);
  });

  it('marks a file reviewed only once it is loaded and opened', async () => {
    clearAll();
    openEntry('neural_timestamps');
    expect(entry()).toBe('neural_timestamps');
    expect(reviewed('neural_timestamps')).toBe(false);
    await addFiles([stamps()]);
    expect(reviewed('neural_timestamps')).toBe(false);
    openEntry('neural_timestamps');
    expect(reviewed('neural_timestamps')).toBe(true);
  });

  it('marks checks and unassigned files reviewed when opened', () => {
    openEntry('sync');
    expect(reviewed('sync')).toBe(true);
    openEntry('file:notes.csv');
    expect(reviewed('file:notes.csv')).toBe(true);
  });
});

describe('entry pop-up', () => {
  it('opens for every entry but Get started and closes on request', async () => {
    const { closeEntry, popupOpen } = await import('../lib/data-setup-view.ts');
    openEntry('position', 'qc');
    expect(popupOpen()).toBe(true);
    closeEntry();
    expect(popupOpen()).toBe(false);
    expect(entry()).toBe('position');
    openEntry('start');
    expect(popupOpen()).toBe(false);
  });
});

describe('remove a file', () => {
  it('empties its slot and leaves the others', async () => {
    const { loaded, removeFile, slotFile } = await import('../lib/store.ts');
    clearAll();
    await addFiles([stamps(), new File(['frame,x,y\n0,1,1\n1,2,2\n'], 'position.csv')]);
    expect(loaded.position?.summary).toBeTruthy();
    removeFile('position');
    expect(loaded.position).toBeUndefined();
    expect(slotFile('position')).toBeUndefined();
    expect(loaded.neural_timestamps?.summary).toBeTruthy();
  });
});
