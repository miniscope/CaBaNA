// The kernel the deconvolution events are reconvolved with: indicator, time constants and what the fit is compared to.
import { For, Show, type JSX } from 'solid-js';
import { INDICATORS, PRESET_NOTE } from '../lib/decon.ts';
import {
  compareTo,
  editTau,
  indicatorId,
  pve,
  setCompareTo,
  setIndicator,
  tauDecay,
  tauRise,
} from '../lib/decon-state.ts';
import { denoisedTrace, rawTrace } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { PopButton } from './QcParts.tsx';

/** Median over cells of the fraction of the trace the reconvolved events explain. */
export const deconMedian = () => {
  const v = pve()
    ?.filter(Number.isFinite)
    .sort((a, b) => a - b);
  return v?.length ? v[Math.floor(v.length / 2)] : undefined;
};

/** The kernel the events are reconvolved with, and what the fit is compared to. */
export function DeconSettings(): JSX.Element {
  return (
    <>
      <div class="cb-controls cb-controls--rail">
        <label>
          <span>
            Indicator
            <InfoTip label="About the kernel settings">
              Events from different pipelines are on different scales, so each cell is fitted with
              its own scale and offset. Pick the indicator, or type the time constants the pipeline
              used.
            </InfoTip>
          </span>
          <select value={indicatorId()} onChange={(e) => setIndicator(e.currentTarget.value)}>
            <For each={INDICATORS}>{(i) => <option value={i.id}>{i.label}</option>}</For>
          </select>
        </label>
        <label>
          Rise time
          <input
            type="number"
            step="0.01"
            min="0"
            value={tauRise()}
            onInput={(e) => editTau('rise', Math.max(0, +e.currentTarget.value))}
          />{' '}
          s
        </label>
        <label>
          Decay time
          <input
            type="number"
            step="0.05"
            min="0.05"
            value={tauDecay()}
            onInput={(e) => editTau('decay', Math.max(0.05, +e.currentTarget.value || 0.5))}
          />{' '}
          s
        </label>
        <Show when={rawTrace() && denoisedTrace()}>
          <label>
            Compare to
            <select
              value={compareTo()}
              onChange={(e) => setCompareTo(e.currentTarget.value as 'raw' | 'denoised')}
            >
              <option value="denoised">Denoised trace</option>
              <option value="raw">Raw trace</option>
            </select>
          </label>
        </Show>
        <Show when={deconMedian() !== undefined}>
          <span class="cb-muted">Median explained: {(100 * deconMedian()!).toFixed(0)}%</span>
        </Show>
      </div>
      <PopButton
        label="About indicator presets"
        title="About indicator presets"
        width={380}
        class="cb-link"
        button="About indicator presets"
      >
        <p>{PRESET_NOTE}</p>
      </PopButton>
    </>
  );
}
