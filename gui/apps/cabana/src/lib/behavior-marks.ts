// What the Behavior QC pop-up marks on the epochs plot for the two limits: bouts shorter than the
// remove limit, and gaps between bouts of one label closer than the merge limit. Pure; the same
// comparisons mergeBouts and dropShortBouts make, so the marks and the counts agree.

import { dropShortBouts, mergeBouts, type Epoch } from './behavior.ts';

export interface Marks {
  /** Bouts under the limit. */
  short: Epoch[];
  /** Start times of bouts that follow a bout of the same label closer than the limit. */
  closeStarts: number[];
}

export function marksFor(epochs: Epoch[], minBoutS: number, mergeGapS: number): Marks {
  const short = epochs.filter((e) => e.stop - e.start < minBoutS);
  const closeStarts: number[] = [];
  for (const label of new Set(epochs.map((e) => e.label))) {
    const own = epochs.filter((e) => e.label === label).sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    own.forEach((e, i) => {
      if (i > 0 && e.start - reach < mergeGapS) closeStarts.push(e.start);
      reach = Math.max(reach, e.stop);
    });
  }
  return { short, closeStarts };
}

/** How many pairs of bouts a merge would join and how many bouts a remove would drop, over every file. */
export function fixCounts(
  files: Epoch[][],
  mergeGapS: number,
  minBoutS: number,
): { merge: number; drop: number } {
  let merge = 0;
  let drop = 0;
  for (const epochs of files) {
    merge += mergeBouts(epochs, mergeGapS).merged;
    drop += dropShortBouts(epochs, minBoutS).removed;
  }
  return { merge, drop };
}
