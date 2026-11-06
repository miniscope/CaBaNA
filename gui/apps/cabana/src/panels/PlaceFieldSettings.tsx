// The Place fields settings of the Place cells page: fraction of peak, smallest region and time per bin.

import { type JSX } from 'solid-js';
import { Note } from './parts.tsx';
import { Num } from './PlaceSettingFields.tsx';

/** The Place fields settings of the Place cells page: fraction of peak, smallest region and time per bin. */
export function PlaceFieldSettings(): JSX.Element {
  return (
    <>
      <p class="cb-muted">
        Identify contiguous regions with event rates above a fraction of the cell’s peak. These
        settings set field outlines and field measurements. They do not change which cells meet
        place-cell criteria.
      </p>
      <Num
        k="fieldThreshold"
        label="Fraction of peak"
        step={0.05}
        min={0.05}
        max={1}
        hint="Minimum event rate for field inclusion, as a fraction of the cell’s peak rate."
      />
      <Num
        k="minFieldBins"
        label="Smallest region"
        unit="bins"
        step={1}
        min={1}
        hint="Minimum number of contiguous bins required to define a field."
      />
      <Num
        k="minOccFieldsS"
        label="Minimum time per bin"
        unit="s"
        step={0.01}
        hint="Bins below this duration are excluded when outlining place fields."
      />
      <Note title="Choosing these settings">
        <p>
          <strong>Fraction of peak</strong> (default 0.5). At 0.5 a field is every connected group
          of bins at or above half the cell’s highest rate. Raising it shrinks outlines to the core
          of each field; lowering it widens them and can join nearby fields.
        </p>
        <p>
          <strong>Smallest region</strong> (default 2 bins). Groups of fewer bins are dropped, so
          one noisy bin is not a field. The size is in bins, so a larger bin size means a larger
          area in cm.
        </p>
        <p>
          <strong>Minimum time per bin</strong> (default 0.1 s). Bins visited for less time are left
          out of field detection, so they can never be inside a field. This is separate from the
          spatial-tuning value because the two are set independently in the reference framework. The
          default is a framework default, with no published source.
        </p>
        <p>
          These settings set the outlines, the number of fields, and the in-field to out-of-field
          rate ratio shown under field measures.
        </p>
      </Note>
    </>
  );
}
