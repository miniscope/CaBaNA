// The limits and thresholds of the behavior QC tests, as groups for the QC settings window.
import { maxSpeed, setMaxSpeed } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import type { SettingsGroup } from './QcParts.tsx';

export const positionSettings = (): SettingsGroup => ({
  title: 'Position tracking',
  keys: ['lostPct', 'jumpPct'],
  children: (
    <div class="cb-setting">
      <label for="cb-jump">Jump threshold</label>
      <InfoTip label="About the jump threshold">
        Steps between two tracked frames faster than this speed are flagged as jumps. A jump usually
        means the tracker lost the animal, locked onto a reflection, or swapped identity. Changing
        it updates the flags at once. Whether the test passes depends on the Jump steps limit below.
        Default 60 cm/s.
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
});

export const annotationSettings = (): SettingsGroup => ({
  title: 'Annotations',
  keys: ['annotPct', 'minBoutS', 'mergeGapS'],
});
