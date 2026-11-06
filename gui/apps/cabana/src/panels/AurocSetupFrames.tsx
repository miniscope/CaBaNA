// auROC setup: the frame selection section (optional speed filter and the frames it keeps).
import { Show, type JSX } from 'solid-js';
import { aurocSettings, DEFAULT_AUROC_SETTINGS, setAurocSettings } from '../lib/auroc-run.ts';
import { frameSelectionText, percentOf, type frameSelection } from '../lib/auroc-setup.ts';
import { InfoTip } from './InfoTip.tsx';
import { NumInput } from './AurocPanel.tsx';

export function AurocFramesSection(props: {
  frames: () => NonNullable<ReturnType<typeof frameSelection>>;
}): JSX.Element {
  const frames = () => props.frames();
  return (
    <>
      <p class="cb-muted">
        Optional. auROC has its own speed filter, separate from Preprocess and Place cells. Excluded
        frames are left out of the behavior and comparison groups alike.
      </p>
      <label class="cb-as-check">
        <input
          type="checkbox"
          checked={aurocSettings.speedFilter}
          onChange={(e) => setAurocSettings('speedFilter', e.currentTarget.checked)}
        />
        Exclude frames below a minimum speed
        <InfoTip label="About the speed filter">
          Excludes slow frames before the behavior and comparison groups are formed, in both alike.
          This is different from speed matching, which does not change the groups: it only limits
          which circular shifts are used for the comparison distribution. Frames with no speed value
          cannot be checked against the threshold, so they are excluded too and counted as missing
          speed. Off: auROC does not use position and keeps every frame.
        </InfoTip>
      </label>
      <div class="cb-as-check">
        Minimum speed:
        <NumInput k="minSpeed" step={0.5} unit="cm/s" label="Minimum speed" />
        <span class="cb-muted">default {DEFAULT_AUROC_SETTINGS.minSpeed}</span>
      </div>
      <Show
        when={
          aurocSettings.speedFilter &&
          !(Number.isFinite(aurocSettings.minSpeed) && aurocSettings.minSpeed >= 0)
        }
      >
        <div class="cb-warn">Enter a minimum speed of 0 cm/s or more.</div>
      </Show>
      <dl class="cb-au-kept">
        <dt>Frames kept</dt>
        <dd>
          <b>{frames()!.kept.toLocaleString()}</b> of {frames()!.total.toLocaleString()} (
          {percentOf(frames()!.kept, frames()!.total)})
        </dd>
        <dt>Excluded: below minimum speed</dt>
        <dd>{frames()!.slow.toLocaleString()}</dd>
        <dt>Excluded: missing speed</dt>
        <dd>{frames()!.missingSpeed.toLocaleString()}</dd>
      </dl>
      <progress
        class="cb-progress cb-progress--thin"
        value={frames()!.kept}
        max={frames()!.total || 1}
      />
      <div class="cb-as-scope">{frameSelectionText(frames()!)}</div>
    </>
  );
}
