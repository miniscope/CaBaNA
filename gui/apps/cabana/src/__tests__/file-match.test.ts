// Which data type each file goes to: what New Project previews is what addFiles loads.

import { describe, expect, it } from 'vitest';
import { findConfig, placeFiles, previewPlacements } from '../lib/file-match.ts';
import { defaultProjectName, formatBytes, mergeHeld, requiredNote } from '../lib/new-project.ts';

const file = (name: string, text = '', path?: string) => {
  const f = new File([text], name);
  if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};
const CONFIG = 'neural:\n  timestamps: stamps_a.csv\nbehavior: {}\n';

describe('placeFiles', () => {
  it('matches by name and leaves other files unmatched', () => {
    const [a, b, c] = placeFiles(
      [file('neural_timestamps.csv'), file('position.csv'), file('README.md')],
      undefined,
      {},
    );
    expect(a.slots).toEqual(['neural_timestamps']);
    expect(b.slots).toEqual(['position']);
    expect(c.slots).toEqual([]);
  });

  it('puts a YAML file that is not the config nowhere', () => {
    expect(placeFiles([file('notes.yaml')], undefined, {})[0].slots).toEqual([]);
  });

  it('lets the config name decide before the file name', () => {
    const f = file('stamps_a.csv');
    expect(placeFiles([f], undefined, { neural_timestamps: 'stamps_a.csv' })[0].slots).toEqual([
      'neural_timestamps',
    ]);
  });

  it('fills frame labels too when another slot claims a frame-label file', () => {
    const f = file('frame_labels.csv');
    expect(placeFiles([f], undefined, { position: 'frame_labels.csv' })[0].slots).toEqual([
      'position',
      'frame_labels',
    ]);
  });

  it('sends every file to the given slot', () => {
    expect(placeFiles([file('x.csv')], undefined, {}, 'position')[0].slots).toEqual(['position']);
  });
});

describe('config detection and preview', () => {
  it('finds the config by content, not by name', async () => {
    const cfg = file('my_experiment.yaml', CONFIG);
    expect(await findConfig([file('notes.yaml', 'a: 1'), cfg])).toBe(cfg);
  });

  it('previews the placements a load would make', async () => {
    const out = await previewPlacements([
      file('my_experiment.yaml', CONFIG),
      file('stamps_a.csv'),
      file('README.md'),
    ]);
    expect(out.map((p) => p.slots)).toEqual([['config'], ['neural_timestamps'], []]);
  });
});

describe('New Project list', () => {
  it('names the project after the shared folder, else by date', () => {
    const inFolder = [file('a.csv', '', 'run1/a.csv'), file('b.csv', '', 'run1/sub/b.csv')];
    expect(defaultProjectName(inFolder)).toBe('run1');
    expect(
      defaultProjectName([file('a.csv', '', 'x/a.csv'), file('b.csv', '', 'y/b.csv')]),
    ).toMatch(/^Project \d{4}-\d{2}-\d{2}$/);
    expect(defaultProjectName([file('a.csv')], new Date(2026, 10, 18))).toBe('Project 2026-11-18');
  });

  it('replaces a file picked again and keeps the rest', () => {
    const a1 = file('a.csv');
    const a2 = file('a.csv');
    const b = file('b.csv');
    expect(mergeHeld([a1, b], [a2])).toEqual([b, a2]);
  });

  it('formats sizes and names the missing required files', () => {
    expect(formatBytes(627)).toBe('627 B');
    expect(formatBytes(122_000)).toBe('122 KB');
    expect(formatBytes(6_480_128)).toBe('6.5 MB');
    expect(
      requiredNote(new Set(['neural_timestamps', 'neural_deconvolved', 'behavior_timestamps'])).ok,
    ).toBe(true);
    expect(requiredNote(new Set(['neural_timestamps'])).missing).toEqual([
      'Deconvolved events',
      'Behavioral timestamps',
    ]);
  });
});
