import { describe, expect, it } from 'vitest';
import { buildRegistry, defaultRoles, resolveRole, type LabelInput } from '../lib/labels.ts';

const input = (source: LabelInput['source'], file: string, ...names: string[]): LabelInput => ({
  source,
  file,
  slot: 'x',
  labels: names.map((name) => ({ name, count: 1 })),
});

describe('buildRegistry', () => {
  it('trims names and keeps case', () => {
    const r = buildRegistry([input('epochs', 'a.csv', ' freeze ', 'Freeze')]);
    expect(r.map((e) => e.name)).toEqual(['freeze', 'Freeze']);
    expect(r.every((e) => !e.blocked)).toBe(true);
  });
  it('treats trimmed equal names from two sources as a duplicate, naming the other file', () => {
    const r = buildRegistry([input('epochs', 'a.csv', 'tone'), input('markers', 'm.csv', ' tone')]);
    expect(r.every((e) => e.blocked)).toBe(true);
    expect(r[0].problems[0]).toContain('m.csv');
    expect(r[1].problems[0]).toContain('a.csv');
  });
  it('flags the same source in two files', () => {
    const r = buildRegistry([input('epochs', 'a.csv', 'x'), input('epochs', 'b.csv', 'x')]);
    expect(r.every((e) => e.blocked)).toBe(true);
  });
  it('does not flag different names or one file repeating a name', () => {
    const r = buildRegistry([input('epochs', 'a.csv', 'x', 'x'), input('markers', 'm.csv', 'y')]);
    expect(r.some((e) => e.blocked)).toBe(false);
  });
  it('leaves a binary column and a category of the same name to agreement', () => {
    const inputs = [
      input('frame_binary', 'f.csv', 'grooming'),
      input('frame_categorical', 'f.csv', 'grooming'),
    ];
    expect(buildRegistry(inputs).some((e) => e.blocked)).toBe(false);
    const r = buildRegistry(inputs, [
      { label: 'grooming', conflicts: 5, firstFrames: [1, 2], oneSourceOnly: 0 },
    ]);
    expect(r.every((e) => e.blocked)).toBe(true);
    expect(r[0].problems[0]).toContain('5 frame');
  });
  it('ignores agreement results with no conflicts', () => {
    const inputs = [input('frame_binary', 'f.csv', 'g'), input('frame_categorical', 'f.csv', 'g')];
    const r = buildRegistry(inputs, [
      { label: 'g', conflicts: 0, firstFrames: [], oneSourceOnly: 4 },
    ]);
    expect(r.some((e) => e.blocked)).toBe(false);
  });
});

describe('roles', () => {
  it('defaults paradigm labels to controlled and the rest to measured', () => {
    expect(defaultRoles(['cs', 'freezing'], ['cs', 'us'])).toEqual({
      cs: 'controlled',
      freezing: 'measured',
    });
  });
  it('prefers the saved role', () => {
    expect(resolveRole('cs', { cs: 'measured' }, ['cs'])).toBe('measured');
    expect(resolveRole('cs', undefined, ['cs'])).toBe('controlled');
    expect(resolveRole('x', {}, ['cs'])).toBe('measured');
  });
});
