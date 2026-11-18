import { describe, expect, it } from 'vitest';
import { headerLine } from '../lib/header-line.ts';

describe('headerLine', () => {
  it('says so when nothing is open', () => {
    expect(headerLine(undefined)).toBe('No session open');
    expect(headerLine({})).toBe('No session open');
  });
  it('lists every known part in order', () => {
    expect(
      headerLine({ name: 'M24', task: 'Open field', cells: 148, frames: 18000, hz: 30, minutes: 10 }),
    ).toBe('M24 · Open field · 148 cells · 18,000 fr · 30 Hz · 10.0 min');
  });
  it('leaves out unknown parts', () => {
    expect(headerLine({ cells: 5, frames: 20 })).toBe('5 cells · 20 fr');
  });
});
