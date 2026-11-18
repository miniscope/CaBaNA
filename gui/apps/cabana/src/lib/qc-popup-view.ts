// Which QC or Preprocess pop-up is open over Data visualization, and the review mark an Apply
// changes or Continue without changes leaves. Closing with × leaves the section not reviewed.

import { createSignal } from 'solid-js';
import { markReviewed } from './data-setup-view.ts';
import { setReviewed } from './qc-view.ts';
import { boxSlot, type ReviewBox } from './viz-reviewed.ts';

export type QcPopupId = 'neural-qc' | 'footprints-qc' | 'neural-prep';

export const [qcPopup, setQcPopup] = createSignal<QcPopupId | undefined>();
export const closeQcPopup = () => setQcPopup(undefined);

/** The QC tests (ids of qc-view's review marks) each box's pop-up covers. */
const TESTS: Partial<Record<QcPopupId, string[]>> = {
  'neural-qc': ['cells', 'decon'],
  'footprints-qc': ['footprints'],
};

/** Mark a box's file, and the QC tests the pop-up showed, as reviewed. */
export function markPopupReviewed(id: QcPopupId, box: ReviewBox): void {
  const slot = boxSlot(box);
  if (slot) markReviewed(slot);
  for (const t of TESTS[id] ?? []) setReviewed(t, true);
}
