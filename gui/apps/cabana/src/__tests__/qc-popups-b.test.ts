import { describe, expect, it } from 'vitest';
import type { Epoch } from '../lib/behavior.ts';
import { fixCounts, marksFor } from '../lib/behavior-marks.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { chosenValues, importRows, prepText } from '../lib/prep-import.ts';
import { maskRuns, paddedGainPct, worstWindow } from '../lib/prep-preview.ts';
import { prepPopupFor } from '../lib/qc-popup-view.ts';
import {
  annotationPlan,
  importPrepValues,
  jumpChanges,
  jumpDraftChoice,
  pendingAnnotations,
  setJumpChoice,
  startAnnotationDraft,
  startJumpDraft,
  startPrepDraft,
  draftValue,
} from '../lib/qc-draft.ts';
import { segmentLine } from '../lib/qc-flags.ts';

const ep = (label: string, start: number, stop: number): Epoch => ({
  label,
  start,
  stop,
  flags: [],
  notes: [],
});

describe('jump draft', () => {
  const jumps = [
    { key: '10', applied: undefined },
    { key: '20', applied: 'keep' as const },
  ];
  it('lists only the jumps whose choice differs from the applied one', () => {
    let d = setJumpChoice(startJumpDraft(), ['10', '20'], '10', 'interpolate');
    d = setJumpChoice(d, ['10', '20'], '20', 'keep');
    expect(jumpChanges(d, jumps)).toEqual([{ key: '10', to: 'interpolate' }]);
  });
  it('Restore original data clears every applied choice', () => {
    const d = { ...startJumpDraft(), restoreOriginal: true };
    expect(jumpChanges(d, jumps)).toEqual([{ key: '20', to: undefined }]);
    expect(jumpDraftChoice(d, '20', 'keep')).toBeUndefined();
  });
  it('choosing while Restore original data is ticked starts from nothing chosen', () => {
    const d = setJumpChoice(
      { ...startJumpDraft(), restoreOriginal: true },
      ['10', '20'],
      '10',
      'keep',
    );
    expect(jumpChanges(d, jumps)).toEqual([
      { key: '10', to: 'keep' },
      { key: '20', to: undefined },
    ]);
  });
});

describe('annotation draft', () => {
  const d0 = startAnnotationDraft({ mergeGapS: 0.5, minBoutS: 0.25 });
  it('starts with nothing to do', () => {
    expect(annotationPlan(d0, { merge: 3, drop: 2 }, false)).toEqual({ undo: false, fixes: [] });
    expect(pendingAnnotations(d0, { merge: 3, drop: 2 }, false)).toBe(0);
  });
  it('runs ticked fixes that would change something, with the slider limits', () => {
    const d = { ...d0, merge: true, drop: true, mergeGapS: 1, minBoutS: 0.4 };
    expect(annotationPlan(d, { merge: 2, drop: 0 }, false).fixes).toEqual([
      { kind: 'merge', limit: 1 },
    ]);
    expect(pendingAnnotations(d, { merge: 2, drop: 1 }, false)).toBe(2);
  });
  it('Restore original data undoes earlier fixes only when there are some', () => {
    const d = { ...d0, restoreOriginal: true };
    expect(annotationPlan(d, { merge: 0, drop: 0 }, false).undo).toBe(false);
    expect(annotationPlan(d, { merge: 0, drop: 0 }, true).undo).toBe(true);
  });
});

describe('behavior marks', () => {
  const epochs = [ep('a', 0, 0.1), ep('a', 0.3, 2), ep('b', 1, 3)];
  it('marks bouts under the limit and bouts that follow one too closely', () => {
    const m = marksFor(epochs, 0.25, 0.5);
    expect(m.short).toEqual([epochs[0]]);
    expect(m.closeStarts).toEqual([0.3]);
  });
  it('counts what merge and remove would change, as the fixes do', () => {
    expect(fixCounts([epochs], 0.5, 0.25)).toEqual({ merge: 1, drop: 1 });
    expect(fixCounts([epochs], 0.1, 0.05)).toEqual({ merge: 0, drop: 0 });
  });
});

describe('Preprocess previews', () => {
  it('finds the 10 s window with the most lost frames', () => {
    const lost = Array.from({ length: 100 }, (_, i) => i >= 60 && i < 66);
    expect(worstWindow(lost, 1, 10)).toEqual({ start: 56, end: 66, lost: 6 });
    expect(worstWindow([false, false, false], 1, 2).start).toBe(0);
  });
  it('lists runs of a mask inside a range', () => {
    expect(maskRuns([false, true, true, false, true], 0, 5)).toEqual([
      [1, 3],
      [4, 5],
    ]);
    expect(maskRuns([true, true, true], 1, 2)).toEqual([[1, 2]]);
  });
  it('gives the gain from padding', () => {
    expect(paddedGainPct(100, 130)).toBe(30);
    expect(paddedGainPct(0, 0)).toBe(0);
  });
  it('sends each step to the pop-up that holds it', () => {
    expect(prepPopupFor('eventSmooth')).toBe('neural-prep');
    expect(prepPopupFor('fillGaps')).toBe('position-prep');
    expect(prepPopupFor('boutPad')).toBe('behavior-prep');
    expect(prepPopupFor('speedFilter')).toBeUndefined();
  });
  it('words a position segment as a flag', () => {
    expect(segmentLine({ kind: 'jump', start: 134.3, stop: 134.4, n: 3, peak: 80 })).toEqual({
      title: 'Jump at 2:14.3',
      detail: '80 cm/s over 3 steps',
    });
    expect(segmentLine({ kind: 'lost', start: 221, stop: 222.2, n: 60 }).title).toBe(
      'Lost for 1.2 s at 3:41.0',
    );
  });
});

describe('Import preprocessing settings', () => {
  const keys = ['eventSigmaS', 'posMethod', 'labelPadS'] as const;
  const now = (k: string) => DEFAULT_PREP[k as keyof typeof DEFAULT_PREP];
  it('ticks the settings that differ and reads the rest as unchanged', () => {
    const rows = importRows(keys, { eventSigmaS: 0.2, posMethod: 'median' }, now);
    expect(rows.map((r) => [r.key, r.differs])).toEqual([
      ['eventSigmaS', true],
      ['posMethod', false],
      ['labelPadS', false],
    ]);
    expect(rows[2].from).toBeUndefined();
  });
  it('takes only ticked settings the source has', () => {
    const rows = importRows(keys, { eventSigmaS: 0.2, posMethod: 'gaussian' }, now);
    expect(chosenValues(rows, new Set(['eventSigmaS', 'labelPadS']))).toEqual({ eventSigmaS: 0.2 });
  });
  it('shows values in the pop-ups wording', () => {
    expect(prepText('eventSigmaS', 0)).toBe('off');
    expect(prepText('maxGapS', 0)).toBe('0.00 s');
    expect(prepText('fillGapS', 0.5)).toBe('0.50 s');
    expect(prepText('posMethod', 'median')).toBe('median');
    expect(prepText('labelPadS', undefined)).toBe('not in that file');
  });
  it('puts imported values into the draft and keeps the others as they show', () => {
    const applied = { ...DEFAULT_PREP, labelPadS: 0.3 };
    const d = importPrepValues(applied, startPrepDraft(), ['eventSigmaS', 'labelPadS'], {
      eventSigmaS: 0.2,
    });
    expect(draftValue(applied, d, 'eventSigmaS')).toBe(0.2);
    expect(draftValue(applied, d, 'labelPadS')).toBe(0.3);
  });
});
