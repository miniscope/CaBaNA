// The two delete items every run menu ends with (Results window, Previous results), and what to
// forget after a run is deleted. One place, so the labels and the rules read the same everywhere.

import type { MenuItem } from '../../lib/actions-menu.ts';
import { forgetBrowserRecord } from '../../lib/browser-records.ts';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { openedRun, openRunOf } from '../../lib/results-nav.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { deleteOutputsNeeds } from './DeleteOutputs.tsx';

/** A separator, then "Delete outputs…" and "Delete run…" (red). `running`: the analysis is running. */
export function deleteItems(
  running: boolean,
  onOutputs: () => void,
  onRun: () => void,
): MenuItem[] {
  return [
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Delete outputs…',
      danger: true,
      disabled: deleteOutputsNeeds(bridgeReady()),
      onSelect: onOutputs,
    },
    {
      kind: 'action',
      label: 'Delete run…',
      danger: true,
      disabled: running
        ? 'Wait for the run to finish.'
        : bridgeReady()
          ? undefined
          : 'Needs the Python engine.',
      onSelect: onRun,
    },
  ];
}

/** Drop what pointed at a deleted run: the run Results had open and its browser-engine copy. */
export function forgetDeletedRun(r: RunRecord): void {
  if (openedRun(r.analysis as AnalysisId) === r.run_id) openRunOf(r.analysis as AnalysisId, undefined);
  void forgetBrowserRecord(r.run_id);
}
