// Findings about the label files that no annotation check covers: frames where a binary column and
// a category disagree, and time markers outside the recording. Shown as flags on the Behavior and
// position box and in its QC pop-up. Pure functions of what the label tests already compute.

import { createMemo } from 'solid-js';
import { closeEntry } from './data-setup-view.ts';
import { setReviewingConflicts } from './label-view.ts';
import { plural } from './plural.ts';
import { frameAgreement, goToStep, markerFile, neuralSpan } from './store.ts';
import { outsideRecording } from './markers.ts';

export interface LabelFlag {
  title: string;
  detail: string;
  /** Where the finding can be looked at, when there is a page for it. */
  action?: 'conflicts' | 'markers';
}

export function labelFlags(i: {
  /** Frames that disagree, per label, from the frame-label agreement. */
  conflicts: { label: string; conflicts: number }[];
  /** Markers outside the recording, and how many there are in all. */
  markersOutside: number;
  markers: number;
}): LabelFlag[] {
  const bad = i.conflicts.filter((c) => c.conflicts > 0);
  const total = bad.reduce((n, c) => n + c.conflicts, 0);
  const out: LabelFlag[] = [];
  if (total)
    out.push({
      title: `${plural(total, 'frame label conflict')}`,
      detail: `a binary column and a category disagree (${bad.map((c) => c.label).join(', ')})`,
      action: 'conflicts',
    });
  if (i.markersOutside)
    out.push({
      title: `${plural(i.markersOutside, 'time marker')} outside the recording`,
      detail: `of ${i.markers.toLocaleString()}; kept, but not drawn on the session view`,
      action: 'markers',
    });
  return out;
}

/** Open the frame-label conflict review on Data setup. */
export function openConflictReview(): void {
  closeEntry();
  goToStep('load');
  setReviewingConflicts(true);
}

/** The flags of the loaded label files now. */
export const labelDataFlags = createMemo((): LabelFlag[] => {
  const markers = markerFile()?.markers ?? [];
  const span = neuralSpan();
  return labelFlags({
    conflicts: frameAgreement(),
    markersOutside: span ? outsideRecording(markers, span[0], span[1]).length : 0,
    markers: markers.length,
  });
});
