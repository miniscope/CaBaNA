import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../lib/config-import.ts';
import { aurocDefaultUnselected, aurocSettings, seedAurocSelection } from '../lib/auroc-run.ts';
import { pethSettings, seedPethSelection } from '../lib/peth-run.ts';
import { agreement } from '../lib/frame-labels.ts';
import {
  activeLabel,
  blockedReason,
  clampPage,
  columnSample,
  conflictRows,
  conflictSummary,
  focusLabel,
  frameTime,
  oneSourceText,
  pageCount,
  pageSlice,
  rangeText,
  selectedIn,
  selectedInText,
  shortName,
  showLabel,
  takeFocus,
} from '../lib/label-view.ts';
import type { LabelEntry } from '../lib/labels.ts';
import { addFiles, frameLabelData, labelRegistry, loaded, slotFile, stepId } from '../lib/store.ts';

describe('paging', () => {
  it('counts pages and clamps', () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(34, 10)).toBe(4);
    expect(clampPage(9, 34, 10)).toBe(3);
    expect(clampPage(-1, 34, 10)).toBe(0);
  });
  it('slices and describes a page', () => {
    const items = Array.from({ length: 34 }, (_, i) => i);
    expect(pageSlice(items, 3, 10)).toEqual([30, 31, 32, 33]);
    expect(pageSlice(items, 99, 10)).toEqual([30, 31, 32, 33]);
    expect(rangeText(1, 34, 10)).toBe('11-20 of 34');
    expect(rangeText(0, 0, 10)).toBe('0 of 0');
  });
});

describe('names', () => {
  it('shortens long names for display only', () => {
    const name = 'approach_to_novel_object_zone_B_left';
    const shown = shortName(name, 20);
    expect(shown.length).toBeLessThanOrEqual(20);
    expect(shown).toContain('…');
    expect(shown.endsWith(name.slice(-6))).toBe(true);
    expect(name).toBe('approach_to_novel_object_zone_B_left');
    expect(shortName('grooming', 20)).toBe('grooming');
  });
  it("describes a column's values", () => {
    expect(columnSample(['0', '1', '', '0'])).toBe('0, 1, 1 blank');
    expect(columnSample(['grooming', 'rearing', 'grooming', ''])).toBe(
      'grooming, rearing, 1 blank',
    );
    expect(columnSample(['1.5', '20', '7', '3'])).toBe('1.5 to 20');
    expect(columnSample(['', ' '])).toBe('no values');
  });
});

describe('conflicts', () => {
  const frames = [10, 11, 12, 13, 14];
  const binary = { groom: [1, 1, 0, null, 0] as (0 | 1 | null)[] };
  const categorical = { behavior: ['groom', 'rear', 'rear', 'groom', null] as (string | null)[] };

  it('lists every conflicting frame by the same rule as agreement()', () => {
    const rows = conflictRows(frames, binary, categorical, ['groom']);
    expect(rows).toEqual([{ label: 'groom', frame: 11, binary: 1, categorical: 'rear' }]);
    const [a] = agreement(frames, binary, categorical);
    expect(rows.length).toBe(a.conflicts);
    expect(a.oneSourceOnly).toBe(2);
  });
  it('words the summary and keeps one-source frames apart', () => {
    const ag = agreement(frames, binary, categorical);
    expect(conflictSummary(ag)).toBe('1 conflict in groom.');
    expect(oneSourceText(ag)).toBe('2 frames are defined by one source only (not a conflict).');
    expect(conflictSummary([])).toBe('');
  });
  it('gives an actionable reason', () => {
    const entry = {
      name: 'groom',
      source: 'frame_binary',
      problems: ['x'],
      blocked: true,
    } as LabelEntry;
    const ag = [{ label: 'groom', conflicts: 5, firstFrames: [], oneSourceOnly: 0 }];
    expect(blockedReason(entry, ag)).toBe(
      'groom: 5 frames disagree between the binary column and the categorical column; edit the file or set one column to Ignore.',
    );
  });
  it('finds the time of a frame', () => {
    expect(frameTime(12, [10, 11, 12], [1, 2, 3])).toBe(3);
    expect(frameTime(99, [10, 11, 12], [1, 2, 3])).toBeUndefined();
    expect(frameTime(10, [10], [NaN])).toBeUndefined();
  });
});

describe('selected in', () => {
  const selections = [
    { analysis: 'auROC', available: ['a', 'b'], exclude: ['b'] },
    { analysis: 'PETH', available: ['a', 'b'] },
    { analysis: 'Population', include: ['b'] },
    { analysis: 'Decoding', available: ['a'], include: [] },
  ];
  it('reads the actual selections', () => {
    expect(selectedIn('a', selections)).toEqual(['auROC', 'PETH', 'Decoding']);
    expect(selectedIn('b', selections)).toEqual(['PETH', 'Population']);
    expect(selectedIn('c', selections)).toEqual([]);
  });
  it('says Not selected when none', () => {
    expect(selectedInText([])).toBe('Not selected');
    expect(selectedInText(['auROC', 'PETH'])).toBe('auROC, PETH');
  });
});

describe('starting selection without opening the analysis pages', () => {
  it('leaves out auROC behaviors that are not measured or have too few frames', () => {
    const info = [{ during: 5, outside: 100 }] as never;
    expect(aurocDefaultUnselected({ labels: ['b'], info })).toEqual(['b']);
  });
  it('seeds once, so Selected in no longer lists every label', () => {
    seedAurocSelection({ labels: ['a'], info: [{ during: 5, outside: 5 }] as never });
    seedPethSelection(['a']);
    const sel = [
      { analysis: 'auROC', available: ['a'], exclude: [...aurocSettings.unselected] },
      { analysis: 'PETH', available: ['a'], exclude: [...pethSettings.unselected] },
    ];
    expect(selectedIn('a', sel)).not.toContain('auROC');
    seedAurocSelection({ labels: ['a'], info: [{ during: 500, outside: 500 }] as never });
    expect(aurocSettings.unselected).toContain('a');
  });
});

describe('focus link', () => {
  it('is taken once by its target page and stays highlighted', () => {
    showLabel('setup', 'grooming', 'frame_labels.csv');
    expect(stepId()).toBe('setup');
    expect(takeFocus('load')).toBeUndefined();
    expect(takeFocus('setup')).toMatchObject({ name: 'grooming', file: 'frame_labels.csv' });
    expect(focusLabel()).toBeUndefined();
    expect(activeLabel()?.name).toBe('grooming');
  });
});

describe('simulated_frame_labels example', () => {
  const dir = resolve(process.cwd(), '../../../example_data/simulated_frame_labels');
  const file = (n: string) => new File([readFileSync(resolve(dir, n))], n);

  it('loads frame_labels.csv into the position and the frame-labels slots', async () => {
    await addFiles(['config.yaml', 'frame_labels.csv', 'behavior_timestamps.csv'].map(file));
    expect(loaded.position?.name).toBe('frame_labels.csv');
    expect(loaded.frame_labels?.name).toBe('frame_labels.csv');
    expect(slotFile('frame_labels')).toBe(slotFile('position'));
  });
  it('shows the five conflicts and blocks grooming', () => {
    const d = frameLabelData()!;
    expect(d.errors).toEqual([]);
    const rows = conflictRows(d.frames, d.binary, d.categorical, ['grooming']);
    expect(rows.map((r) => r.frame)).toEqual([1242, 2740, 2971, 3526, 5596]);
    expect(
      labelRegistry()
        .filter((e) => e.name === 'grooming')
        .every((e) => e.blocked),
    ).toBe(true);
  });
});
