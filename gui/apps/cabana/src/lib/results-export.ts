// What a saved run can be exported as, for the Actions menus of the Results pages: its tables,
// settings, summary text and (framework runs, with the engine) the run bundle. Figures are
// exported from each plot.

import type { MenuItem } from './actions-menu.ts';
import { bridge, type RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import type { ExplorerData } from './explorer-data.ts';
import { download } from './export-figure.ts';
import { summarySentences, type SavedTable } from './results-explorer.ts';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A saved table as CSV text, with its `#` notes above the header. */
export const tableCsv = (t: SavedTable) =>
  [
    ...t.notes.map((n) => `# ${n}`),
    t.columns.map(csvCell).join(','),
    ...t.rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');

/**
 * The export items of one run. `load` reads what the run saved (it may be called more than once;
 * callers keep the result). A failure is passed to `onError` in words.
 */
export function exportItems(
  r: RunRecord,
  load: () => Promise<ExplorerData>,
  onError: (message: string) => void,
): MenuItem[] {
  const base = `${r.analysis}-${r.run_id}`;
  const attempt = (work: () => Promise<void>) => () =>
    void work().catch((e) => onError(e instanceof Error ? e.message : String(e)));
  return [
    {
      kind: 'action',
      label: 'Tables (CSV)',
      sub: 'One file per saved table',
      onSelect: attempt(async () => {
        const data = await load();
        if (!data.tables.length) throw new Error(data.tablesNote ?? 'This run saved no tables.');
        for (const t of data.tables)
          download(`${base}-${t.name.replace(/\.csv$/, '')}.csv`, tableCsv(t), 'text/csv');
      }),
    },
    {
      kind: 'action',
      label: 'Summary text',
      onSelect: attempt(async () => {
        const data = await load();
        download(
          `${base}-summary.txt`,
          summarySentences({ record: r, ...data.summary }).join('\n'),
          'text/plain',
        );
      }),
    },
    {
      kind: 'action',
      label: 'Settings (JSON)',
      onSelect: () =>
        download(
          `${base}-settings.json`,
          JSON.stringify(r.gui.settings, null, 2),
          'application/json',
        ),
    },
    {
      kind: 'action',
      label: 'Run bundle (zip)',
      sub: 'Settings, pipeline and results',
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
  ];
}
