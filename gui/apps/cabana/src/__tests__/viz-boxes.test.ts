// Pills, Revert window rows and the cell visibility of the Data visualization boxes.

import { describe, expect, it } from 'vitest';
import { buildChanges, stepsAtDefault } from '../lib/changes.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { cellDrawn } from '../lib/viz-display.ts';
import { boxesOf, correctionPill, forBox, preprocessPill, qcPill } from '../lib/viz-pills.ts';
import { rerunAnalyses, rerunNote, revertRows } from '../lib/viz-revert.ts';

describe('pills', () => {
  it('words the QC counts that are not zero, amber, or none flagged in green', () => {
    expect(qcPill({ flagged: 12, notes: 1 })).toMatchObject({
      text: 'QC: 12 flagged · 1 note',
      tone: 'flag',
    });
    expect(qcPill({ overlaps: 3 }).text).toBe('QC: 3 overlaps');
    expect(qcPill({ overlaps: 1 }).text).toBe('QC: 1 overlap');
    expect(qcPill({})).toMatchObject({ text: 'QC: none flagged', tone: 'ok' });
  });
  it('shows corrections only when there are some, apart from flags', () => {
    expect(correctionPill(0)).toBeUndefined();
    expect(correctionPill(1)?.text).toBe('1 correction applied');
    expect(correctionPill(2)?.text).toBe('2 corrections applied');
  });
  it('counts changed preprocessing steps or says defaults', () => {
    expect(preprocessPill(0).text).toBe('Preprocess: defaults');
    expect(preprocessPill(2).text).toBe('Preprocess: 2 changed');
  });
  it('assigns each applied item to the boxes that show its data', () => {
    expect(boxesOf('cell:3')).toEqual(['neural', 'footprints']);
    expect(boxesOf('prep:eventSmooth')).toEqual(['neural']);
    expect(boxesOf('prep:fillGaps')).toEqual(['arena', 'behavior']);
    expect(boxesOf('prep:boutPad')).toEqual(['behavior']);
    expect(boxesOf('annotations')).toEqual(['behavior']);
    expect(forBox([{ ref: 'cell:1' }, { ref: 'annotations' }], 'neural')).toEqual([
      { ref: 'cell:1' },
    ]);
  });
});

describe('Revert changes rows', () => {
  const entries = buildChanges({
    rejected: [11],
    jumps: [],
    annotationFixes: [],
    prep: { ...DEFAULT_PREP, eventSigmaS: 0.2 },
    defaults: DEFAULT_PREP,
    loaded: () => true,
  });
  it('lists what undoing does, then settings at default as idle', () => {
    const rows = revertRows(
      forBox(entries, 'neural'),
      forBox(stepsAtDefault({ ...DEFAULT_PREP, eventSigmaS: 0.2 }, DEFAULT_PREP), 'neural').map(
        (d) => ({ ...d, value: 'off' }),
      ),
      () => '10:39',
    );
    expect(rows.map((r) => [r.what, r.restore, !!r.idle])).toEqual([
      ['Rejected cell 12', 'undo: cell 12 is kept', false],
      ['Event smoothing 0.2 s', 'restore default: off', false],
      ['Smooth traces', 'nothing to restore', true],
    ]);
    expect(rows[0].note).toContain('applied 10:39');
  });
  it('names saved results that read what is reverted', () => {
    expect(rerunAnalyses(['prep:eventSmooth'], ['peth', 'decoding'])).toEqual(['PETH']);
    expect(rerunAnalyses(['cell:1'], ['place', 'auroc'])).toEqual(['Place cells', 'auROC']);
    expect(rerunAnalyses(['prep:boutPad'], ['place'])).toEqual([]);
    expect(rerunNote([])).toBeUndefined();
    expect(rerunNote(['PETH'])).toContain('PETH');
  });
});

describe('cell visibility', () => {
  const rejected = new Set([2]);
  const flagged = new Set([5]);
  it('hides rejected cells or all but flagged ones, never the selected cell', () => {
    expect(cellDrawn(2, 'all', rejected, flagged, 0)).toBe(true);
    expect(cellDrawn(2, 'hide-rejected', rejected, flagged, 0)).toBe(false);
    expect(cellDrawn(3, 'hide-rejected', rejected, flagged, 0)).toBe(true);
    expect(cellDrawn(5, 'flagged', rejected, flagged, 0)).toBe(true);
    expect(cellDrawn(3, 'flagged', rejected, flagged, 0)).toBe(false);
    expect(cellDrawn(3, 'flagged', rejected, flagged, 3)).toBe(true);
  });
});
