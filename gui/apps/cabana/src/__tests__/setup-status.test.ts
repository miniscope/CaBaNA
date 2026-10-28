import { describe, expect, it } from 'vitest';
import { statusOf, type SetupSnapshot } from '../lib/setup-status.ts';

const blank: SetupSnapshot = {
  paradigmChosen: false,
  sessionName: '',
  sessionDate: '',
  subjectId: '',
  species: '',
  brainRegion: '',
  group: '',
  notes: '',
  clockOffsetS: 0,
  clockScale: 1,
  arenaDrawn: false,
  zones: 0,
  bodyLine: false,
  bodyPart: '',
  positionTool: 'other',
  positionUnit: 'cm',
  yDown: false,
  pxPerCmEntered: 10,
  headOffset: 0,
  annotationTool: 'other',
  annotationUnit: 'seconds',
  stimuli: [],
  device: '',
  extractionTool: 'other',
  deconTool: 'other',
};
const s = (over: Partial<SetupSnapshot>): SetupSnapshot => ({ ...blank, ...over });

describe('setup card status', () => {
  it('everything is Empty with defaults only', () => {
    for (const id of ['experiment', 'session', 'spatial', 'tracking', 'stimuli', 'neural'] as const)
      expect(statusOf(id, blank)).toBe('Empty');
  });
  it('experiment: subject, species and region make it Complete; optional fields do not', () => {
    expect(statusOf('experiment', s({ notes: 'x' }))).toBe('Incomplete');
    expect(statusOf('experiment', s({ subjectId: 'M1', species: 'Mouse' }))).toBe('Incomplete');
    expect(statusOf('experiment', s({ subjectId: 'M1', species: 'Mouse', brainRegion: 'CA1' }))).toBe('Complete');
    expect(statusOf('experiment', s({ subjectId: ' ', species: ' ', brainRegion: ' ' }))).toBe('Empty');
  });
  it('session: needs all three rates above 0 and a clock scale above 0', () => {
    expect(statusOf('session', s({ durationS: 600 }))).toBe('Incomplete');
    const full = { durationS: 600, neuralFps: 30, cameraFps: 30 };
    expect(statusOf('session', s(full))).toBe('Complete');
    expect(statusOf('session', s({ ...full, clockScale: 0 }))).toBe('Incomplete');
    expect(statusOf('session', s({ ...full, neuralFps: 0 }))).toBe('Incomplete');
    expect(statusOf('session', s({ clockOffsetS: 1.5 }))).toBe('Incomplete');
  });
  it('spatial: Complete only once the scale is known', () => {
    expect(statusOf('spatial', s({ zones: 2 }))).toBe('Incomplete');
    expect(statusOf('spatial', s({ arenaDrawn: true }))).toBe('Incomplete');
    expect(statusOf('spatial', s({ arenaDrawn: true, pxPerCm: 7.5 }))).toBe('Complete');
  });
  it('tracking: body part needed; pixels need a scale; likelihood in 0 to 1', () => {
    expect(statusOf('tracking', s({ annotationUnit: 'milliseconds' }))).toBe('Incomplete');
    expect(statusOf('tracking', s({ bodyPart: 'Head' }))).toBe('Complete');
    expect(statusOf('tracking', s({ bodyPart: 'Head', likelihoodMin: 1.5 }))).toBe('Incomplete');
    expect(statusOf('tracking', s({ bodyPart: 'Head', positionUnit: 'px', pxPerCmEntered: 0 }))).toBe('Incomplete');
    expect(statusOf('tracking', s({ bodyPart: 'Head', positionUnit: 'px', pxPerCmEntered: 12 }))).toBe('Complete');
  });
  it('stimuli: every row named, lengths not negative', () => {
    expect(statusOf('stimuli', s({ stimuli: [{ name: '' }] }))).toBe('Incomplete');
    expect(statusOf('stimuli', s({ stimuli: [{ name: 'Tone' }, { name: 'Shock' }] }))).toBe('Complete');
    expect(statusOf('stimuli', s({ stimuli: [{ name: 'Tone', durationS: -1 }] }))).toBe('Incomplete');
  });
  it('neural: the miniscope completes it; tools alone do not', () => {
    expect(statusOf('neural', s({ deconTool: 'caiman' }))).toBe('Incomplete');
    expect(statusOf('neural', s({ device: 'UCLA Miniscope V4' }))).toBe('Complete');
  });
});
