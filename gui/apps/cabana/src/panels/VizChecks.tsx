// Where each box's review opens, and the pills in each box's title row. Neural data and
// Footprints open their own QC and Preprocess pop-ups; the other boxes still open the file pop-up
// Data setup uses, at the file's QC or Preprocess step.

import { analysisSlot } from '../lib/analysis-data.ts';
import { kernelChecks } from '../lib/decon-state.ts';
import { openEntry } from '../lib/data-setup-view.ts';
import { choiceOf } from '../lib/position-corrections.ts';
import type { SlotId } from '../lib/slots.ts';
import { annotationResults, footprints, loaded, traceMatrix } from '../lib/store.ts';
import {
  correctionPill,
  forBox,
  preprocessPill,
  qcPill,
  type BoxPill,
  type VizBox,
} from '../lib/viz-pills.ts';
import { behaviorSlot } from '../lib/viz-reviewed.ts';
import { changes } from './ChangesDrawer.tsx';
import { flaggedOf } from './BehaviorQcAnnotations.tsx';
import { posOk, segments } from './BehaviorQc.tsx';
import { pickTest } from './data-setup/FileQc.tsx';
import { setQcPopup, type QcPopupId } from '../lib/qc-popup-view.ts';
import { cellChecks, flaggedCells, overlapPairs } from './NeuralQcShared.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;
const fails = (c: { status: string }[]) => c.filter((x) => x.status === 'fail').length;

/** Open a file's pop-up at its QC step, on one of its tests when given. */
function openQc(slot: SlotId, test?: string): void {
  if (test) pickTest(slot, test);
  openEntry(slot, 'qc');
}

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
  position: () => (isLoaded('position') ? () => openQc('position') : undefined),
  arena: () => (isLoaded('position') ? () => openQc('position') : undefined),
  behavior: () => {
    const s = behaviorSlot();
    return s ? () => openQc(s) : undefined;
  },
};

/** What each box's Preprocess opens: the file's Preprocess step. */
export const PREPROCESS: Record<Exclude<VizBox, 'footprints'>, () => (() => void) | undefined> = {
  neural: () => (analysisSlot() ? openPopup('neural-prep') : undefined),
  arena: () => (isLoaded('position') ? () => openEntry('position', 'prep') : undefined),
  behavior: () => {
    const s = behaviorSlot() ?? (isLoaded('position') ? 'position' : undefined);
    return s ? () => openEntry(s, 'prep') : undefined;
  },
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
      if (!files.length) return undefined;
      return qcPill({
        flagged: files.reduce(
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
  return REVIEW[box]();
}
