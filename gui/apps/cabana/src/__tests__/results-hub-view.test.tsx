// @vitest-environment jsdom
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

// The real HowTo lives in a module that pulls in plot libraries with CSS the test cannot load.
vi.mock('../panels/AurocResults.tsx', () => ({ HowTo: () => null }));

import type { RunRecord } from '../lib/bridge-client.ts';
import type { ExplorerData } from '../lib/explorer-data.ts';
import { parseSavedCsv } from '../lib/results-explorer.ts';
import { exportItems } from '../lib/results-export.ts';
import { StatisticsPane, TablesPane } from '../panels/results/ExplorerPanes.tsx';

const record = (o: Partial<RunRecord>): RunRecord =>
  ({
    record_version: 1,
    run_id: 'browser-1',
    group_id: null,
    analysis: 'auroc',
    engine: 'browser-ts',
    status: 'ok',
    scope: 'full',
    created_utc: '2026-10-20T10:00:00Z',
    finished_utc: null,
    session: { session_id: 'browser', inputs: [] },
    gui: { settings: { nShuffles: 100 }, settings_sha256: 'h' },
    results_file: null,
    files: ['auroc.csv'],
    errors: [],
    warnings: [],
    ...o,
  }) as RunRecord;

const mount = (view: () => JSX.Element) => {
  const host = document.createElement('div');
  document.body.append(host); // Solid delegates click events to the document
  render(view, host);
  return host;
};

describe('Explorer panes', () => {
  const table = parseSavedCsv(
    'auroc.csv',
    '# note one\ncell,behavior,auroc,p_unadjusted\n1,a,0.7,0.01\n2,a,0.2,0.3\n3,b,0.5,0.04',
  );
  const data: ExplorerData = {
    tables: [table],
    stats: [
      {
        name: 'auROC',
        unit: '0 to 1 scale',
        n: 3,
        range: [0.2, 0.7],
        pRaw: { n: 3, below: 2 },
        basis: 'cell-behavior pairs',
        test: { nullMethod: 'circular shift', shuffles: 100, alpha: 0.05 },
      },
    ],
    summary: { settings: { shuffles: 100, alpha: 0.05 }, stats: [] },
    resultNames: ['auroc.csv'],
  };
  it('sorts a table when its column header is clicked', () => {
    const host = mount(() => TablesPane({ data }));
    const firstColumn = () =>
      [...host.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[2].textContent);
    expect(firstColumn()).toEqual(['0.7', '0.2', '0.5']);
    const header = [...host.querySelectorAll('th button')].find((b) =>
      b.textContent!.startsWith('auroc'),
    )!;
    (header as HTMLButtonElement).click();
    expect(firstColumn()).toEqual(['0.2', '0.5', '0.7']);
    (header as HTMLButtonElement).click();
    expect(firstColumn()).toEqual(['0.7', '0.5', '0.2']);
    expect(host.textContent).toContain('3 rows');
  });
  it('filters the rows of a table and lists the tables with their sizes', () => {
    const host = mount(() => TablesPane({ data }));
    expect(host.querySelector('nav')!.textContent).toContain('auroc.csv');
    expect(host.querySelector('nav')!.textContent).toContain('3 rows');
    const filter = host.querySelector('input[type="search"]') as HTMLInputElement;
    filter.value = '0.2';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.textContent).toContain('1 row match the filter');
  });
  it('gives one card per statistic with n, unit, p counts and the saved test', () => {
    const text = mount(() => StatisticsPane({ record: record({}), data })).textContent!;
    expect(text).toContain('2 of 3 cell-behavior pairs with p below 0.05');
    expect(text).toContain('3 cell-behavior pairs · 0 to 1 scale · observed 0.2 to 0.7');
    expect(text).toContain('circular shift null · 100 shuffles');
  });
  it('writes the methods from the saved numbers', () => {
    const text = mount(() => StatisticsPane({ record: record({}), data })).textContent!;
    expect(text).toContain('Methods');
    expect(text).toContain('browser-1');
    expect(text).toContain('Shuffle test: 100 shuffles, alpha 0.05');
    expect(text).toContain('Copy as text');
  });
  it('lists the exports a run has, in the order of the Export menu', () => {
    const items = (d: ExplorerData | undefined) =>
      exportItems(
        record({}),
        d,
        () => Promise.resolve(data),
        { run: () => undefined },
        () => undefined,
      )
        .filter((i) => i.kind === 'action')
        .map((i) => (i as { label: string }).label);
    expect(items(data)).toEqual([
      'Figures…',
      'Tables (CSV)…',
      'Statistics…',
      'All results (.zip)…',
      'Settings (JSON)…',
    ]);
    // Only what the run saved is offered.
    expect(items({ ...data, tables: [], stats: [] })).toEqual([
      'Figures…',
      'All results (.zip)…',
      'Settings (JSON)…',
    ]);
  });
});
