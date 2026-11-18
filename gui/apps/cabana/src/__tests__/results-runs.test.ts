import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import { cellsOf, runCounts, runRows, signalOf } from '../lib/results-runs.ts';

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
      [failed.run_id]: 'failed',
      [preview.run_id]: 'preliminary',
      [stale.run_id]: 'needs rerun',
      [newest.run_id]: 'current',
      [older.run_id]: 'earlier run',
    });
  });

  it('filters by analysis', () => {
    expect(runRows(records, matchOf, 'auroc')).toHaveLength(2);
  });

  it('counts runs by kind', () => {
    expect(runCounts(rows)).toEqual({
      saved: 5,
      current: 1,
      needRerun: 1,
      preliminary: 1,
      other: 1,
    });
  });

  it('calls a newest run saved when it cannot be compared', () => {
    expect(runRows([rec()], () => undefined)[0].status).toBe('saved');
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
