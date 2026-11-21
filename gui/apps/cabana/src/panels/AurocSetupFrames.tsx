// auROC setup: the frame selection section (optional speed filter and the frames it keeps).
import { For, Show, type JSX } from 'solid-js';
import {
  aurocBinSuggestion,
  aurocSettings,
  DEFAULT_AUROC_SETTINGS,
  setAurocSettings,
} from '../lib/auroc-run.ts';
import { suggestionText } from '../lib/auroc-bin.ts';
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
      <TimeBin />
    </>
  );
}

const BIN_MODES = [
  { id: 'off', title: 'Off', text: 'Every frame is one data point.' },
  { id: 'auto', title: 'Suggested from the data', text: '' },
  { id: 'manual', title: 'Set by hand', text: '' },
] as const;

/** Optional time bins: off, the suggestion from the data, or a typed length. */
function TimeBin(): JSX.Element {
  const sug = aurocBinSuggestion;
  const sugText = () => {
    const s = sug();
    if (!s) return '';
    return s.binS ? `${s.binS} s. ${suggestionText(s)}` : `no binning. ${suggestionText(s)}`;
  };
  const pick = (id: (typeof BIN_MODES)[number]['id']) => {
    // A hand-set bin starts from the suggestion (or 0.5 s when the suggestion keeps frames).
    if (id === 'manual' && aurocSettings.binMode !== 'manual')
      setAurocSettings('binS', sug()?.binS || 0.5);
    setAurocSettings('binMode', id);
  };
  return (
    <div class="cb-au-bin">
      <div class="cb-au-pickhead">
        <b>Time bin</b>
        <InfoTip label="About the time bin">
          Deconvolved events are mostly exact zeros, and tied zeros cannot be ranked, so auROC on
          single frames stays close to 0.5 even for strongly responding cells. Summing events in
          time bins first lets auROC reflect the size of the response. Significance is tested the
          same way either way (circular shifts, now in whole bins). A bin that is only partly in a
          compared behavior is left out of both groups, so activity just before or after a bout is
          not counted for it; a bin counts as included when at least half of its frames are. Keep
          bins well inside the bouts: the longer the bin, the more bins straddle a bout's start or
          end and are left out. The suggestion is the shortest bin in which a typical cell is zero
          in at most a quarter of the bins, no longer than a third of the shortest typical bout. The
          minimum of 20 frames per group then counts bins.
        </InfoTip>
      </div>
      <div class="cb-au-refs" role="radiogroup" aria-label="Time bin">
        <For each={BIN_MODES}>
          {(m) => (
            <label class="cb-au-ref">
              <input
                type="radio"
                name="auroc-bin"
                checked={aurocSettings.binMode === m.id}
                onChange={() => pick(m.id)}
              />
              <span>
                <b>{m.title}</b>
                <span class="cb-muted">{m.id === 'auto' ? sugText() : m.text}</span>
              </span>
            </label>
          )}
        </For>
      </div>
      <Show when={aurocSettings.binMode === 'manual'}>
        <div class="cb-as-check">
          Bin length:
          <NumInput k="binS" step={0.05} unit="s" label="Time bin" />
          <Show when={sug()?.binS}>
            <span class="cb-muted">suggested {sug()!.binS} s</span>
          </Show>
        </div>
        <Show when={sug() && Number.isFinite(sug()!.maxS) && aurocSettings.binS > sug()!.maxS}>
          <div class="cb-warn">
            Longer than a third of the shortest typical bout ({+sug()!.maxS.toFixed(2)} s): many
            bins will straddle a bout's start or end and be left out.
          </div>
        </Show>
      </Show>
    </div>
  );
}
