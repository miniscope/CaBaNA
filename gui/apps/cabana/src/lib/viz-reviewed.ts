// "N of M reviewed" under Data visualization in the sidebar: the boxes whose file has been
// reviewed. Opening a file's QC marks it reviewed; the count only reads those marks.

import { analysisSlot } from './analysis-data.ts';
import { reviewed } from './data-setup-view.ts';
import { setVizReviewSource } from './readiness-snapshot.ts';
import type { SlotId } from './slots.ts';
import { loaded } from './store.ts';

export type ReviewBox = 'neural' | 'footprints' | 'arena' | 'behavior';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** The file that holds the behavior annotations, else the zone annotations. */
export const behaviorSlot = (): SlotId | undefined =>
  (['behavior_annotations', 'zone_annotations'] as SlotId[]).find(isLoaded);

/** The file each box is reviewed through; none when it is not loaded. */
export const boxSlot = (box: ReviewBox): SlotId | undefined =>
  box === 'neural'
    ? analysisSlot()
    : box === 'footprints'
      ? isLoaded('footprints')
        ? 'footprints'
        : undefined
      : box === 'arena'
        ? isLoaded('position')
          ? 'position'
          : undefined
        : behaviorSlot();

export function reviewCount(): { reviewed: number; total: number } {
  const slots = (['neural', 'footprints', 'arena', 'behavior'] as ReviewBox[])
    .map(boxSlot)
    .filter((s): s is SlotId => !!s);
  return { reviewed: slots.filter((s) => reviewed(s)).length, total: slots.length };
}

setVizReviewSource(() => reviewCount);
