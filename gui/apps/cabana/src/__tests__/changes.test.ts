// The Changes drawer's Applied list: one entry per rejected cell, left-out jump, annotation fix and
// preprocessing setting that differs from its default, each with what Undo or Edit acts on.

import { describe, expect, it } from 'vitest';
import { buildChanges, changeCounts, type ChangesInput } from '../lib/changes.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import type { SlotId } from '../lib/slots.ts';

const base = (over: Partial<ChangesInput> = {}): ChangesInput => ({
  rejected: [],
  jumps: [],
  annotationFixes: [],
  prep: { ...DEFAULT_PREP },
  defaults: DEFAULT_PREP,
  loaded: () => true,
  ...over,
});

describe('buildChanges', () => {
  it('is empty with nothing applied and default settings', () => {
    expect(buildChanges(base())).toEqual([]);
  });

  it('lists rejected cells in order, 1-based, with their reason or none', () => {
    const list = buildChanges(base({ rejected: [9, 2], reasons: { 9: 'Flat trace' } }));
    expect(list.map((e) => [e.what, e.detail, e.touches])).toEqual([
      ['Rejected cell 3', 'No reason given', '1 cell'],
      ['Rejected cell 10', 'Flat trace', '1 cell'],
    ]);
    expect(list[0].action).toEqual({ undo: 'cell', cell: 2 });
    expect(list[0].ref).toBe('cell:2');
  });

  it('lists left-out jumps and annotation fixes as corrections', () => {
    const list = buildChanges(
      base({
        jumps: [{ first: 120, start: 75.25, frames: 4 }],
        annotationFixes: ['Merged 3 pairs of bouts that were less than 0.5 s apart.'],
      }),
    );
    expect(list.map((e) => [e.group, e.what, e.touches])).toEqual([
      ['correction', 'Left out the position jump at 1:15.3', '4 frames'],
      ['correction', 'Merged 3 pairs of bouts that were less than 0.5 s apart', '3 pairs'],
    ]);
    expect(list[0]).toMatchObject({ ref: 'jump:120', action: { undo: 'jump', index: 0 } });
    expect(list[1].action).toEqual({ undo: 'annotations' });
  });

  it('lists only preprocessing settings that differ from their defaults, with where to edit', () => {
    const list = buildChanges(
      base({
        prep: { ...DEFAULT_PREP, fillGapS: 1, eventSigmaS: 0.2, minSpeed: 3 },
        filledFrames: 312,
      }),
    );
    expect(list.map((e) => [e.group, e.what, e.touches])).toEqual([
      ['prep', 'Event smoothing 0.2 s', 'all cells'],
      ['prep', 'Fill tracking gaps 1 s', '312 frames'],
      ['prep', 'Speed filter 3 cm/s', 'frames below 3 cm/s'],
    ]);
    expect(list[1].detail).toBe('Position, linear · default 0.5 s');
    expect(list[1].action).toEqual({ edit: 'prep', slot: 'position', step: 'fillGaps' });
    expect(list[2].action).toEqual({ edit: 'analysis', analysis: 'place' });
    expect(changeCounts(list)).toEqual({ corrections: 0, prep: 3 });
  });

  it('points bout padding at the loaded annotation file and blocks Edit without one', () => {
    const prep = { ...DEFAULT_PREP, labelPadS: 0.5 };
    const zones = buildChanges(base({ prep, loaded: (s: SlotId) => s === 'zone_annotations' }));
    expect(zones[0].action).toEqual({ edit: 'prep', slot: 'zone_annotations', step: 'boutPad' });
    expect(zones[0].blocked).toBeUndefined();
    const none = buildChanges(base({ prep, loaded: () => false }));
    expect(none[0].blocked).toBe('The file this step acts on is not loaded.');
  });
});
