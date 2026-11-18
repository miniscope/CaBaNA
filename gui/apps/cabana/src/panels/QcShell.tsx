// What the file QC view (data-setup/FileQc.tsx) takes from the old Data QC frame: the wording of
// a test's result and which plot tab is shown.

import type { Status } from '../lib/qc.ts';
import { qcPlotTab } from '../lib/qc-view.ts';
import type { PlotTest } from './QcPanel.tsx';

export const RESULT: Record<Status | 'none', string> = {
  pass: 'Pass',
  warn: 'Note',
  fail: 'Fail',
  none: 'Not checked',
};

/** The plot tab currently shown for a test. */
export function plotTabOf(cat: PlotTest): string {
  const id = qcPlotTab[cat.id];
  return (cat.tabs ?? []).some((t) => t.id === id) ? id : (cat.tabs?.[0]?.id ?? '');
}
