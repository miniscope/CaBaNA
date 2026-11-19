import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import type { ExplorerData } from '../lib/explorer-data.ts';
import { parseSavedCsv } from '../lib/results-explorer.ts';
import {
  deleteText,
  headlineOf,
  reasonText,
  tableCounts,
  tableRows,
} from '../lib/results-table.ts';

let n = 0;
const rec = (o: Partial<RunRecord> = {}): RunRecord => {
  n += 1;
  return {
    record_version: 1,
    run_id: `r${n}`,
    group_id: null,
    analysis: 'peth',
    engine: 'browser-ts',
    status: 'ok',
    scope: 'full',
    created_utc: `2026-11-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
    finished_utc: null,
    session: { session_id: 's', inputs: [] },
    gui: { settings: {}, settings_sha256: 'h' },
    results_file: null,
    files: ['peth.csv'],
    errors: [],
    warnings: [],
    ...o,
  };
};

describe('overview rows', () => {
  const peth = rec();
  const failed = rec({ analysis: 'decoding', status: 'failed', files: [] });
  const records = [peth, failed];

  it('has a row per analysis, empty ones marked none', () => {
    const rows = tableRows(records, () => undefined);
    expect(rows.map((r) => r.status)).toEqual(['none', 'none', 'saved', 'failed', 'none']);
    expect(rows.find((r) => r.analysis === 'peth')?.runs).toBe(1);
  });

  it('says why a run needs a rerun', () => {
    const rows = tableRows(records, (r) =>
      r.run_id === peth.run_id
        ? { matches: false, diff: ['rejected cells', 'analysis settings'] }
        : undefined,
    );
    const row = rows.find((r) => r.analysis === 'peth')!;
    expect(row.status).toBe('needs_rerun');
    expect(row.reason).toBe('rejected cells and analysis settings changed since this run');
  });

  it('marks a matching preview current and gives it the Preview type', () => {
    const preview = rec({ analysis: 'place', scope: 'preview' });
    const rows = tableRows([preview], () => ({ matches: true, diff: [] }));
    const row = rows.find((r) => r.analysis === 'place')!;
    expect(row.status).toBe('current');
    expect(row.type?.kind).toBe('preview');
    expect(row.type?.text).toBe('Preview');
  });

  it('counts runs the way the previous Results page did', () => {
    const c = tableCounts([peth], () => ({ matches: false, diff: [] }));
    expect(c).toMatchObject({ saved: 1, needRerun: 1, current: 0 });
  });
});

describe('reason and delete text', () => {
  it('joins three or more changes with commas', () => {
    expect(reasonText(['a', 'b', 'c'])).toBe('a, b and c changed since this run');
    expect(reasonText([])).toMatch(/changed since this run/);
  });
  it('says a rerun is needed when the last run goes', () => {
    expect(deleteText('PETH', 'Nov 17', 0).join(' ')).toMatch(/only PETH run with results/);
    expect(deleteText('PETH', 'Nov 17', 2, '18.2 MB').join(' ')).toMatch(
      /Removes PETH, Nov 17 completely.*all outputs \(18.2 MB\).*Other runs.*cannot be undone/,
    );
  });
});

describe('headline', () => {
  const data = (csv: string): ExplorerData => ({
    tables: [parseSavedCsv('peth.csv', csv)],
    stats: [],
    summary: { settings: {}, stats: [] },
    resultNames: [],
  });
  it('counts significant pairs out of evaluated ones', () => {
    const csv =
      'cell,behavior,response\n1,a,Excited\n2,a,Inhibited\n3,a,Not significant\n4,a,Not evaluated';
    expect(headlineOf('peth', data(csv))).toBe('2 of 3 cell-behavior pairs significant');
  });
  it('falls back to the statistics when there are no response labels', () => {
    const d = data('cell,behavior,response\n1,a,');
    d.stats = [{ name: 'x', unit: '', n: 5, basis: 'cells', pAdj: { n: 5, below: 2 } }];
    expect(headlineOf('peth', d)).toBe('2 of 5 cells below alpha');
  });
});
