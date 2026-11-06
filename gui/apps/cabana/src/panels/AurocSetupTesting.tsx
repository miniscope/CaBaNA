// auROC setup: the significance testing section (null method, shift, shuffles, alpha, correction).
import { For, Show, type JSX } from 'solid-js';
import {
  aurocSettings,
  autoShift,
  autoShiftError,
  DEFAULT_AUROC_SETTINGS,
  setAurocSettings,
  type AurocData,
} from '../lib/auroc-run.ts';
import { engineFor } from '../lib/engine.ts';
import { Field } from './AurocSetupFields.tsx';
import { NumInput } from './AurocPanel.tsx';

export function AurocTestingSection(props: {
  ok: () => AurocData;
  selected: () => string[];
  minP: () => number;
  openAdvanced: () => void;
  advancedButton: (el: HTMLButtonElement) => void;
}): JSX.Element {
  const { ok, selected, minP } = props;
  return (
    <>
      <div class="cb-au-col">
        <p class="cb-muted">
          auROC is the effect size. The test asks whether it is larger than expected when the neural
          data are shifted in time against the behavior labels.
        </p>
        <Field
          title="Null method"
          tip="Creates a comparison distribution to estimate how often a response this strong could occur by chance. The neural data are shifted around the whole recording first, wrapping at its end, and the frame selection is applied afterwards, so excluded frames keep their time positions. The recording is treated as one continuous session."
          help={
            aurocSettings.method === 'speed'
              ? 'Speed-matched: only shifts that keep the speed distribution during each behavior similar to the original are used.'
              : 'Circular shift: shifts the deconvolved neural trace in time relative to the behavior labels, wrapping the end to the beginning. This keeps the temporal structure of the trace.'
          }
        >
          <select
            aria-label="Null method"
            value={aurocSettings.method}
            onChange={(e) =>
              setAurocSettings('method', e.currentTarget.value as 'circular' | 'speed')
            }
          >
            <option value="circular">Time-shifted data (circular shift)</option>
            <option value="speed">Speed-matched time-shifted data</option>
          </select>
        </Field>
        <Show when={aurocSettings.method === 'speed'}>
          <div class="cb-au-sub">
            <Show when={!ok()!.speed}>
              <div class="cb-note">Speed matching needs a loaded position file.</div>
            </Show>
            <Field
              title="Balance measure"
              tip="How the speed distributions of the shifted and original frames are compared."
            >
              <select
                aria-label="Balance measure"
                value={aurocSettings.match.statistic}
                onChange={(e) =>
                  setAurocSettings('match', 'statistic', e.currentTarget.value as 'ks' | 'mean')
                }
              >
                <option value="ks">KS distance</option>
                <option value="mean">Difference in means</option>
              </select>
            </Field>
            <Field
              title="Tolerance"
              tip="The largest balance-measure value at which a shift is accepted as matched."
              help="Default 0.1"
            >
              <label
                class="cb-prep-field"
                classList={{
                  'cb-prep-field--changed': aurocSettings.match.tolerance !== 0.1,
                }}
              >
                <input
                  type="number"
                  aria-label="Tolerance"
                  min="0.01"
                  step="0.01"
                  value={aurocSettings.match.tolerance}
                  onInput={(e) =>
                    +e.currentTarget.value > 0 &&
                    setAurocSettings('match', 'tolerance', +e.currentTarget.value)
                  }
                />
              </label>
            </Field>
            <button class="cb-link" onClick={() => props.openAdvanced()}>
              More speed-matching settings
            </button>
          </div>
        </Show>
        <Field
          title="Minimum shift"
          tip="The smallest time shift allowed when generating shuffled data. Larger shifts help prevent a shuffle from staying too close to the original alignment. Auto sets it to 3 times the longer of the neural and behavior autocorrelation times, between 5 s and a quarter of the recording."
        >
          <div class="cb-controls">
            <For each={[true, false]}>
              {(a) => (
                <label class="cb-radio">
                  <input
                    type="radio"
                    name="auroc-shift"
                    checked={aurocSettings.shiftAuto === a}
                    onChange={() => setAurocSettings('shiftAuto', a)}
                  />
                  {a ? 'Auto' : 'Manual'}
                </label>
              )}
            </For>
            <Show
              when={aurocSettings.shiftAuto}
              fallback={<NumInput k="minShiftS" label="Minimum shift (s)" unit="s" step={0.5} />}
            >
              <Show
                when={!autoShiftError()}
                fallback={
                  <span class="cb-warn">
                    Could not be calculated ({autoShiftError()}). Choose Manual.
                  </span>
                }
              >
                <Show when={autoShift()} fallback={<span class="cb-muted">Calculating…</span>}>
                  <span class="cb-pill">{autoShift()!.minShiftS} s</span>
                </Show>
              </Show>
            </Show>
          </div>
          <Show when={aurocSettings.shiftAuto && autoShift()}>
            <div class="cb-muted cb-au-field__help">{autoShift()!.note}</div>
          </Show>
          <Show
            when={
              aurocSettings.shiftAuto &&
              aurocSettings.method === 'speed' &&
              engineFor('auroc') === 'framework'
            }
          >
            <div class="cb-muted cb-au-field__help">
              On the framework engine the automatic shift acts on circular shifts only, so a
              speed-matched run uses the minimum shift typed under Manual (now{' '}
              {aurocSettings.minShiftS} s).
            </div>
          </Show>
        </Field>
        <Field
          title="Shuffles"
          tip="Number of shifted datasets used to estimate significance. More shuffles give finer p-value resolution but take longer."
          help={`Default ${DEFAULT_AUROC_SETTINGS.nShuffles}. Smallest possible unadjusted p-value: about ${minP().toFixed(3)}.`}
        >
          <NumInput k="nShuffles" label="Shuffles" step={100} />
        </Field>
        <Field
          title="Significance threshold (α)"
          tip="The threshold used to classify a result as significant. The test is two-sided: it detects higher or lower neural events."
          help={`Default ${DEFAULT_AUROC_SETTINGS.alpha}`}
        >
          <NumInput k="alpha" label="α" step={0.01} />
        </Field>
        <Field
          title="Multiple-comparison correction"
          tip="Testing many behaviors or cells increases the chance of finding a significant result by chance. Correction helps account for multiple tests, within the scope shown below the menu."
          help={
            aurocSettings.correction === 'max_stat'
              ? `Accounts for testing the ${selected().length} selected behaviors within each cell. It does not correct for testing multiple cells. Adjusted p-values can change when the selected behaviors change.`
              : 'No correction: p-values are not adjusted for the number of behaviors or cells tested.'
          }
        >
          <select
            aria-label="Multiple-comparison correction"
            value={aurocSettings.correction}
            onChange={(e) =>
              setAurocSettings('correction', e.currentTarget.value as 'none' | 'max_stat')
            }
          >
            <option value="max_stat">Max-stat</option>
            <option value="none">None</option>
          </select>
        </Field>
        <button
          ref={props.advancedButton}
          type="button"
          class="btn-secondary btn-small cb-as-adv"
          aria-haspopup="dialog"
          onClick={() => props.openAdvanced()}
        >
          Advanced options… <span class="cb-muted">seed {aurocSettings.seed}</span>
        </button>
      </div>
    </>
  );
}
