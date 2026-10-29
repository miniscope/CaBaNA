// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import { analysisId } from '../lib/analyses.ts';
import { aurocSettings } from '../lib/auroc-run.ts';
import { pethSettings } from '../lib/peth-run.ts';
import { placeSettings } from '../lib/place-run.ts';
import { populationSettings } from '../lib/population-settings.ts';
import { decodeTarget } from '../lib/decoding-settings.ts';
import { openedRun } from '../lib/results-nav.ts';
import {
  frameworkNote,
  historyRecords,
  listedRecords,
  openness,
  openResult,
  overviewRows,
  pageOf,
  targetOf,
  NEWER_VERSION_TEXT,
} from '../lib/results-overview.ts';
import { stepId } from '../lib/store.ts';
import { RunBadges } from '../panels/results/RunBanner.tsx';

let n = 0;
const rec = (o: Partial<RunRecord> & { settings?: unknown }): RunRecord => {
  const { settings, ...rest } = o;
  n += 1;
  return {
    record_version: 1,
    run_id: `r${n}`,
    group_id: null,
    analysis: 'population',
    engine: 'framework',
    status: 'ok',
    scope: 'full',
    created_utc: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
    finished_utc: null,
    session: { session_id: 's', inputs: [] },
    gui: { settings: settings ?? {}, settings_sha256: 'h' },
    results_file: 'results.zip',
    errors: [],
    warnings: [],
    ...rest,
  } as RunRecord;
};

describe('targetOf', () => {
  it('describes each analysis from its saved settings', () => {
    const wrap = (analysis: unknown) => ({ analysis });
    expect(targetOf(rec({ analysis: 'place' }))).toBe('position bins');
    expect(
      targetOf(
        rec({
          analysis: 'population',
          settings: wrap({ target: 'behaviors', labels: ['a', 'b', 'c'] }),
        }),
      ),
    ).toBe('3 behaviors');
    expect(
      targetOf(
        rec({ analysis: 'population', settings: wrap({ target: 'behaviors', labels: [] }) }),
      ),
    ).toBe('all behaviors');
    expect(targetOf(rec({ analysis: 'population', settings: wrap({ target: 'position' }) }))).toBe(
      'position bins',
    );
    expect(targetOf(rec({ analysis: 'peth', settings: { align: 'offset' } }))).toBe(
      'behavior offsets',
    );
    expect(targetOf(rec({ analysis: 'peth', settings: { align: 'onset', marker: 'tone' } }))).toBe(
      'tone onsets',
    );
    expect(
      targetOf(
        rec({ analysis: 'auroc', settings: { compare: 'behavior', pairA: 'a', pairB: 'b' } }),
      ),
    ).toBe('a vs b');
    expect(targetOf(rec({ analysis: 'decoding', settings: wrap({ type: 'position' }) }))).toBe(
      'position',
    );
  });
});

describe('overviewRows', () => {
  it('picks the newest openable result per analysis and notes a newer failure', () => {
    const old = rec({ analysis: 'peth' });
    const newest = rec({ analysis: 'peth' });
    const failed = rec({ analysis: 'peth', status: 'failed', results_file: null });
    const rows = overviewRows([
      old,
      newest,
      failed,
      rec({ analysis: 'place', status: 'failed', results_file: null }),
    ]);
    expect(rows.map((r) => r.analysis)).toEqual([
      'place',
      'auroc',
      'peth',
      'decoding',
      'population',
    ]);
    const peth = rows.find((r) => r.analysis === 'peth')!;
    expect(peth.record).toBe(newest);
    expect(peth.newer).toBe(failed);
    expect(rows.find((r) => r.analysis === 'place')!.record!.status).toBe('failed');
    expect(rows.find((r) => r.analysis === 'auroc')!.record).toBeUndefined();
  });
});

describe('history and paging', () => {
  it('lists earlier executions newest first, without the ones the overview shows', () => {
    const a = rec({}),
      b = rec({}),
      c = rec({});
    const h = historyRecords([a, b, c]);
    expect(h).toEqual([b, a]);
    expect(historyRecords([a, b, c], 'place')).toEqual([]);
  });
  it('pages at 8 and clamps the page', () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    expect(pageOf(items, 0).items).toHaveLength(8);
    expect(pageOf(items, 7).items).toHaveLength(4);
    expect(pageOf(items, 99)).toMatchObject({ page: 7, pages: 8, total: 60 });
    expect(pageOf([], 0)).toMatchObject({ pages: 1, items: [] });
  });
});

describe('framework note and open rules', () => {
  it('notes a different framework commit only', () => {
    const r = rec({
      framework: { cabana_version: '1', commit: 'abcdef0123456', capabilities: {} },
    });
    expect(frameworkNote(r, 'abcdef0')).toBeUndefined();
    expect(frameworkNote(r, '1234567890')).toBe('Made with framework abcdef0; current is 1234567');
    expect(frameworkNote(r, null)).toBeUndefined();
  });
  it('blocks newer versions and failed runs, opens browser records as files', () => {
    expect(openness(rec({ record_version: 2 }))).toEqual({
      kind: 'blocked',
      reason: NEWER_VERSION_TEXT,
    });
    expect(openness(rec({ status: 'failed', results_file: null })).kind).toBe('blocked');
    expect(openness(rec({ status: 'cancelled' })).kind).toBe('full');
    expect(openness(rec({ engine: 'browser-ts', analysis: 'peth' })).kind).toBe('files');
  });
});

describe('cached-records fallback', () => {
  it('lists the saved copy while the engine is not ready', () => {
    const live = [rec({})],
      saved = [rec({}), rec({})];
    expect(listedRecords(true, live, saved)).toBe(live);
    expect(listedRecords(false, live, saved)).toBe(saved);
  });
});

describe('opening a result', () => {
  it('shows the run on its page and leaves every settings store unchanged', () => {
    const snap = () =>
      JSON.stringify([
        placeSettings,
        aurocSettings,
        pethSettings,
        populationSettings,
        decodeTarget,
      ]);
    const before = snap();
    openResult('peth', 'old-run');
    expect(openedRun('peth')).toBe('old-run');
    expect(analysisId()).toBe('peth');
    expect(stepId()).toBe('analyze');
    expect(snap()).toBe(before);
  });
});

describe('badges', () => {
  const texts = (r: RunRecord, match?: { matches: boolean; diff: string[] }) =>
    [...(RunBadges({ record: r, match }) as HTMLElement).querySelectorAll('.cb-badge')].map(
      (e) => e.textContent,
    );
  it('Preliminary and settings-changed are separate badges, whichever the other is', () => {
    const preview = rec({ scope: 'preview' });
    const full = rec({ scope: 'full' });
    expect(texts(preview, { matches: true, diff: [] })).toEqual([
      'Preliminary: 50 shuffles',
      'Matches current settings',
    ]);
    expect(texts(preview, { matches: false, diff: ['x'] })).toEqual([
      'Preliminary: 50 shuffles',
      'Settings changed since this run',
    ]);
    expect(texts(full, { matches: false, diff: ['x'] })).toEqual([
      'Full analysis',
      'Settings changed since this run',
    ]);
  });
});
