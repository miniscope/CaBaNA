import { describe, expect, it } from 'vitest';
import { analysesFromYaml } from '../lib/project-sources.ts';
import {
  differenceTexts,
  exportSizes,
  exportTotal,
  sizeText,
  storageRows,
  viewLines,
} from '../lib/project-view.ts';
import type { FileChange, StorageReport } from '../lib/projects-client.ts';

const report: StorageReport = {
  total_bytes: 0,
  runs: [],
  categories: [
    { id: 'processed', label: 'Processed', bytes: 48e6, deletable: true },
    { id: 'config', label: 'Config', bytes: 2e5, deletable: false },
    { id: 'data', label: 'Data', bytes: 39.4e6, deletable: false },
    { id: 'current_runs', label: 'Current', bytes: 10e6, deletable: false },
    { id: 'old_runs', label: 'Old', bytes: 2.6e6, deletable: true },
    { id: 'figures', label: 'Figures', bytes: 3.1e6, deletable: true },
  ],
};

describe('storage and export', () => {
  it('words sizes', () => {
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(39.4e6)).toBe('39.4 MB');
    expect(sizeText(2e5)).toBe('0.2 MB');
  });

  it('lists storage in the order of the section, with what each delete does', () => {
    const rows = storageRows(report);
    expect(rows.map((r) => r.id)).toEqual([
      'data',
      'config',
      'current_runs',
      'old_runs',
      'figures',
      'processed',
    ]);
    expect(rows.find((r) => r.id === 'processed')!.consequence).toMatch(/made again/);
  });

  it('adds up what the export holds for the chosen parts', () => {
    const sizes = exportSizes(report);
    expect(sizes.results).toBe(12.6e6);
    expect(exportTotal(sizes, { results: false, figures: false, data: false })).toBe(2e5);
    expect(exportTotal(sizes, { results: true, figures: true, data: false })).toBe(
      2e5 + 12.6e6 + 3.1e6,
    );
  });
});

describe('file viewer', () => {
  const now = 'a: 1\nb: 3\nc: 4\nd: 5\n';
  // the comparison the engine makes (difflib opcodes of the run against the current file)
  const changes: FileChange[] = [
    {
      op: 'replace',
      run_lines: [2, 2],
      current_lines: [2, 3],
      run: ['b: 2'],
      current: ['b: 3', 'c: 4'],
    },
  ];

  it('marks changed lines and keeps the run line above them', () => {
    const lines = viewLines(now, changes);
    expect(lines.map((l) => l.changed)).toEqual([false, true, true, false]);
    expect(lines[1].was).toEqual(['b: 2']);
  });

  it('says each difference in one line', () => {
    expect(differenceTexts(changes)).toEqual(['b: 3 c: 4 (run: b: 2)']);
  });
});

describe('analysis.yaml as a settings source', () => {
  it('maps the sections to the template keys and leaves out data selections', () => {
    const out = analysesFromYaml({
      place_cells: { settings: { nShuffles: 500 }, bin_cm: 3, min_time_per_bin_s: 0.05 },
      auroc: { compare: 'rest', pairA: 'x', pairB: 'y', unselected: ['z'] },
      peth: { binS: 0.1, unselected: ['q'] },
      population: { k: 1, labels: ['a'] },
      decoding: {
        target: 'position',
        position: { folds: 5 },
        behaviors: { folds: 3, labels: ['a'] },
      },
    });
    expect(out).toEqual({
      place: { nShuffles: 500 },
      binCm: 3,
      minOccupancy: 0.05,
      auroc: { compare: 'rest' },
      peth: { binS: 0.1 },
      population: { k: 1 },
      positionDecoding: { folds: 5 },
      behaviorDecoding: { folds: 3 },
      decodeTarget: 'position',
    });
  });

  it('ignores a file that is not a mapping', () => {
    expect(analysesFromYaml(undefined)).toEqual({});
  });
});
