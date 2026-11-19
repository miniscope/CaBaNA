// Where each box's review opens, and the pills in each box's title row. Each box opens its own
// QC and Preprocess pop-up (panels/QcPopups.tsx).

import { analysisSlot } from '../lib/analysis-data.ts';
import { kernelChecks } from '../lib/decon-state.ts';
import { choiceOf } from '../lib/position-corrections.ts';
import type { SlotId } from '../lib/slots.ts';
import { annotationResults, footprints, goToStep, loaded, traceMatrix } from '../lib/store.ts';
import {
  correctionPill,
  forBox,
  preprocessPill,
  qcPill,
  type BoxPill,
  type VizBox,
} from '../lib/viz-pills.ts';
import { behaviorSlot } from '../lib/viz-reviewed.ts';
import { labelDataFlags, openConflictReview } from '../lib/label-flags.ts';
import { changes } from './ChangesDrawer.tsx';
import { flaggedOf, posOk, segments } from './BehaviorQc.tsx';
import { openEntry } from '../lib/data-setup-view.ts';
import { setQcPopup, type QcPopupId } from '../lib/qc-popup-view.ts';
import { cellChecks, flaggedCells, overlapPairs } from './NeuralQcShared.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;
const fails = (c: { status: string }[]) => c.filter((x) => x.status === 'fail').length;

const openMarkersPage = () => {
  goToStep('load');
  openEntry('time_markers');
};

const openPopup = (id: QcPopupId) => () => setQcPopup(id);

/** What each box's Review QC opens. Unavailable when the file it needs is not loaded. */
export const REVIEW: Record<VizBox | 'position', () => (() => void) | undefined> = {
  footprints: () =>
    isLoaded('footprints')
      ? openPopup('footprints-qc')
      : analysisSlot()
        ? openPopup('neural-qc')
        : undefined,
  neural: () => (analysisSlot() ? openPopup('neural-qc') : undefined),
  position: () => (isLoaded('position') ? openPopup('position-qc') : undefined),
  arena: () => (isLoaded('position') ? openPopup('position-qc') : undefined),
  behavior: () => (behaviorSlot() ? openPopup('behavior-qc') : undefined),
};

/** What each box's Preprocess opens. Behavior's is bout padding; without annotations it is position's. */
export const PREPROCESS: Record<Exclude<VizBox, 'footprints'>, () => (() => void) | undefined> = {
  neural: () => (analysisSlot() ? openPopup('neural-prep') : undefined),
  arena: () => (isLoaded('position') ? openPopup('position-prep') : undefined),
  behavior: () =>
    behaviorSlot()
      ? openPopup('behavior-prep')
      : isLoaded('position')
        ? openPopup('position-prep')
        : undefined,
};

/** The QC pill of a box, from the checks the QC tests already ran; none when its file is not loaded. */
function qcOf(box: VizBox): BoxPill | undefined {
  switch (box) {
    case 'footprints':
      return footprints() || traceMatrix()
        ? qcPill({ overlaps: overlapPairs().length })
        : undefined;
    case 'neural': {
      if (!traceMatrix() && !analysisSlot()) return undefined;
      const notes = fails(cellChecks()) + kernelChecks().filter((c) => c.status !== 'pass').length;
      return qcPill({ flagged: flaggedCells().length, notes });
    }
    case 'arena': {
      const p = posOk();
      if (!p) return undefined;
      // A jump with a correction chosen is counted in its own pill, not as an open flag.
      return qcPill({
        flagged: fails(p.checks) + segments().filter((s) => !choiceOf(s)).length,
      });
    }
    case 'behavior': {
      const files = annotationResults();
      const labels = labelDataFlags().length;
      if (!files.length && !labels) return undefined;
      return qcPill({
        flagged:
          labels +
          files.reduce(
            (n, a) => n + (a.error ? 1 : fails(a.checks)) + flaggedOf(a.id).length + a.pairs.length,
            0,
          ),
      });
    }
  }
}

/** The pills of a box: QC, corrections applied (when any), and preprocessing. */
export function boxPills(box: VizBox): BoxPill[] {
  const entries = forBox(changes(), box);
  const of = (group: 'correction' | 'prep') => entries.filter((e) => e.group === group).length;
  return [
    qcOf(box),
    correctionPill(of('correction')),
    box === 'footprints' ? undefined : preprocessPill(of('prep')),
  ].filter((p): p is BoxPill => !!p);
}

/** What a pill opens: the box's QC or Preprocess pop-up. */
export function pillTarget(box: VizBox, pill: BoxPill): (() => void) | undefined {
  if (pill.kind === 'prep') return box === 'footprints' ? undefined : PREPROCESS[box]();
  const review = REVIEW[box]();
  // Without annotation files the box's flags are label findings; their page is on Data setup.
  if (!review && box === 'behavior' && labelDataFlags().length)
    return labelDataFlags()[0].action === 'conflicts' ? openConflictReview : openMarkersPage;
  return review;
}
