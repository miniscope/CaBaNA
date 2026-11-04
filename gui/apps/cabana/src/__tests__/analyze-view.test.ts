import { describe, expect, it } from 'vitest';
import {
  badge,
  blockedReason,
  dashboardStatus,
  fixLinks,
  recentResults,
  rowReason,
} from '../lib/analyze-view.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import type { Status } from '../lib/readiness.ts';

const st = (over: Partial<Status>): Status => ({ ...badge('ready'), ...over });
const rec = (run_id: string, over: Partial<RunRecord>): RunRecord =>
  ({
    run_id,
    analysis: 'place',
    engine: 'framework',
    status: 'ok',
    record_version: 1,
    created_utc: '2026-11-04T10:00:00Z',
    results_file: 'r.json',
    errors: [],
    ...over,
  }) as RunRecord;

describe('blockedReason', () => {
  it('lets ready, outdated and failed analyses start', () => {
    for (const kind of ['ready', 'outdated', 'failed'] as const)
      expect(blockedReason(badge(kind), 'why')).toBeUndefined();
  });
  it('gives the reason for analyses that cannot run', () => {
    expect(blockedReason(badge('needs_input'), 'Load a position file.')).toBe(
      'Load a position file.',
    );
    expect(blockedReason(badge('framework_update'), 'Needs update.')).toBe('Needs update.');
  });
  it('keeps a complete analysis out of a batch but allows its own Run button', () => {
    expect(blockedReason(badge('complete'), '')).toBe('Results are up to date.');
    expect(blockedReason(badge('complete'), '', { rerun: true })).toBeUndefined();
  });
  it('refuses while something else is running', () => {
    expect(blockedReason(badge('running'), '')).toBe('Already running.');
    expect(blockedReason(badge('ready'), '', { otherRunActive: true })).toMatch(/Another/);
  });
});

describe('dashboard wording', () => {
  it('says "Needs update" for outdated results only', () => {
    expect(dashboardStatus(badge('outdated')).text).toBe('Needs update');
    expect(dashboardStatus(badge('ready')).text).toBe('Ready');
    expect(dashboardStatus(badge('framework_update')).text).toBe('Framework update required');
  });
  it('every reason line says what to do', () => {
    const input = st({
      kind: 'needs_input',
      input: [
        { text: 'Load neural data.', link: { label: 'Load data', item: 'load' } },
        { text: 'Load a position file.' },
      ],
    });
    expect(rowReason(input)).toEqual({
      text: 'Load neural data. (+1 more)',
      link: { label: 'Load data', item: 'load' },
    });
    expect(rowReason(st({ kind: 'framework_update', engineOff: true })).text).toMatch(/Start/);
    expect(
      rowReason(st({ kind: 'framework_update', framework: [{ text: 'No gap.', code: 'F1' }] }))
        .text,
    ).toBe('No gap. Needs a framework update.');
    expect(rowReason(badge('outdated')).text).toMatch(/Run again/);
    expect(rowReason(badge('failed')).text).toMatch(/run again/);
  });
});

describe('recentResults', () => {
  const records = [
    rec('a', { created_utc: '2026-11-04T09:00:00Z' }),
    rec('b', {
      analysis: 'auroc',
      status: 'failed',
      results_file: null,
      created_utc: '2026-11-04T11:00:00Z',
    }),
    rec('c', {
      analysis: 'peth',
      status: 'running',
      results_file: null,
      created_utc: '2026-11-04T10:30:00Z',
    }),
  ];
  it('lists the newest first with a badge for each outcome', () => {
    const out = recentResults(records);
    expect(out.map((r) => r.record.run_id)).toEqual(['b', 'c', 'a']);
    expect(out.map((r) => r.status.text)).toEqual(['Failed', 'Running', 'Complete']);
  });
  it('only a record with results links to its result', () => {
    expect(recentResults(records).map((r) => r.openable)).toEqual([false, false, true]);
  });
  it('limits the count', () => {
    expect(recentResults(records, 2)).toHaveLength(2);
  });
});

describe('fixLinks', () => {
  const load = { label: 'Load data', item: 'load' as const };
  it('one link per fixing page, naming the analyses that wait on it', () => {
    const links = fixLinks({
      place: st({ kind: 'needs_input', input: [{ text: 'Load a position file.', link: load }] }),
      auroc: st({ kind: 'needs_input', input: [{ text: 'Load behavior.', link: load }] }),
      peth: st({ kind: 'ready' }),
      decoding: st({ kind: 'framework_update' }),
    });
    expect(links).toEqual([
      { item: 'load', label: 'Load data', forAnalyses: ['Place cells', 'auROC'] },
    ]);
  });
  it('is empty when nothing is blocked', () => {
    expect(fixLinks({ place: st({ kind: 'ready' }) })).toEqual([]);
  });
});
