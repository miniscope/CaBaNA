import { describe, expect, it } from 'vitest';
import { placeCsv, placeMetadata } from '../lib/place-export.ts';
import { DEFAULT_PLACE_SETTINGS, type PlaceOutcome } from '../lib/place-run.ts';
import { DEFAULT_PLACE, analyzePlaceCells, type PlaceInput } from '../lib/placecells.ts';
import { buildRows, countOutcomes, listRows } from '../lib/place-table.ts';
import ref from './placecells_reference.json';

const input: PlaceInput = {
  neural: Float64Array.from(ref.neural),
  cells: ref.cells,
  frames: ref.frames,
  labels: Int32Array.from(ref.labels),
  shape: ref.shape as [number, number],
  fs: ref.fs,
};
const result = analyzePlaceCells(
  input,
  { ...DEFAULT_PLACE, sigma: 1 },
  Int32Array.from(ref.shifts),
);
const out = {
  data: {
    input,
    cellIds: Array.from({ length: ref.cells }, (_, i) => i + 5), // cell numbers differ from result rows
    grid: { bin: 3 },
    used: 100,
    minSpeed: 2,
  },
  result,
  sigma: 1,
  minShiftS: 5,
  nShuffles: 12,
  distinctShifts: 12,
  seconds: 1,
  arenaCm: [30, 30],
  settings: { ...DEFAULT_PLACE_SETTINGS, alpha: 0.1 },
} as unknown as PlaceOutcome;

describe('place-cell table', () => {
  const rows = buildRows(out);
  const base = { filter: 'all' as const, query: '', sort: 'cell' as const, desc: false };
  it('has one row per cell and the outcome counts add up', () => {
    expect(rows).toHaveLength(ref.cells);
    const c = countOutcomes(rows);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(ref.cells);
    expect(c.cannot).toBeGreaterThan(0); // the silent cell
  });
  it('a filter keeps only its outcome, and the search matches the shown cell number', () => {
    const only = listRows(rows, out, { ...base, filter: 'cannot' });
    expect(only.every((r) => r.overall === 'cannot')).toBe(true);
    const six = listRows(rows, out, { ...base, query: '6' }); // cell numbers are id + 1
    expect(six.every((r) => String(r.id + 1).startsWith('6'))).toBe(true);
    expect(six[0].i).toBe(0); // cell 6 is result row 0
  });
  it('sorts high to low, with undefined values last', () => {
    const s = listRows(rows, out, { ...base, sort: 'information', desc: true });
    const v = s.map((r) => result.information[r.i]);
    const defined = v.filter((x) => !Number.isNaN(x));
    expect(defined).toEqual([...defined].sort((a, b) => b - a));
    expect(Number.isNaN(v[v.length - 1])).toBe(true);
  });
  it('exports a CSV with the settings line and one line per cell, and the run metadata', () => {
    const lines = placeCsv(out).split('\n');
    expect(lines[0]).toMatch(/^# minimum_time_per_bin_s/);
    expect(lines).toHaveLength(ref.cells + 2);
    expect(lines[2].split(',')[0]).toBe('6'); // first cell number: row id 5, shown as id + 1
    const m = placeMetadata(out);
    expect(m).toMatchObject({ shuffles: 12, bin_cm: 3, smoothing: { sigma_bins: 1, sigma_cm: 3 } });
    expect(m.minimum_circular_shift.mode).toBe('auto');
  });
});
