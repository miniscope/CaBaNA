// The significance-testing settings of the PETH setup page: a one-line summary and a popover with
// every setting. The popover edits a copy; Apply writes it back, Cancel drops it.

import { Show, type JSX } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import {
  autoShift,
  DEFAULT_PETH_SETTINGS,
  pethSettings,
  setPethSettings,
  type PethSettings,
} from '../lib/peth-run.ts';
import { MIN_NONZERO_PREPOST } from '../lib/peth.ts';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { PopButton } from './QcParts.tsx';

const D = DEFAULT_PETH_SETTINGS;
const KEYS = [
  'test',
  'shiftAuto',
  'minShiftS',
  'nShuffles',
  'seed',
  'alpha',
  'correction',
  'band',
  'bandShifts',
  'bandSeed',
  'bandMinShiftS',
  'latencyBins',
  'wilcoxon',
] as const;

/** What the shuffle test, null band and Wilcoxon settings are now, in three lines. */
export function SettingsSummary(): JSX.Element {
  const s = pethSettings;
  return (
    <div class="cb-pe-small">
      <div>
        <Show when={s.test === 'circular'} fallback="Shuffle test: none (descriptive only): no p-values and no labels">
          Shuffle test: circular shift, {s.nShuffles.toLocaleString()} shuffles, min shift{' '}
          {s.shiftAuto ? `auto${autoShift() ? ` (${autoShift()!.minShiftS} s)` : ''}` : `${s.minShiftS} s`},{' '}
          {s.correction === 'max_stat' ? 'max-stat' : 'no correction'}, α {s.alpha}
        </Show>
      </div>
      <div class="cb-muted">
        Null band and latency: {s.band ? `on, ${s.bandShifts} shifts` : 'off'} · Pre vs post Wilcoxon:{' '}
        {s.wilcoxon ? 'shown' : 'off'} · both descriptive
      </div>
    </div>
  );
}

function Form(props: { close: () => void }): JSX.Element {
  const [d, setD] = createStore(Object.fromEntries(KEYS.map((k) => [k, unwrap(pethSettings)[k]])) as Pick<PethSettings, (typeof KEYS)[number]>);
  const off = () => d.test === 'none';
  const row = (label: JSX.Element, control: JSX.Element) => (
    <>
      <span>{label}</span>
      <span>{control}</span>
    </>
  );
  return (
    <div class="cb-pe-form">
      <h4>
        Shuffle test <span class="cb-muted">· gives the p-value and the labels</span>
      </h4>
      <div class="cb-pe-form__grid">
        {row(
          'Test',
          <select aria-label="Test" value={d.test} onChange={(e) => setD('test', e.currentTarget.value as 'circular' | 'none')}>
            <option value="circular">Circular shift</option>
            <option value="none">None (descriptive only)</option>
          </select>,
        )}
        {row(
          'Shuffles',
          <NumField label="Shuffles" value={d.nShuffles} def={D.nShuffles} min={1} step={100} disabled={off()} onSet={(v) => setD('nShuffles', Math.max(1, Math.round(v)))} />,
        )}
        {row(
          <>
            Minimum shift
            <InfoTip label="About the minimum shift">
              Smallest circular shift of the neural trace against the onsets. Auto sets it to 3 times the longer of
              the neural and behavior autocorrelation times, between 5 s and a quarter of the recording.
            </InfoTip>
          </>,
          <span class="cb-pe-inline">
            <label class="cb-radio">
              <input type="radio" name="peth-shift" checked={d.shiftAuto} disabled={off()} onChange={() => setD('shiftAuto', true)} />
              Auto{autoShift() ? ` (${autoShift()!.minShiftS} s)` : ''}
            </label>
            <label class="cb-radio">
              <input type="radio" name="peth-shift" checked={!d.shiftAuto} disabled={off()} onChange={() => setD('shiftAuto', false)} />
              <NumField label="Minimum shift (s)" value={d.minShiftS} def={D.minShiftS} min={0.5} unit="s" disabled={off() || d.shiftAuto} onSet={(v) => setD('minShiftS', v)} />
            </label>
          </span>,
        )}
        {row(
          <>
            Correction
            <InfoTip label="About the correction">
              Max-stat corrects across the selected behaviors within each cell. It does not correct across cells.
            </InfoTip>
          </>,
          <select aria-label="Correction" disabled={off()} value={d.correction} onChange={(e) => setD('correction', e.currentTarget.value as 'none' | 'max_stat')}>
            <option value="max_stat">Max-stat across behaviors</option>
            <option value="none">None</option>
          </select>,
        )}
        {row('α', <NumField label="Alpha" value={d.alpha} def={D.alpha} min={0.001} max={0.5} step={0.01} disabled={off()} onSet={(v) => v > 0 && v <= 0.5 && setD('alpha', v)} />)}
        {row('Seed', <NumField label="Seed" value={d.seed} def={D.seed} step={1} disabled={off()} onSet={(v) => setD('seed', Math.round(v))} />)}
      </div>
      <h4>
        Null band and latency <span class="cb-muted">· descriptive</span>
      </h4>
      <label class="cb-as-check">
        <input type="checkbox" checked={d.band} onChange={(e) => setD('band', e.currentTarget.checked)} />
        Compute
      </label>
      <div class="cb-pe-form__grid cb-pe-form__grid--two">
        {row('Shifts', <NumField label="Null band shifts" value={d.bandShifts} def={D.bandShifts} min={1} step={50} disabled={!d.band} onSet={(v) => setD('bandShifts', Math.max(1, Math.round(v)))} />)}
        {row('Seed', <NumField label="Null band seed" value={d.bandSeed} def={D.bandSeed} step={1} disabled={!d.band} onSet={(v) => setD('bandSeed', Math.round(v))} />)}
        {row('Minimum shift', <NumField label="Null band minimum shift (s)" value={d.bandMinShiftS} def={D.bandMinShiftS} min={0.5} unit="s" disabled={!d.band} onSet={(v) => setD('bandMinShiftS', v)} />)}
        {row('Latency: bins outside band', <NumField label="Bins outside the band" value={d.latencyBins} def={D.latencyBins} min={1} step={1} disabled={!d.band} onSet={(v) => setD('latencyBins', Math.max(1, Math.round(v)))} />)}
      </div>
      <p class="cb-muted cb-pe-small">
        Own shifts and seed, separate from the test; not corrected for bins or cells.
      </p>
      <h4>
        Pre vs post Wilcoxon <span class="cb-muted">· descriptive</span>
      </h4>
      <label class="cb-as-check">
        <input type="checkbox" checked={d.wilcoxon} onChange={(e) => setD('wilcoxon', e.currentTarget.checked)} />
        Show paired Wilcoxon p across onsets
      </label>
      <p class="cb-muted cb-pe-small">
        Treats onsets as independent, which they are not within one animal. Shown for comparison with published
        methods; not used for labels. Needs at least {MIN_NONZERO_PREPOST} onsets with a non-zero difference.
      </p>
      <div class="cb-pe-form__foot">
        <button class="btn-secondary btn-small" onClick={props.close}>
          Cancel
        </button>
        <button
          class="btn-primary btn-small"
          onClick={() => {
            setPethSettings({ ...unwrap(d) });
            props.close();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function SettingsButton(): JSX.Element {
  return (
    <PopButton label="Edit significance testing settings" title="Significance testing" width={520} class="btn-secondary" button="Edit settings…">
      {(close) => <Form close={close} />}
    </PopButton>
  );
}
