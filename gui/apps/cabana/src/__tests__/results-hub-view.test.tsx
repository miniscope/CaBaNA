// @vitest-environment jsdom
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

// The real HowTo lives in a module that pulls in plot libraries with CSS the test cannot load.
vi.mock('../panels/AurocResults.tsx', () => ({ HowTo: () => null }));

import type { RunRecord } from '../lib/bridge-client.ts';
import type { ExplorerData } from '../lib/explorer-data.ts';
import { analysisCards } from '../lib/results-hub.ts';
import { parseSavedCsv } from '../lib/results-explorer.ts';
import {
  ExportPane,
  StatisticsPane,
  SummaryPane,
  TablesPane,
} from '../panels/results/ExplorerPanes.tsx';
import { ResultsHub } from '../panels/results/ResultsHub.tsx';

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

describe('ResultsHub', () => {
  const cards = analysisCards([
    record({}),
    record({ run_id: 'browser-2', scope: 'preview' }),
    record({ run_id: 'p1', analysis: 'place', files: ['place_cells.csv'] }),
  ]);
  it('shows one card per analysis with counts from the saved runs', () => {
    const host = mount(() =>
      ResultsHub({ cards, matchOf: () => undefined, onDeleted: () => undefined }),
    );
    expect(host.querySelectorAll('.cb-hc')).toHaveLength(5);
    const auroc = host.querySelector('[data-analysis="auroc"]')!.textContent!;
    expect(auroc).toContain('2 runs: 1 full, 1 preliminary');
    expect(auroc).toContain('Explore results');
    expect(auroc).toContain('Edit analysis');
    expect(host.querySelector('[data-analysis="peth"]')!.textContent).toContain('No result yet');
  });
  it('lists Compare analyses as unavailable and leaves the plot editor slot empty by default', () => {
    const host = mount(() =>
      ResultsHub({ cards, matchOf: () => undefined, onDeleted: () => undefined }),
    );
    const compare = host.querySelector('[aria-label="Compare analyses"]')!;
    expect(compare.textContent).toContain('Descriptive only, coming later');
    expect(compare.querySelector('button')!.disabled).toBe(true);
    expect(host.querySelector('[aria-label="Plot editor (preview)"]')).toBeNull();
  });
  it('renders what is passed in the plot editor slot', () => {
    const entry = document.createElement('span');
    entry.textContent = 'Plot editor (preview)';
    const host = mount(() =>
      ResultsHub({
        cards,
        matchOf: () => undefined,
        onDeleted: () => undefined,
        plotEditor: entry,
      }),
    );
    expect(host.querySelector('[aria-label="Plot editor (preview)"]')!.contains(entry)).toBe(true);
  });
});

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
  it('states each statistic with n, unit, p counts and the saved test', () => {
    const text = mount(() => StatisticsPane({ data })).textContent!;
    expect(text).toContain('3 cell-behavior pairs');
    expect(text).toContain('0.2 to 0.7');
    expect(text).toContain('0 to 1 scale');
    expect(text).toContain('2 of 3 below 0.05');
    expect(text).toContain('circular shift');
    expect(text).toContain('none saved'); // no adjusted p was saved
  });
  it('writes the summary from the saved numbers and offers the exports', () => {
    const r = record({});
    const summary = mount(() => SummaryPane({ record: r, data })).textContent!;
    expect(summary).toContain('browser-1');
    expect(summary).toContain('Shuffle test: 100 shuffles, alpha 0.05');
    const exports = mount(() => ExportPane({ record: r, data })).textContent!;
    expect(exports).toContain('Download auroc.csv as CSV');
    expect(exports).not.toContain('Export run bundle'); // browser-engine run: no bundle
  });
});
