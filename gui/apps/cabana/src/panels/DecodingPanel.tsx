import { createMemo, Show, onCleanup, onMount, type JSX } from 'solid-js';
import { DEFAULT_BIN_CM, effectiveBin, setBinCm } from '../lib/arena.ts';
import { positionDecodeData } from '../lib/decode-data.ts';
import {
  cancelDecodeRun,
  decodeOutcome,
  decodeRunIssue,
  decodeSettings,
  decodeShowResults,
  decodeStatus,
  DEFAULT_DECODE_SETTINGS,
  runDecoding,
  setDecodeSettings,
  setDecodeShowResults,
} from '../lib/decoding-run.ts';
import { decodingChanges, decodingSettingChanges } from '../lib/decoding-view.ts';
import { prep } from '../lib/preprocess.ts';
import { goToStep } from '../lib/store.ts';
import { DecodingBehaviorPanel } from './DecodingBehavior.tsx';
import { Choice, InputNote, PresetBar, Row, TargetSelector, TestSection } from './DecodingParts.tsx';
import { DecodingResults } from './DecodingResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { SpeedFilterField } from './parts.tsx';
import { fitToWindow } from './QcPanel.tsx';
import '../styles/decoding.css';

const D = DEFAULT_DECODE_SETTINGS;
const P = () => decodeSettings.position;
const setP = <K extends keyof typeof D.position>(k: K, v: (typeof D.position)[K]) => setDecodeSettings('position', k, v);

