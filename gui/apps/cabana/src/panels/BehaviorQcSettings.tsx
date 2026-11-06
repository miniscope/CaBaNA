// Behavioral QC settings: the limits and thresholds of every test in one popover.
import type { JSX } from 'solid-js';
import { maxSpeed, setMaxSpeed, source } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { QcSettings } from './QcParts.tsx';

/** Every limit and threshold of the Behavioral tab, grouped by test. */
export function behaviorSettings(): JSX.Element {
  return (
    <QcSettings
      groups={[
        {
          title: 'Timing and alignment',
          children: (
            <div class="cb-setting">
              <span>Behavior clock offset</span>
              <InfoTip label="About the clock offset">
                Seconds subtracted from the camera timestamps, before the clock scale, to put them
                on the neural clock: neural time = scale × (camera time − offset). Set it in
                Experimental Setup when the camera started before or after the miniscope.
              </InfoTip>
              <b>{source.clockOffsetS} s</b>
            </div>
          ),
        },
        {
          title: 'Position tracking',
          keys: ['lostPct', 'jumpPct'],
          children: (
            <div class="cb-setting">
              <label for="cb-jump">Jump threshold</label>
              <InfoTip label="About the jump threshold">
                Steps between two tracked frames faster than this speed are flagged as jumps. A jump
                usually means the tracker lost the animal, locked onto a reflection, or swapped
                identity. Changing it updates the flags at once. Whether the test passes depends on
                the Jump steps limit below. Default 60 cm/s.
              </InfoTip>
              <input
                id="cb-jump"
                type="number"
                min="1"
                value={maxSpeed()}
                onInput={(e) => setMaxSpeed(+e.currentTarget.value || 60)}
              />
              <span class="cb-muted">cm/s</span>
            </div>
          ),
        },
        { title: 'Annotations', keys: ['annotPct', 'minBoutS', 'mergeGapS'] },
      ]}
    />
  );
}

