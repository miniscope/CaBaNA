import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import { infoSections, keyRows, timeToFinish } from '../lib/run-info.ts';
import { compareSettings } from '../lib/settings-compare.ts';

const record = (settings: unknown, o: Partial<RunRecord> = {}): RunRecord =>
  ({
    record_version: 1,
    run_id: 'r-1',
    group_id: null,
    analysis: 'place',
    engine: 'framework',
    status: 'ok',
    scope: 'full',
    created_utc: '2026-11-18T21:11:00Z',
    finished_utc: '2026-11-18T21:12:42Z',
    session: { session_id: 's', inputs: [{ key: 'a', sha256: 'e822bf3369ba' }] },
    gui: { settings, settings_sha256: 'h' },
    framework: { cabana_version: '0.0.1', commit: 'abcdef1234', capabilities: {} },
    results_file: 'results.json',
    errors: [],
    warnings: [],
    ...o,
  }) as RunRecord;

const place = {
  analysis: { binCm: 2.5, sigmaAuto: false, sigma: 1, nShuffles: 1000, alpha: 0.05 },
};

describe('run information', () => {
  it('gives the key rows from what the run saved', () => {
    const rows = Object.fromEntries(keyRows(record(place)).map((r) => [r.k, r.v]));
    expect(rows['Run type']).toBe('Full analysis');
    expect(rows.Shuffles).toBe('1,000 circular shifts');
    expect(rows['Bin size']).toBe('2.5 cm');
    expect(rows.Smoothing).toBe('Gaussian, σ 1 bin');
    expect(rows['Significance (α)']).toBe('0.05');
    expect(rows['Data version']).toBe('1 files, e822bf33');
  });
  it('leaves out a setting the record does not hold', () => {
    const labels = keyRows(record({ analysis: { alpha: 0.05 } })).map((r) => r.k);
    expect(labels).not.toContain('Bin size');
    expect(labels).not.toContain('Shuffles');
  });
  it('times the run from queued to finished', () => {
    expect(timeToFinish(record(place))).toBe('1 min 42 s');
    expect(timeToFinish(record(place, { finished_utc: null }))).toBeUndefined();
  });
  it('has four sections and says why a size is missing', () => {
    const sections = infoSections(record(place), {
      status: { text: 'Current' },
      started: 'Nov 18',
      sizeText: String,
    });
    expect(sections.map((s) => s.title)).toEqual([
      'analysis parameters',
      'data and processing',
      'run',
      'outputs',
    ]);
    const size = sections[3].rows.find((r) => r.k === 'Size')!;
    expect(size).toMatchObject({ v: '—', tip: 'Sizes need a saved project' });
    expect(sections[2].rows.map((r) => r.k)).toContain('Time to finish (includes waiting)');
  });
});

describe('settings comparison', () => {
  it('lists only the settings that differ', () => {
    const other = record({ analysis: { ...place.analysis, binCm: 3, alpha: 0.05 } });
    expect(compareSettings(record(place), other)).toEqual([{ k: 'Bin size (cm)', a: '2.5', b: '3' }]);
    expect(compareSettings(record(place), record(place))).toEqual([]);
  });
});