function DecodingSetup(): JSX.Element {
  const data = createMemo(() => positionDecodeData());
  const ok = () => {
    const d = data();
    return d && !('error' in d) ? d : undefined;
  };
  const issue = () => decodeRunIssue(data(), decodeSettings);
  const running = () => {
    const s = decodeStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const error = () => {
    const s = decodeStatus();
    return s.kind === 'error' ? s.message : undefined;
  };
  const changes = () => [...decodingChanges(), ...decodingSettingChanges()];
  /** Bins with enough used frames, and the frames in use. */
  const counts = createMemo(() => {
    const d = ok();
    if (!d) return undefined;
    const per = new Map<number, number>();
    let used = 0;
    for (const l of d.input.labels)
      if (l >= 0) {
        per.set(l, (per.get(l) ?? 0) + 1);
        used++;
      }
    return { used, bins: per.size, enough: [...per.values()].filter((n) => n >= P().minFrames).length };
  });
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  return (
    <div class="cb-place cb-as cb-dec-setup" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Decoding</h2>
          <p class="cb-muted">
            Predict where the animal is from the neural data of all cells together, on held-out blocks of time.
          </p>
        </div>
        <TargetSelector />
        <div class="cb-controls">
          <Show when={decodeOutcome()}>
            <button class="btn-secondary" onClick={() => setDecodeShowResults(true)}>
              {changes().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>
      <Show when={decodeOutcome() && changes().length}>
        <div class="cb-muted">Changed since the last run: {changes().join(', ')}. Run again to update.</div>
      </Show>
      <Show when={error()}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ok()}>
        <div class="cb-empty">
          {data() ? (data() as { error: string }).error : 'Position decoding needs deconvolved events, position and neural timestamps.'}{' '}
          <button class="cb-link" onClick={() => goToStep('load')}>
            Load data
          </button>
        </div>
      </Show>

      <Show when={ok()}>
        <InputNote cells={ok()!.input.cells} />
        <PresetBar>
          integration window {D.position.windowS} s, map smoothing off, {D.blockS} s blocks, {D.nShuffles.toLocaleString()} shuffles.
        </PresetBar>
        <div class="cb-pe-body">
          <section class="cb-setgroup cb-pe-left">
            <h3>1 · Frames and held-out blocks</h3>
            <Row
              label="Spatial bin"
              tip="The arena is divided into square bins; the decoder chooses one bin per frame. The same bin size is used by Place cells."
            >
              <NumField label="Spatial bin (cm)" value={effectiveBin()} def={DEFAULT_BIN_CM} min={0.5} step={0.5} unit="cm" onSet={setBinCm} />
            </Row>
            <Row
              label="Speed filter"
              tip="Frames below this speed are not used, for training or testing. One value, shared with Place cells; edit it here or in Preprocess."
            >
              <SpeedFilterField />
            </Row>
            <Row
              label="Folds"
              tip="The used frames are cut into this many contiguous blocks of time. Each block is decoded by a model trained on the others, so no frame is decoded by a model that saw it."
            >
              <NumField label="Folds" value={P().nFolds} def={D.position.nFolds} min={2} step={1} onSet={(v) => setP('nFolds', Math.max(2, Math.round(v)))} />
            </Row>
            <Row
              label="Minimum frames per bin"
              tip="A bin with fewer used frames is not decoded and shows as Not evaluated."
            >
              <NumField label="Minimum frames per bin" value={P().minFrames} def={D.position.minFrames} min={1} step={1} onSet={(v) => setP('minFrames', Math.max(1, Math.round(v)))} />
            </Row>
            <Show when={counts()}>
              <div class="cb-dec-counts">
                <b>{counts()!.used.toLocaleString()}</b> frames used · <b>{counts()!.bins}</b> bins visited · <b>{counts()!.enough}</b> bins with at
                least {P().minFrames} frames
              </div>
            </Show>
            <div class="cb-muted cb-pe-small">
              Speed filter {prep.minSpeed} cm/s and position smoothing are set in{' '}
              <button class="cb-link" onClick={() => goToStep('prep')}>
                Preprocess
              </button>
              .
            </div>
          </section>

          <section class="cb-setgroup cb-pe-right">
            <h3>2 · Bayesian decoder</h3>
            <Row label="Likelihood" tip="Gaussian: Shuman et al. 2020, the lab's decoder. Poisson: independent Poisson cells, Zhang et al. 1998.">
              <Choice label="Likelihood" value={P().likelihood} options={[['gaussian', 'Gaussian'], ['poisson', 'Poisson']]} onSet={(v) => setP('likelihood', v)} />
            </Row>
            <Show when={P().likelihood === 'gaussian'}>
              <Row
                label="Sigma"
                tip={
                  <>
                    Sigma is the spread of a cell's mean map across training blocks. It sets how much a deviation from the
                    expected value counts against a bin: a small sigma makes the decoder trust that cell strongly. Per bin
                    gives every cell and bin its own sigma, raised to the cell's mean; pooled uses one sigma per cell. With
                    per-bin sigma, rarely visited bins get a wide sigma and a flat likelihood.
                  </>
                }
              >
                <Choice label="Sigma" value={P().sigma} options={[['per_state', 'Per bin'], ['pooled', 'Pooled']]} onSet={(v) => setP('sigma', v)} />
              </Row>
            </Show>
            <Row
              label="Integration window"
              tip="Each frame is decoded from the mean of the binarized events in a window centred on it, using frames of the same fold only. 0 uses a single frame. Rounded to an odd number of frames."
            >
              <NumField label="Integration window (s)" value={P().windowS} def={D.position.windowS} min={0} step={0.05} unit="s" onSet={(v) => setP('windowS', Math.max(0, v))} />
            </Row>
            <Row label="Map smoothing" tip="Gaussian smoothing of the training maps over neighbouring bins, in bins. 0 is off. The maps come from the training folds only.">
              <NumField label="Map smoothing (bins)" value={P().smoothSigmaBins} def={D.position.smoothSigmaBins} min={0} step={0.5} unit="bins" onSet={(v) => setP('smoothSigmaBins', Math.max(0, v))} />
            </Row>
            <Row label="Prior" tip="Occupancy: bins the animal visited more in the training folds are more likely. Uniform: every visited bin is equally likely.">
              <Choice label="Prior" value={P().prior} options={[['occupancy', 'Occupancy'], ['uniform', 'Uniform']]} onSet={(v) => setP('prior', v)} />
            </Row>

            <TestSection what="bin" />
          </section>
        </div>

        <div class="cb-pe-foot">
          <span class="cb-pe-foot__text">
            <Show
              when={!running()}
              fallback={
                <>
                  <progress class="cb-progress" value={running()!.done} max={running()!.total} />
                  <span class="cb-muted">{running()!.step}</span>
                </>
              }
            >
              <Show when={issue()} fallback={<span class="cb-muted">Held-out blocks: each fold is decoded by a model trained on the others.</span>}>
                <span class="cb-muted">{issue()}</span>
              </Show>
            </Show>
          </span>
          <Show
            when={!running()}
            fallback={
              <button class="btn-secondary" onClick={cancelDecodeRun}>
                Cancel
              </button>
            }
          >
            <button class="btn-primary" disabled={!!issue()} onClick={() => void runDecoding()}>
              {decodeOutcome() ? 'Run again' : 'Run analysis'} ▶
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The Decoding page: the Target selector, then the setup or results of the chosen target. */
export function DecodingPanel(): JSX.Element {
  return (
    <Show when={decodeSettings.target === 'position'} fallback={<DecodingBehaviorPanel />}>
      <Show when={decodeShowResults() && decodeOutcome()} keyed fallback={<DecodingSetup />}>
        {(out) => <DecodingResults out={out} onEdit={() => setDecodeShowResults(false)} />}
      </Show>
    </Show>
  );
}
