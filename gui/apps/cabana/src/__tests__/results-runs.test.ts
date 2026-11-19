import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import {
  cellsOf,
  isNewestOfType,
  runCounts,
  runRows,
  runType,
  settingsStatus,
  signalOf,
} from '../lib/results-runs.ts';

let n = 0;
const rec = (o: Partial<RunRecord> = {}, settings: unknown = {}): RunRecord => {
  n += 1;
  return {
    record_version: 1,
    run_id: `r${n}`,
    group_id: null,
    analysis: 'auroc',
    engine: 'framework',
    status: 'ok',
    scope: 'full',
    created_utc: `2026-11-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
    finished_utc: null,
    session: { session_id: 's', inputs: [] },
    gui: { settings, settings_sha256: 'h' },
    results_file: 'results.json',
    errors: [],
    warnings: [],
    ...o,
  };
};

describe('saved run rows', () => {
  const older = rec();
  const newest = rec();
  const stale = rec({ analysis: 'peth' });
  const preview = rec({ analysis: 'place', scope: 'preview' });
  const failed = rec({ analysis: 'decoding', status: 'failed', results_file: null });
  const records = [older, newest, stale, preview, failed];
  const matchOf = (r: RunRecord) =>
    r.run_id === newest.run_id
      ? { matches: true }
      : r.run_id === stale.run_id
        ? { matches: false }
        : undefined;
  const rows = runRows(records, matchOf);

  it('lists newest first with a status in words', () => {
    expect(rows.map((r) => r.record.run_id)).toEqual([
      failed.run_id,
      preview.run_id,
      stale.run_id,
      newest.run_id,
      older.run_id,
    ]);
    const kind = Object.fromEntries(rows.map((r) => [r.record.run_id, r.status]));
    expect(kind).toMatchObject({
      [failed.run_id]: 'Failed',
      [preview.run_id]: 'Not compared',
      [stale.run_id]: 'Needs rerun',
      [newest.run_id]: 'Current',
      [older.run_id]: 'Older settings',
    });
  });

  it('gives each run a Type apart from its Settings status', () => {
    const type = Object.fromEntries(rows.map((r) => [r.record.run_id, r.type.kind]));
    expect(type[preview.run_id]).toBe('preview');
    expect(type[newest.run_id]).toBe('full');
    expect(rows.find((r) => r.record.run_id === preview.run_id)!.settings.kind).toBe('saved');
  });

  it('filters by analysis', () => {
    expect(runRows(records, matchOf, 'auroc')).toHaveLength(2);
  });

  it('counts runs by kind', () => {
    expect(runCounts(rows)).toEqual({
      saved: 5,
      current: 1,
      needRerun: 1,
      previews: 1,
      other: 1,
    });
  });

  it('calls a newest run saved when it cannot be compared', () => {
    expect(runRows([rec()], () => undefined)[0].status).toBe('Not compared');
  });
});

describe('signal and cells', () => {
  it('says events unless the run read another file', () => {
    expect(signalOf(rec())).toBe('events');
    expect(signalOf(rec({}, { deps: { analysisData: 'denoised' } }))).toBe('denoised');
  });
  it('says all cells, or all but the excluded ones', () => {
    expect(cellsOf(rec())).toBe('all');
    expect(cellsOf(rec({ rejected_cell_ids: ['3', '9'] }))).toBe('all but 2');
  });
});

describe('run Type', () => {
  const withShuffles = (scope: 'full' | 'preview', n?: number, analysis = 'place') =>
    rec(
      { scope, analysis },
      n === undefined ? {} : { settingsVersion: 2, analysis: { nShuffles: n } },
    );
  it('names the type with the executed shuffle count', () => {
    expect(runType(withShuffles('full', 1000))).toEqual({
      kind: 'full',
      shuffles: 1000,
      text: 'Full analysis · 1,000 shuffles',
    });
    expect(runType(withShuffles('preview', 100)).text).toBe('Preview · 100 shuffles');
  });
  it('leaves the count out when the record does not say', () => {
    expect(runType(withShuffles('preview')).text).toBe('Preview');
    expect(runType(withShuffles('full')).text).toBe('Full analysis');
  });
  it('gives a PETH run without a test no shuffles', () => {
    const peth = rec(
      { analysis: 'peth' },
      { settingsVersion: 2, analysis: { test: 'none', nShuffles: 1000 } },
    );
    expect(runType(peth).text).toBe('Full analysis');
  });
});

describe('Settings status', () => {
  it('only the newest full run needs a rerun; a preview or an older run has older settings', () => {
    const full = rec();
    const preview = rec({ scope: 'preview' });
    const changed = { matches: false, diff: ['rejected cells'] };
    expect(settingsStatus(full, true, changed)).toMatchObject({
      kind: 'needs_rerun',
      text: 'Needs rerun',
      reason: 'rejected cells',
    });
    expect(settingsStatus(full, false, changed).kind).toBe('older');
    expect(settingsStatus(preview, true, changed).kind).toBe('older');
    expect(settingsStatus(preview, true, { matches: true }).kind).toBe('current');
  });
  it('keeps the run states and the uncompared fallback', () => {
    expect(settingsStatus(rec({ status: 'failed' }), true).text).toBe('Failed');
    expect(settingsStatus(rec({ status: 'running' }), true).text).toBe('Running');
    expect(settingsStatus(rec(), true).text).toBe('Not compared');
    expect(settingsStatus(rec(), false).text).toBe('Older settings');
  });
  it('picks the newest of each Type', () => {
    const a = rec();
    const b = rec();
    const p = rec({ scope: 'preview' });
    expect(isNewestOfType(b, [a, b, p])).toBe(true);
    expect(isNewestOfType(a, [a, b, p])).toBe(false);
    expect(isNewestOfType(p, [a, b, p])).toBe(true);
  });
});
