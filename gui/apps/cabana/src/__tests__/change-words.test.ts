import { describe, expect, it } from 'vitest';
import { readableChanges } from '../lib/change-words.ts';
import { plural } from '../lib/plural.ts';
import { cellNoteFlags } from '../lib/qc-markers.ts';
import { segmentLine } from '../lib/qc-flags.ts';

describe('readableChanges', () => {
  it('names known settings with their values and unit', () => {
    const diff = [
      'pipeline.preprocess: [] -> [{"name":"smooth_neural"}]',
      'prep.eventSigmaS: 0 -> 0.2',
    ];
    expect(readableChanges(diff, 'peth')).toEqual(['event smoothing (0 → 0.20 s)']);
  });

  it('shows rejected cells from 1', () => {
    expect(readableChanges(['rejected: [] -> [11]'])).toEqual([
      'rejected cells (cell 12 rejected)',
    ]);
    expect(readableChanges(['rejected: [2, 5] -> [5]'])).toEqual([
      'rejected cells (cell 3 restored)',
    ]);
  });

  it('lists a rejected cell once when it is in both the field and the dependencies', () => {
    expect(readableChanges(['deps.rejected: [] -> [0, 1]', 'rejected: [] -> [0, 1]'])).toEqual([
      'rejected cells (cells 1, 2 rejected)',
    ]);
  });

  it('falls back to the key as words, never the raw path', () => {
    const [text] = readableChanges(['analysis.binWidthS: 0.1 -> 0.2'], 'peth');
    expect(text).toBe('bin width s (0.10 → 0.20 s)');
    expect(readableChanges(['analysis.neuralActivity: 1 -> 2'], 'peth')[0]).not.toMatch(
      /activity/i,
    );
    expect(text).not.toMatch(/analysis\.|->/);
  });

  it('uses the analysis names and passes words through', () => {
    expect(readableChanges(['analysis.nShuffles: 100 -> 200'], 'place')).toEqual([
      'number of shuffles (100 → 200)',
    ]);
    expect(readableChanges(['deps.clock: {} -> {}'])).toEqual(['clock alignment']);
    expect(readableChanges(['bin size'])).toEqual(['bin size']);
  });
});

describe('plurals in QC text', () => {
  it('uses the singular for 1', () => {
    expect(plural(1, 'lost stretch', 'lost stretches')).toBe('1 lost stretch');
    expect(plural(2, 'lost stretch', 'lost stretches')).toBe('2 lost stretches');
    expect(segmentLine({ kind: 'lost', start: 1, stop: 2, n: 1 }).detail).toBe('1 frame');
    expect(segmentLine({ kind: 'jump', start: 1, stop: 2, n: 1, peak: 60 }).detail).toBe('60 cm/s');
  });
});

describe('cell note flags', () => {
  it('count the cells with each note, as the QC pop-up does, and skip rejected ones', () => {
    const flags = cellNoteFlags([
      { notes: ['correlated with a neighbor'], rejected: false },
      { notes: ['correlated with a neighbor', 'low SNR'], rejected: false },
      { notes: ['correlated with a neighbor'], rejected: true },
      { notes: [], rejected: false },
    ]);
    expect(flags.map((f) => f.title)).toEqual([
      '2 cells correlated with a neighbor',
      '1 cell with low SNR',
    ]);
    expect(flags[0].cells).toEqual([0, 1]);
  });
});
