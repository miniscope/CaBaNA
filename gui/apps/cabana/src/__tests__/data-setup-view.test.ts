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

describe('experiment config sections', () => {
  it('opens one section at a time, on its key fields', async () => {
    const { configAll, configOpen, toggleAllFields, toggleConfigSection } =
      await import('../lib/data-setup-view.ts');
    expect(configOpen()).toBeUndefined();
    toggleConfigSection('spatial');
    expect([configOpen(), configAll()]).toEqual(['spatial', false]);
    toggleAllFields('spatial');
    expect(configAll()).toBe(true);
    toggleConfigSection('session');
    expect([configOpen(), configAll()]).toEqual(['session', false]);
    toggleAllFields('tracking');
    expect([configOpen(), configAll()]).toEqual(['tracking', true]);
    toggleConfigSection('tracking');
    expect(configOpen()).toBeUndefined();
  });
});
