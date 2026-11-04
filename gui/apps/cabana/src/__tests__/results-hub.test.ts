import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import { analysisCards, countsText, filterRuns, statusText } from '../lib/results-hub.ts';

let n = 0;
const rec = (o: Partial<RunRecord>): RunRecord => {
  n += 1;
  return {
    record_version: 1,
    run_id: `h${n}`,
    group_id: null,
    analysis: 'auroc',
    engine: 'framework',
    status: 'ok',
    scope: 'full',
    created_utc: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
    finished_utc: null,
    session: { session_id: 's', inputs: [] },
    gui: { settings: {}, settings_sha256: 'h' },
    results_file: 'results.zip',
    errors: [],
    warnings: [],
    ...o,
  } as RunRecord;
};

describe('filterRuns', () => {
  const runs = [
    rec({ analysis: 'place' }),
    rec({ analysis: 'auroc', scope: 'preview' }),
    rec({ analysis: 'auroc', status: 'failed', results_file: null }),
    rec({ analysis: 'auroc', status: 'queued', results_file: null }),
  ];
  it('lists everything newest first without filters', () => {
    const ids = filterRuns(runs).map((r) => r.run_id);
    expect(ids).toEqual([...runs].reverse().map((r) => r.run_id));
  });
  it('combines the analysis, scope and status filters', () => {
    expect(filterRuns(runs, { analysis: 'auroc' })).toHaveLength(3);
    expect(filterRuns(runs, { analysis: 'auroc', scope: 'preview' })).toHaveLength(1);
    expect(filterRuns(runs, { status: 'failed' })).toHaveLength(1);
    expect(filterRuns(runs, { scope: 'full', status: 'ok' })).toHaveLength(1);
  });
  it('treats queued as running', () => {
    expect(filterRuns(runs, { status: 'running' }).map((r) => r.status)).toEqual(['queued']);
  });
});

describe('analysisCards', () => {
  it('counts saved runs per analysis and leaves untouched analyses at zero', () => {
    const cards = analysisCards([
      rec({ analysis: 'place' }),
      rec({ analysis: 'place', scope: 'preview' }),
      rec({ analysis: 'place', status: 'failed', results_file: null }),
    ]);
    const place = cards.find((c) => c.analysis === 'place')!;
    expect(place).toMatchObject({ runs: 3, withResults: 2, full: 1, preliminary: 1, failed: 1 });
    expect(place.status).toBe('Completed');
    expect(place.newer?.status).toBe('failed');
    const peth = cards.find((c) => c.analysis === 'peth')!;
    expect(peth).toMatchObject({ runs: 0, latest: undefined, status: 'No result yet' });
    expect(cards).toHaveLength(5);
  });
  it('opens the newest run that has results', () => {
    const old = rec({ analysis: 'peth' });
    const failed = rec({ analysis: 'peth', status: 'failed', results_file: null });
    const peth = analysisCards([old, failed]).find((c) => c.analysis === 'peth')!;
    expect(peth.latest?.run_id).toBe(old.run_id);
    expect(peth.latestWhen).toBe(old.created_utc);
  });
});

describe('text', () => {
  it('states counts and status', () => {
    expect(countsText({ runs: 0, full: 0, preliminary: 0, failed: 0 })).toBe('No saved runs');
    expect(countsText({ runs: 1, full: 1, preliminary: 0, failed: 0 })).toBe(
      '1 run: 1 full, 0 preliminary',
    );
    expect(countsText({ runs: 3, full: 1, preliminary: 1, failed: 1 })).toBe(
      '3 runs: 1 full, 1 preliminary, 1 failed',
    );
    expect(statusText(rec({ status: 'running' }))).toBe('Running');
    expect(statusText(rec({ status: 'cancelled' }))).toBe('Cancelled: partial results');
    expect(statusText(undefined)).toBe('No result yet');
  });
});
