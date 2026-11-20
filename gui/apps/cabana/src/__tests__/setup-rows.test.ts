// Data setup: levels and groups of the data types, matching by name, and what Next still needs.

import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SLOTS,
  blockedText,
  joinAnd,
  missingRequired,
  rowMark,
} from '../lib/setup-rows.ts';
import {
  BEHAVIOR_ACTIVITY,
  BEHAVIOR_ADD,
  DEFAULT_ROWS,
  extText,
  isOtherId,
  matchSlot,
  NEURAL_ADD,
  slotOf,
  type SlotId,
} from '../lib/slots.ts';

describe('data types', () => {
  it('lists the neural activity files in processing order', () => {
    expect(ACTIVITY_SLOTS).toEqual(['neural_raw', 'neural_denoised', 'neural_deconvolved']);
  });

  it('has the approved levels', () => {
    const level = (id: SlotId) => slotOf(id).level;
    expect(DEFAULT_ROWS.map(level)).toEqual(['required', 'required', 'required']);
    expect(NEURAL_ADD.map(level)).toEqual(['recommended', 'optional', 'recommended']);
    expect(level('behavior_frame')).toBe('optional');
    expect(BEHAVIOR_ACTIVITY).toEqual([
      'position',
      'head_orientation',
      'zone_annotations',
      'behavior_annotations',
      'time_markers',
      'frame_labels',
    ]);
    expect(BEHAVIOR_ADD).toContain('behavior_frame');
    expect(slotOf('neural_timestamps').label).toBe('Neural timestamps');
    expect(slotOf('behavior_timestamps').label).toBe('Behavioral timestamps');
  });

  it('shows the accepted file types', () => {
    expect(extText(slotOf('neural_deconvolved'))).toBe('.npy, .npz, .mat');
    expect(extText(slotOf('position'))).toBe('.csv');
    expect(extText(slotOf('behavior_frame'))).toBe('.png, .jpg');
  });

  it('matches still images to the behavior video frame, and never a video', () => {
    expect(matchSlot('behavior_frame.png')).toBe('behavior_frame');
    expect(matchSlot('arena.JPG')).toBe('behavior_frame');
    expect(matchSlot('raw_view.png')).toBe('behavior_frame');
    expect(matchSlot('frame_labels.csv')).toBe('frame_labels');
    expect(matchSlot('behavCam_raw.avi')).toBeUndefined();
    expect(matchSlot('neural_raw.npz')).toBe('neural_raw');
  });

  it('recognizes the ids of named data types', () => {
    expect(isOtherId('other_1')).toBe(true);
    expect(isOtherId('other_12')).toBe(true);
    expect(isOtherId('other_0')).toBe(false);
    expect(isOtherId('other_x')).toBe(false);
    expect(isOtherId('position')).toBe(false);
  });
});

describe('Data setup requirements', () => {
  const have =
    (...ids: SlotId[]) =>
    (id: SlotId) =>
      ids.includes(id);

  it('lists only what is missing', () => {
    expect(missingRequired(have())).toEqual([
      'neural timestamps',
      'deconvolved events',
      'behavioral timestamps',
      'one behavioral activity file',
    ]);
    expect(
      missingRequired(have('neural_timestamps', 'neural_deconvolved', 'behavior_timestamps')),
    ).toEqual(['one behavioral activity file']);
    expect(
      missingRequired(
        have('neural_timestamps', 'neural_deconvolved', 'behavior_timestamps', 'position'),
      ),
    ).toEqual([]);
    // a named data type with a file counts as behavioral activity
    expect(
      missingRequired(have('neural_timestamps', 'neural_deconvolved', 'behavior_timestamps'), 1),
    ).toEqual([]);
    // the behavior video frame is not behavioral activity
    expect(
      missingRequired(
        have('neural_timestamps', 'neural_deconvolved', 'behavior_timestamps', 'behavior_frame'),
      ),
    ).toEqual(['one behavioral activity file']);
  });

  it('words the line under Next', () => {
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
    expect(blockedText(['neural timestamps', 'one behavioral activity file'])).toBe(
      'To continue, add neural timestamps and one behavioral activity file',
    );
  });

  it('marks an empty row with nothing', () => {
    expect(rowMark({ level: 'required', loaded: false }).mark).toBe('');
  });
});

describe('named data types', async () => {
  const { addOther, nextOtherId, others, removeOther, renameOther, setAllOthers, othersWithFiles } =
    await import('../lib/other-types.ts');
  it('numbers ids past the highest in use and keeps the user’s name', () => {
    setAllOthers([]);
    expect(nextOtherId([])).toBe('other_1');
    expect(nextOtherId([{ id: 'other_1' }, { id: 'other_4' }])).toBe('other_5');
    const a = addOther();
    const b = addOther('Lick sensor', { name: 'licks.csv', size: 10 });
    renameOther(a, 'Pupil');
    expect(others.map((o) => [o.id, o.name])).toEqual([
      ['other_1', 'Pupil'],
      ['other_2', 'Lick sensor'],
    ]);
    expect(othersWithFiles()).toBe(1);
    removeOther(a);
    expect(others.map((o) => o.id)).toEqual([b]);
    expect(addOther()).toBe('other_3');
  });
});
