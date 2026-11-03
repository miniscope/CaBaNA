// Every engine's runs are saved as records in one list. A browser run survives a reload, is
// copied to the project once, and shows in both histories. Only a successful run with results
// counts as the analysis's result; a later failed, partial or cancelled attempt never replaces it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';

/** Just enough IndexedDB for the results cache: one object store, get and put. */
function fakeIndexedDb(): void {
  const data = new Map<string, unknown>();
  const later = (f: () => void) => setTimeout(f, 0);
  const store = {
    get(key: string) {
      const req: Record<string, unknown> = {};
      later(() => {
        req.result = structuredClone(data.get(key));
        (req.onsuccess as () => void)?.();
      });
      return req;
    },
    put(value: unknown, key: string) {
      data.set(key, structuredClone(value));
    },
  };
  const db = {
    transaction: () => {
      const tx: Record<string, unknown> = { objectStore: () => store };
      later(() => (tx.oncomplete as () => void)?.());
      return tx;
    },
    createObjectStore: () => store,
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open() {
      const req: Record<string, unknown> = { result: db };
      later(() => (req.onsuccess as () => void)?.());
      return req;
    },
  };
}
fakeIndexedDb();

const rec = (o: Partial<RunRecord>): RunRecord =>
  ({
    record_version: 1,
    run_id: crypto.randomUUID(),
    group_id: null,
    analysis: 'population',
    engine: 'framework',
    status: 'ok',
    scope: 'full',
    created_utc: '2026-11-01T10:00:00Z',
    finished_utc: null,
    session: { session_id: 's', inputs: [] },
    gui: { settings: {}, settings_sha256: 'h' },
    results_file: 'results.zip',
    errors: [],
    warnings: [],
    ...o,
  }) as RunRecord;

afterEach(() => vi.restoreAllMocks());

describe('which run is the result', () => {
  it('a newer failed, partial or cancelled attempt never replaces the newest result', async () => {
    const { runOutcome } = await import('../lib/result-index.ts');
    const good = rec({ created_utc: '2026-11-01T10:00:00Z' });
    for (const status of ['failed', 'partial', 'cancelled'] as const) {
      const later = rec({ status, created_utc: '2026-11-02T10:00:00Z' });
      const o = runOutcome('population', [later, good]);
      expect(o.result?.run_id).toBe(good.run_id);
      expect(o.lastAttempt?.status).toBe(status);
    }
    // Only an attempt newer than the result is reported.
    const old = rec({ status: 'failed', created_utc: '2026-10-01T10:00:00Z' });
    expect(runOutcome('population', [good, old]).lastAttempt).toBeUndefined();
    // A cancelled or partial run alone is not a result, even with a results file.
    expect(runOutcome('population', [rec({ status: 'partial' })]).result).toBeUndefined();
    expect(runOutcome('population', [rec({ status: 'cancelled' })]).result).toBeUndefined();
  });
});

describe('browser runs', () => {
  it('are saved as records, listed with the others, and survive a reload', async () => {
    const { bridge } = await import('../lib/bridge-client.ts');
    vi.spyOn(bridge, 'listRuns').mockRejectedValue(new Error('engine not running'));
    const { saveBrowserRun, browserRecords } = await import('../lib/browser-records.ts');
    const { resultIndex, hasSavedResults, runOutcome } = await import('../lib/result-index.ts');
    const { historyRecords, overviewRows } = await import('../lib/results-overview.ts');

    const r = await saveBrowserRun({
      analysis: 'place',
      settings: { nShuffles: 1000, seed: 3 },
      seed: 3,
      files: { 'place_cells.csv': 'cell,information\n0,0.1\n' },
      started: new Date('2026-11-03T09:00:00Z'),
    });
    expect(r.engine).toBe('browser-ts');
    expect(browserRecords()[0].run_id).toBe(r.run_id);
    expect(resultIndex().map((x) => x.run_id)).toContain(r.run_id);
    expect(hasSavedResults()).toBe(true);
    expect(runOutcome('place').result?.run_id).toBe(r.run_id);
    // Latest results show the newest run; history ("earlier executions") the ones before it.
    const newer = await saveBrowserRun({
      analysis: 'place',
      settings: { nShuffles: 1000, seed: 4 },
      files: { 'place_cells.csv': 'cell,information\n0,0.2\n' },
      started: new Date('2026-11-03T10:00:00Z'),
    });
    expect(
      overviewRows(resultIndex()).find((row) => row.analysis === 'place')?.record?.run_id,
    ).toBe(newer.run_id);
    expect(historyRecords(resultIndex(), 'place').map((x) => x.run_id)).toEqual([r.run_id]);
    expect(historyRecords(resultIndex()).map((x) => x.run_id)).toContain(r.run_id);

    // A reload starts the modules again; the record comes back from this browser's storage.
    await new Promise((done) => setTimeout(done, 10));
    vi.resetModules();
    const again = await import('../lib/browser-records.ts');
    expect(again.browserRecords()).toEqual([]);
    await again.loadBrowserRecords();
    expect(again.browserRecords().map((x) => x.run_id)).toContain(r.run_id);
    expect(again.keptFile(r.run_id, 'place_cells.csv')).toMatch(/^cell,information/);
  });

  it('are copied to the project once, and never over a record it already has', async () => {
    vi.resetModules();
    const { bridge } = await import('../lib/bridge-client.ts');
    const list = vi.spyOn(bridge, 'listRuns').mockRejectedValue(new Error('engine not running'));
    const post = vi.spyOn(bridge, 'saveBrowserRecord').mockResolvedValue(undefined);
    const { saveBrowserRun, syncBrowserRecords } = await import('../lib/browser-records.ts');
    const a = await saveBrowserRun({
      analysis: 'peth',
      settings: {},
      files: { 'peth.csv': 'x' },
      started: new Date(),
    });
    const b = await saveBrowserRun({
      analysis: 'peth',
      settings: {},
      files: { 'peth.csv': 'y' },
      started: new Date(),
    });
    expect(post).not.toHaveBeenCalled();

    // The engine comes up and already has b (copied from another browser, say).
    list.mockResolvedValue([{ run_id: b.run_id } as RunRecord]);
    await syncBrowserRecords();
    expect(post.mock.calls.map((c) => (c[0] as { run_id: string }).run_id)).toEqual([a.run_id]);
    await syncBrowserRecords();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
