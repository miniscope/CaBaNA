// What a saved run can be exported as, for the Export submenu of the Results window: the current
// figure, its tables, statistics with the summary text, the run bundle (framework runs, with the
// engine) and the settings.

import type { MenuItem } from './actions-menu.ts';
import { bridge, type RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import type { ExplorerData } from './explorer-data.ts';
import { download } from './export-figure.ts';
import { summarySentences, type SavedTable, type StatRow } from './results-explorer.ts';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A saved table as CSV text, with its `#` notes above the header. */
export const tableCsv = (t: Pick<SavedTable, 'notes' | 'columns' | 'rows'>) =>
  [
    ...t.notes.map((n) => `# ${n}`),
    t.columns.map(csvCell).join(','),
    ...t.rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');

const alphaOf = (s: StatRow) => s.test?.alpha;
const below = (c: StatRow['pRaw']) => (c ? `${c.below} of ${c.n}` : '');

/** The statistics of a run as a table: what was saved, with the p-value counts against its alpha. */
export function statsTable(stats: StatRow[]): Pick<SavedTable, 'notes' | 'columns' | 'rows'> {
  return {
    notes: [],
    columns: [
      'statistic',
      'n',
      'basis',
      'unit',
      'smallest',
      'largest',
      'unadjusted p below alpha',
      'adjusted p below alpha',
      'null',
      'shuffles',
      'alpha',
      'correction',
    ],
    rows: stats.map((s) => [
      s.name,
      String(s.n),
      s.basis ?? '',
      s.unit,
      s.range ? String(s.range[0]) : '',
      s.range ? String(s.range[1]) : '',
      below(s.pRaw),
      below(s.pAdj),
      s.test?.nullMethod ?? '',
      s.test?.shuffles === undefined ? '' : String(s.test.shuffles),
      alphaOf(s) === undefined ? '' : String(alphaOf(s)),
      s.test?.correction ?? '',
    ]),
  };
}

/** The current figure's export, from the window: opens the plot editor, or says why it cannot. */
export interface FigureExport {
  run: () => void;
  disabled?: string;
}

/**
 * The Export submenu of one run. `data` is what the run saved, once read: Tables and Statistics
 * appear only when the run has them. `load` reads it on demand. A failure goes to `onError`.
 */
export function exportItems(
  r: RunRecord,
  data: ExplorerData | undefined,
  load: () => Promise<ExplorerData>,
  figures: FigureExport,
  onError: (message: string) => void,
): MenuItem[] {
  const base = `${r.analysis}-${r.run_id}`;
  const attempt = (work: () => Promise<void>) => () =>
    void work().catch((e) => onError(e instanceof Error ? e.message : String(e)));
  return [
    {
      kind: 'action',
      label: 'Figures…',
      disabled: figures.disabled,
      tipOnly: true,
      onSelect: figures.run,
    },
    ...(data && !data.tables.length
      ? []
      : [
          {
            kind: 'action' as const,
            label: 'Tables (CSV)…',
            onSelect: attempt(async () => {
              const d = await load();
              if (!d.tables.length) throw new Error(d.tablesNote ?? 'This run saved no tables.');
              for (const t of d.tables)
                download(`${base}-${t.name.replace(/\.csv$/, '')}.csv`, tableCsv(t), 'text/csv');
            }),
          },
        ]),
    ...(data && !data.stats.length
      ? []
      : [
          {
            kind: 'action' as const,
            label: 'Statistics…',
            onSelect: attempt(async () => {
              const d = await load();
              if (!d.stats.length) throw new Error(d.statsNote ?? 'This run saved no statistics.');
              download(`${base}-statistics.csv`, tableCsv(statsTable(d.stats)), 'text/csv');
              download(
                `${base}-summary.txt`,
                summarySentences({ record: r, ...d.summary }).join('\n'),
                'text/plain',
              );
            }),
          },
        ]),
    {
      kind: 'action',
      label: 'All results (.zip)…',
      tipOnly: true,
      disabled:
        r.engine !== 'framework'
          ? 'Only runs made by the Python engine have a bundle.'
          : bridgeReady()
            ? undefined
            : 'Needs the Python engine.',
      onSelect: attempt(async () =>
        download(`${base}.zip`, await bridge.bundle(r.run_id), 'application/zip'),
      ),
    },
    {
      kind: 'action',
      label: 'Settings (JSON)…',
      onSelect: () =>
        download(
          `${base}-settings.json`,
          JSON.stringify(r.gui.settings, null, 2),
          'application/json',
        ),
    },
  ];
}
