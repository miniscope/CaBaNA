// The Spatial tuning settings of the Place cells page: shuffles, significance, minimum shift and seed.

import { type JSX } from 'solid-js';
import {
  DEFAULT_PLACE_SETTINGS,
  placeOutcome,
  placeSettings,
  setPlaceSettings,
} from '../lib/place-run.ts';
import { AdvancedSeed, Note } from './parts.tsx';
import { AutoManual, Num } from './PlaceSettingFields.tsx';

/** The Spatial tuning settings of the Place cells page: shuffles, significance, minimum shift and seed. */
export function PlaceTuningSettings(): JSX.Element {
  return (
    <>
      <p class="cb-muted">
        Compare each cell’s spatial tuning with a null distribution made by circularly shifting its
        neural data relative to position. These settings decide which cells meet place-cell
        criteria.
      </p>
      <Num
        k="nShuffles"
        label="Shuffles"
        step={100}
        min={10}
        hint="Number of circular time shifts used to generate each cell’s null distribution."
      />
      <Num
        k="alpha"
        label="Significance (p <)"
        step={0.01}
        max={0.5}
        min={0.001}
        hint="Both spatial-tuning tests must meet this significance threshold."
      />
      <AutoManual
        title="Minimum circular shift"
        hint="Minimum time offset between neural data and position in shuffled data."
        auto="shiftAuto"
        k="minShiftS"
        unit="s"
        step={1}
        used={placeOutcome() && `${placeOutcome()!.minShiftS.toFixed(1)} s`}
      />
      <AdvancedSeed
        seed={placeSettings.seed}
        def={DEFAULT_PLACE_SETTINGS.seed}
        onSet={(v) => setPlaceSettings('seed', v)}
      />
      <Note title="Choosing these settings">
        <p>
          <strong>Shuffles</strong> (default 1000). The smallest p possible is 1 divided by shuffles
          + 1, so 1000 shuffles resolves p down to about 0.001. More shuffles give finer p-values,
          which a strict significance cutoff needs, but run time grows in proportion. Fewer is fine
          for a quick look.
        </p>
        <p>
          <strong>Significance</strong> (default 0.05). A cell is called a place cell when both its
          spatial information and its stability reach this p. Lowering it gives fewer cells and
          fewer chance calls; raising it does the reverse. Because both tests must pass, chance
          calls are rarer than this value. Testing many cells still produces some by chance.
        </p>
        <p>
          <strong>Minimum circular shift.</strong> A copy slides the whole series forward in time,
          wrapping around the end. That keeps the cell’s own rhythm but breaks its link to position.
          The slide must be longer than how long the cell’s data and the animal’s position stay
          correlated, or the copy still resembles the real data and real cells are missed.{' '}
          <em>Auto</em> uses 3 times the longer of those two timescales, between 5 s and a quarter
          of the session. Very long shifts leave few distinct copies in a short session.
        </p>
      </Note>
    </>
  );
}
