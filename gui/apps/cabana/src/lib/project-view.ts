// Words and numbers the project windows show: storage rows, export sizes, how a comparison with a
// run reads. Pure functions of what the engine reports.

import type { ExportInclude, FileChange, Retention, StorageReport } from './projects-client.ts';

export const RETENTION: { id: Retention; label: string }[] = [
  { id: 'every', label: 'Every run' },
  { id: 'latest3', label: 'Latest 3 runs' },
  { id: 'current', label: 'Current run only' },
];

/** "39.4 MB", "0.2 MB", "3.1 GB"; sizes under 1 KB in bytes. */
export function sizeText(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e5) return `${(n / 1e3).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export interface StorageRow {
  id: string;
  label: string;
  bytes: number;
  note: string;
  /** Present when the engine can delete this category. */
  deletable: boolean;
  /** What the confirmation says happens next, in words. */
  consequence: string;
}

const STORAGE_LABEL: Record<string, [string, string, string]> = {
  data: ['Original data', 'referenced, never changed', ''],
  config: ['Configuration and history', '', ''],
  current_runs: [
    'Analysis results',
    'the newest run of each analysis',
    'Results are kept; nothing to delete here.',
  ],
  old_runs: [
    'Older runs',
    'outputs deleted, records kept',
    'Their large files are deleted. The records, settings and summary tables stay, so the runs stay listed as "outputs deleted" and need a rerun to be explored again.',
  ],
  figures: [
    'Figures',
    '',
    'Saved figures are deleted. Results stay; figures are made again when exported.',
  ],
  previews: [
    'Preview runs',
    '',
    'Preview runs are deleted. They are made again by running a preview.',
  ],
  processed: [
    'Processed intermediates',
    'regenerated when needed',
    'They are made again the next time an analysis runs, which takes longer once.',
  ],
};
const STORAGE_ORDER = [
  'data',
  'config',
  'current_runs',
  'old_runs',
  'figures',
  'previews',
  'processed',
];

/** The storage report as rows in the order of the Storage section. */
export function storageRows(report: StorageReport): StorageRow[] {
  const rows = report.categories.map((c) => {
    const [label, note, consequence] = STORAGE_LABEL[c.id] ?? [c.label, '', ''];
    return { id: c.id, label, bytes: c.bytes, note, deletable: c.deletable, consequence };
  });
  return rows.sort((a, b) => STORAGE_ORDER.indexOf(a.id) - STORAGE_ORDER.indexOf(b.id));
}

/** Sizes for the export choices; results are every run's record and outputs. */
export function exportSizes(
  report: StorageReport,
): Record<'config' | 'results' | 'figures' | 'data', number> {
  const of = (id: string) => report.categories.find((c) => c.id === id)?.bytes ?? 0;
  return {
    config: of('config'),
    results: of('current_runs') + of('old_runs'),
    figures: of('figures'),
    data: of('data'),
  };
}

/** What the zip will hold, in bytes, for the chosen includes (configuration is always in). */
export function exportTotal(sizes: ReturnType<typeof exportSizes>, include: ExportInclude): number {
  return (
    sizes.config +
    (include.results ? sizes.results : 0) +
    (include.figures ? sizes.figures : 0) +
    (include.data ? sizes.data : 0)
  );
}

/** One line of a file shown in the viewer, with how it differs from a run's copy. */
export interface ViewLine {
  n: number;
  text: string;
  /** Changed since the run: the line is highlighted. */
  changed: boolean;
  /** The run's own lines that this one replaced, shown struck above it. */
  was: string[];
}

/** Number the lines of `text` and mark those a comparison says changed, with the run's version. */
export function viewLines(text: string, changes: FileChange[] = []): ViewLine[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const out: ViewLine[] = lines.map((t, i) => ({ n: i + 1, text: t, changed: false, was: [] }));
  for (const c of changes) {
    const [first, last] = c.current_lines;
    for (let n = first; n <= last; n++) if (out[n - 1]) out[n - 1].changed = true;
    // The run's lines go above the first changed line (or the line the change sits at).
    const at = out[Math.max(0, first - 1)];
    if (at && c.run.length) at.was = c.run;
  }
  return out;
}

/** The changes as short sentences for the side column: what the run had and what is there now. */
export function differenceTexts(changes: FileChange[]): string[] {
  return changes.map((c) => {
    const now =
      c.current
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ') || 'removed';
    const was =
      c.run
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ') || 'not there';
    return `${now} (run: ${was})`;
  });
}
