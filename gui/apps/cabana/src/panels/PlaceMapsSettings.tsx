// The Spatial maps settings of the Place cells page: speed, bin size, time per bin and smoothing.

import { type JSX } from 'solid-js';
import { arena, DEFAULT_BIN_CM, effectiveBin, setArena, setBinCm, sizeCm } from '../lib/arena.ts';
import { DEFAULT_PLACE_SETTINGS, placeOutcome } from '../lib/place-run.ts';
import { placeNeural } from '../lib/prepared.ts';
import { InfoTip } from './InfoTip.tsx';
import { Note, SpeedFilterField } from './parts.tsx';
import { AutoManual, Shared } from './PlaceSettingFields.tsx';

/** The Spatial maps settings of the Place cells page: speed, bin size, time per bin and smoothing. */
export function PlaceMapsSettings(props: { used: number }): JSX.Element {
  return (
    <>
      <div class="cb-setting">
        <div class="cb-setting__title">
          Minimum speed
          <InfoTip label="About minimum speed">
            Frames below this speed are left out of the maps and tests. Shared with position
            decoding: one value for both. auROC has its own minimum speed.
          </InfoTip>
        </div>
        <SpeedFilterField />
        <Shared>Also set in Preprocess; position decoding uses the same value.</Shared>
        <div class="cb-retained">
          <div>
            <strong>{props.used.toLocaleString()}</strong> of{' '}
            {placeNeural()!.frames.toLocaleString()} frames retained (
            {Math.round((100 * props.used) / placeNeural()!.frames)}%)
          </div>
          <progress
            class="cb-progress cb-progress--thin"
            value={props.used}
            max={placeNeural()!.frames}
          />
        </div>
        <Note title="About retained frames">
          <p>
            Only frames at or above the minimum speed are included in spatial maps and tuning tests.
            This restricts the analysis to periods of movement.
          </p>
          <p>
            The retained percentage shows how much of the recording is included. Keeping fewer
            frames can reduce spatial coverage and make rate estimates less reliable; check the
            occupancy preview to assess sampling across the arena. A speed threshold of 0 removes
            speed filtering.
          </p>
        </Note>
      </div>
      <div class="cb-setting">
        <div class="cb-setting__title">
          Spatial bin size
          <InfoTip label="About spatial bin size">Side length of each square spatial bin.</InfoTip>
        </div>
        <label
          class="cb-prep-field"
          classList={{ 'cb-prep-field--changed': effectiveBin() !== DEFAULT_BIN_CM }}
        >
          <input
            type="number"
            min="0.5"
            max={Math.min(...sizeCm()) / 2}
            step="0.5"
            value={effectiveBin()}
            onInput={(e) => setBinCm(+e.currentTarget.value || 0.5)}
          />
          cm <span class="cb-muted">default {DEFAULT_BIN_CM}</span>
        </label>
      </div>
      <div class="cb-setting">
        <div class="cb-setting__title">
          Minimum time per bin
          <InfoTip label="About minimum time per bin">
            Bins below this duration have no rate and are excluded from the spatial-tuning tests.
          </InfoTip>
        </div>
        <label
          class="cb-prep-field"
          classList={{
            'cb-prep-field--changed': arena.minOccupancy !== DEFAULT_PLACE_SETTINGS.minOccS,
          }}
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={arena.minOccupancy}
            onInput={(e) => {
              const v = +e.currentTarget.value;
              if (Number.isFinite(v)) setArena('minOccupancy', Math.max(0, v));
            }}
          />
          s <span class="cb-muted">default {DEFAULT_PLACE_SETTINGS.minOccS}</span>
        </label>
        <Shared>Shared with arena settings: Preprocess and Zone occupancy read it too.</Shared>
      </div>
      <AutoManual
        title="Smoothing"
        hint="Smooth across neighboring spatial bins to reduce variability in event-rate estimates."
        auto="sigmaAuto"
        k="sigma"
        unit="bins"
        step={0.5}
        used={
          placeOutcome() &&
          `${placeOutcome()!.sigma} bins (${(placeOutcome()!.sigma * placeOutcome()!.data.grid.bin).toFixed(1)} cm)`
        }
      />
      <Note title="Choosing these settings">
        <p>
          <strong>Bin size.</strong> Choose bins small enough to resolve spatial patterns, but large
          enough to estimate the event rate reliably. Use the occupancy preview to check coverage;
          if sampling is sparse, increase the bin size. Published calcium-imaging place maps use
          bins of about 2 to 6.5 cm (3.5 cm, Ziv et al. 2013, doi:10.1038/nn.3329; 4 cm, Rubin et
          al. 2015, doi:10.7554/eLife.12247; 6.5 cm, Cai et al. 2016, doi:10.1038/nature17955; 2 cm,
          Shuman et al. 2020, doi:10.1038/s41593-019-0559-0). Smoothing is set in bins, so changing
          the bin size changes the blur in cm.
        </p>
        <p>
          <strong>Minimum time per bin</strong> (default {DEFAULT_PLACE_SETTINGS.minOccS} s). A bin
          with less time than this has no rate in the tests. The occupancy preview shows how many
          bins meet it. The default is from the Miniscope place cell guide's example run, not from a
          paper.
        </p>
        <p>
          <strong>Smoothing</strong> is a Gaussian width in bins. Too little leaves maps spiky,
          since a bin with few events looks like a field. Too much spreads one field over its
          neighbors and merges nearby fields. <em>Auto</em> tries 0 to 4 bins and keeps the least
          smoothing that predicts held-out data about as well as the best, so no p-value is used to
          choose it. Use <em>Manual</em> to match a published pipeline or to compare sessions with
          the same width.
        </p>
      </Note>
    </>
  );
}
