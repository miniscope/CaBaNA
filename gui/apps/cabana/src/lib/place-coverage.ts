// How much of the arena the animal covered, under the same rules the analysis applies: speed-filtered
// frames, then a minimum time per bin. Spatial information uses the whole session, stability needs the
// minimum in both halves, and place fields use their own minimum over the whole session.

import { arena } from './arena.ts';
import { occupancySeconds } from './placecells.ts';
import { placeFrames, placeNeural, type PlaceFrames } from './prepared.ts';
import { placeSettings } from './place-run.ts';

export interface Coverage {
  grid: PlaceFrames['grid'];
  /** Seconds in each bin over the whole session. */
  seconds: Float64Array;
  /** Bins inside the arena. */
  open: number;
  /** Open bins meeting each rule, as counts. */
  information: number;
  stability: number;
  fields: number;
  /** Bins meeting each rule, to grey out the others. */
  validFor: { tuning: Uint8Array; fields: Uint8Array };
}

export function coverage(bin: number): Coverage | undefined {
  const f = placeFrames(bin);
  const fs = placeNeural()?.fs;
  if (!f || 'error' in f || !fs) return undefined;
  const { grid } = f;
  const { all, a, b } = occupancySeconds(f.labels, grid.nx * grid.ny, fs);
  const minT = arena.minOccupancy;
  const minF = placeSettings.minOccFieldsS;
  const tuning = new Uint8Array(all.length);
  const fields = new Uint8Array(all.length);
  let open = 0;
  let information = 0;
  let stability = 0;
  let nFields = 0;
  all.forEach((v, k) => {
    if (!grid.open[k]) return;
    open++;
    if (v >= minT && v > 0) information++;
    if (a[k] >= minT && b[k] >= minT && a[k] > 0 && b[k] > 0) {
      stability++;
      tuning[k] = 1;
    }
    if (v >= minF && v > 0) {
      nFields++;
      fields[k] = 1;
    }
  });
  return {
    grid,
    seconds: all,
    open,
    information,
    stability,
    fields: nFields,
    validFor: { tuning, fields },
  };
}
