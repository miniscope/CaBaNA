import { For, Show, type JSX } from 'solid-js';
import {
  decodeSettings,
  DEFAULT_DECODE_SETTINGS,
  QUICK_SHUFFLES,
  setDecodeSettings,
} from '../lib/decoding-run.ts';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';

// Pieces of the Decoding pages that both targets use.

const D = DEFAULT_DECODE_SETTINGS;

export function Row(props: { label: string; tip?: JSX.Element; children: JSX.Element }): JSX.Element {
  return (
    <div class="cb-dec-row">
      <span class="cb-pe-small">
        {props.label}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.tip}</InfoTip>
        </Show>
      </span>
      {props.children}
    </div>
  );
}

export function Choice<T extends string>(props: { label: string; value: T; options: [T, string][]; onSet: (v: T) => void }): JSX.Element {
  return (
    <div class="cb-seg" role="group" aria-label={props.label}>
      <For each={props.options}>
        {([v, text]) => (
          <button type="button" classList={{ 'cb-seg__on': props.value === v }} aria-pressed={props.value === v} onClick={() => props.onSet(v)}>
            {text}
          </button>
        )}
      </For>
    </div>
  );
}


/** The decoding target: one page, each target with its own setup and results. */
export function TargetSelector(): JSX.Element {
  const set = (t: 'position' | 'behavior') => setDecodeSettings('target', t);
  return (
    <div class="cb-dec-target">
      <span class="cb-dec-target__label">Target</span>
      <div class="cb-seg" role="group" aria-label="Decoding target">
        <For each={[['position', 'Position'], ['behavior', 'Behavior']] as const}>
          {([t, text]) => (
            <button type="button" classList={{ 'cb-seg__on': decodeSettings.target === t }} aria-pressed={decodeSettings.target === t} onClick={() => set(t)}>
              {text}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

/** The explanation of the neural input, beside the setup of either target. */
export function InputNote(props: { cells: number; summed?: boolean }): JSX.Element {
  return (
    <div class="cb-dec-input">
      <b>Neural input:</b> unsmoothed deconvolved events of {props.cells} cells,{' '}
      {props.summed ? 'summed in each time bin and standardized with the training fold' : 'binarized (any event above 0 counts as 1)'}. The Preprocess event
      smoothing is not used, because smoothing would spread each event over many frames.
    </div>
  );
}

/** The starting preset notice with its reset button. */
export function PresetBar(props: { children: JSX.Element }): JSX.Element {
  const isPreset = () => JSON.stringify(decodeSettings) === JSON.stringify(D);
  return (
    <div class="cb-dec-preset">
      <span>
        <b>Starting preset:</b> {props.children} A practical starting point, not a validated optimum; every value can be changed
        and is saved with the results.
      </span>
      <button class="btn-secondary" disabled={isPreset()} onClick={() => setDecodeSettings(structuredClone(D))}>
        Reset to preset
      </button>
    </div>
  );
}

/** The shuffle test settings. `what` names what is tested: bins or behaviors. */
export function TestSection(props: { what: 'bin' | 'behavior' }): JSX.Element {
  return (
    <>
      <h3 class="cb-dec-h3">Significance test</h3>
      <Row
        label="Shuffle test"
        tip={`The decoder is run again on labels shuffled in blocks. The real result is compared with the shuffled ones: overall (an extension to the framework) and for each ${props.what}.`}
      >
        <Choice label="Shuffle test" value={decodeSettings.test} options={[['shuffle', 'Label shuffle'], ['none', 'Off']]} onSet={(v) => setDecodeSettings('test', v)} />
      </Row>
      <Show when={decodeSettings.test === 'shuffle'}>
        <Row label="Shuffles" tip={`Each shuffle is a full cross-validated run. The smallest possible p-value is 1 / (shuffles + 1). ${QUICK_SHUFFLES} shuffles is a quick preview only.`}>
          <NumField label="Shuffles" value={decodeSettings.nShuffles} def={D.nShuffles} min={1} step={50} onSet={(v) => setDecodeSettings('nShuffles', Math.max(1, Math.round(v)))} />
          <button class="cb-link" onClick={() => setDecodeSettings('nShuffles', QUICK_SHUFFLES)}>
            Quick preview ({QUICK_SHUFFLES})
          </button>
        </Row>
        <Row
          label="Block length"
          tip="Labels are cut into blocks of this length and the blocks are permuted, which keeps the slow drift of the labels. 5 s is a practical starting point, not a validated optimum."
        >
          <NumField label="Block length (s)" value={decodeSettings.blockS} def={D.blockS} min={0.05} step={0.5} unit="s" onSet={(v) => setDecodeSettings('blockS', Math.max(0.05, v))} />
        </Row>
        <Row
          label="Correction"
          tip={`Max-stat (minimum p) compares each ${props.what} with the best-looking one of every shuffle, across the tested ${props.what}s of this run. None leaves p-values uncorrected. The overall test is not corrected.`}
        >
          <Choice label="Correction" value={decodeSettings.correction} options={[['max_stat', 'Max-stat'], ['none', 'None']]} onSet={(v) => setDecodeSettings('correction', v)} />
        </Row>
        <Row label="Significance level">
          <NumField label="Alpha" value={decodeSettings.alpha} def={D.alpha} min={0} max={1} step={0.01} onSet={(v) => setDecodeSettings('alpha', v)} />
        </Row>
        <Row label="Random seed">
          <NumField label="Random seed" value={decodeSettings.seed} def={D.seed} step={1} onSet={(v) => setDecodeSettings('seed', Math.round(v))} />
        </Row>
      </Show>
    </>
  );
}
