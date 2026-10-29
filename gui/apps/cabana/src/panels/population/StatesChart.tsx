import { For, Show, type JSX } from 'solid-js';
import { labelMinimum, truncate, type LabelRow } from './logic.ts';
import { isOff, reasonOf, toggleLabel } from './data.ts';
import { populationSettings } from '../../lib/population-settings.ts';
import { PopButton } from '../QcParts.tsx';

/**
 * Time bins per state at the chosen bin size: a checkbox, the name, a bar and the count on one
 * row, with the bin axis below. A dashed line marks the bins the selected methods need. A state
 * that cannot be used says why in words under its row. Counts are a preview from the annotations.
 */
export function StatesChart(props: { rows: LabelRow[] }): JSX.Element {
  const min = () => labelMinimum(populationSettings);
  const max = () => Math.max(1, min().min, ...props.rows.map((r) => r.bins)) * 1.05;
  const pct = (v: number) => `${Math.min(100, (v / max()) * 100)}%`;
  const ticks = () => [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max()));
  return (
    <div class="cb-pn-states" role="group" aria-label="Time bins per state">
      <div class="cb-pn-states__grid cb-pn-states__head">
        <span />
        <span>State (label)</span>
        <span>Time bins of {populationSettings.binS} s</span>
        <span class="cb-as-num">Bins</span>
      </div>
      <div class="cb-pn-states__rows">
        <For each={props.rows}>
          {(r) => (
            <div class="cb-pn-state" classList={{ 'cb-pn-state--bad': !!reasonOf(r) }}>
              <div class="cb-pn-states__grid">
                <input
                  type="checkbox"
                  aria-label={`Include ${r.name}`}
                  disabled={!!reasonOf(r)}
                  checked={!reasonOf(r) && !isOff(r.name)}
                  onChange={() => toggleLabel(r.name)}
                />
                <span class="cb-pn-state__name" title={r.name}>
                  {truncate(r.name, 22)}
                </span>
                <span class="cb-pn-bar" title={`${r.name}: ${r.bins} time bins`}>
                  <i style={{ width: pct(r.bins) }} />
                  <u style={{ left: pct(min().min) }} />
                </span>
                <span class="cb-as-num">{r.bins}</span>
              </div>
              <Show when={reasonOf(r)}>
                <div class="cb-pn-state__why">{reasonOf(r)}</div>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="cb-pn-states__grid cb-pn-states__axis">
        <span />
        <span />
        <span class="cb-pn-ticks">
          <For each={ticks()}>{(t) => <span>{t}</span>}</For>
        </span>
        <span />
      </div>
      <div class="cb-pn-states__foot cb-muted">
        <span>
          x axis: time bins in the state (whole bins). Dashed line: {min().min} bins needed
          {min().min > 1 ? ` (${min().by})` : ''}.
        </span>
        <PopButton
          label="About these counts"
          title="About these counts"
          width={340}
          class="cb-link"
          button="About these counts"
        >
          <p>
            Each count is the number of neural frames in the state divided into bins of the chosen
            size, rounded down. It is computed from the loaded annotations only to check that every
            state has enough data; the analysis does its own binning.
          </p>
        </PopButton>
      </div>
    </div>
  );
}
