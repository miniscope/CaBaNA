import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { populationContext } from '../../lib/analysis-registry.ts';
import { hasCapability } from '../../lib/bridge-status.ts';
import {
  behaviorDecoding,
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
  OTHER_NAME,
  PREVIEW_DECODING_SHUFFLES,
  setBehaviorDecoding,
  setPositionDecoding,
} from '../../lib/decoding-settings.ts';
import { goToStep } from '../../lib/store.ts';
import { prep } from '../../lib/preprocess.ts';
import { InfoTip } from '../InfoTip.tsx';
import { SpeedFilterField } from '../parts.tsx';
import { Unavailable } from '../results/FrameworkNotice.tsx';
import { FoldStrip } from './FoldStrip.tsx';
import { correctionFamily, framesText, RANGE } from './logic.ts';
import { Choice, Num, Row } from './Parts.tsx';
import {
  checks,
  counts,
  facts,
  gates,
  isLogistic,
  isPosition,
  selectedBehaviors,
  shared,
} from './state.ts';
import { samplingRate } from '../../lib/store.ts';

const def = () => (isPosition() ? DEFAULT_POSITION_DECODING : DEFAULT_BEHAVIOR_DECODING);

/** Change one setting of the chosen target (the other target keeps its own). */
function set<K extends keyof typeof DEFAULT_POSITION_DECODING>(
  key: K,
  value: (typeof DEFAULT_POSITION_DECODING)[K],
): void {
  if (isPosition()) setPositionDecoding(key, value);
  else setBehaviorDecoding(key as never, value as never);
}

/** Back to the starting settings of the chosen target. */
export function resetStartingSettings(): void {
  if (isPosition()) setPositionDecoding({ ...DEFAULT_POSITION_DECODING });
  else setBehaviorDecoding({ ...DEFAULT_BEHAVIOR_DECODING, labels: [] });
}
export const isStartingSettings = () =>
  JSON.stringify(shared()) ===
  JSON.stringify(isPosition() ? DEFAULT_POSITION_DECODING : DEFAULT_BEHAVIOR_DECODING);

/** The line above the views: what the decoder reads, or why the input is not met. */
export function InputLine(): JSX.Element {
  const f = () => facts();
  const problem = () =>
    !f().neuralLoaded
      ? 'no neural data is loaded.'
      : !f().deconvolved
        ? 'the loaded neural data is not deconvolved events.'
        : '';
  return (
    <div class="cb-dec-input" classList={{ 'cb-dec-input--bad': !!problem() }}>
      <Show
        when={problem()}
        fallback={
          <>
            <b>Input:</b> unsmoothed deconvolved events,{' '}
            {isLogistic()
              ? 'summed in each time bin and standardized with the training folds.'
              : 'binarized above 0.'}{' '}
            Event smoothing in Preprocess is not used.
          </>
        }
      >
        <b>Input not met:</b> {problem()}{' '}
        <button type="button" class="cb-link" onClick={() => goToStep('load')}>
          Load data
        </button>
      </Show>
    </div>
  );
}

export function DecoderView(): JSX.Element {
  const s = () => shared();
  const b = () => behaviorDecoding;
  return (
    <div class="cb-dec-cols">
      <section class="cb-setgroup">
        <h3>Decoder</h3>
        <Row
          label="Decoder"
          tip="Position uses the Bayesian decoder. Behaviors can use the Bayesian decoder or logistic regression. A continuous target is not decoded here."
        >
          <Show when={!isPosition()} fallback={<span class="cb-dec-fixed">Bayesian</span>}>
            <Choice
              label="Decoder"
              value={b().decoder}
              options={[
                { value: 'bayesian', label: 'Bayesian' },
                { value: 'logistic', label: 'Logistic regression' },
              ]}
              onSet={(v) => setBehaviorDecoding('decoder', v)}
            />
          </Show>
        </Row>
        <p class="cb-muted cb-dec-blurb">
          <Show
            when={isLogistic()}
            fallback="Each frame is assigned the most probable class given the events of all cells in a window around it, using maps learned from the training folds."
          >
            A logistic regression on the standardized event counts of all cells in each time bin,
            trained on the training folds and scored on the held-out fold.
          </Show>
        </p>
      </section>

      <Show
        when={isLogistic()}
        fallback={
          <section class="cb-setgroup">
            <h3>Bayesian settings</h3>
            <Row
              label="Likelihood"
              tip="Gaussian follows Shuman et al. 2020, the lab's decoder. Poisson treats cells as independent Poisson counters (Zhang et al. 1998)."
            >
              <Choice
                label="Likelihood"
                value={s().likelihood}
                options={[
                  { value: 'gaussian', label: 'Gaussian' },
                  { value: 'poisson', label: 'Poisson' },
                ]}
                onSet={(v) => set('likelihood', v)}
              />
            </Row>
            <Show when={s().likelihood === 'gaussian'}>
              <Row
                label="Sigma"
                tip="Sigma is the spread of a cell's mean map across training folds. A small sigma makes the decoder trust that cell strongly. Per bin gives each cell and bin its own sigma; pooled uses one sigma per cell."
              >
                <Choice
                  label="Sigma"
                  value={s().sigma}
                  options={[
                    {
                      value: 'per_state',
                      label: 'Per bin',
                      gate: isPosition()
                        ? undefined
                        : {
                            disabled: true,
                            reason:
                              'Behaviors use pooled sigma only: classes differ a lot in size, and a rarely seen behavior would get a wide sigma and a flat likelihood.',
                          },
                    },
                    { value: 'pooled', label: 'Pooled' },
                  ]}
                  onSet={(v) => set('sigma', v)}
                />
              </Row>
              <Show when={isPosition() && s().sigma === 'per_state'}>
                <p class="cb-dec-note">
                  Per-bin sigma is unreliable on unbalanced bins: rarely visited bins get a wide
                  sigma and a flat likelihood. Pooled sigma avoids this.
                </p>
              </Show>
            </Show>
            <Row
              label="Window"
              range={RANGE.windowS}
              tip="Each frame is decoded from the mean of the binarized events in a window centered on it, within the same fold. 0 uses one frame. Rounded to an odd number of frames."
            >
              <Num
                label="Window (s)"
                value={s().windowS}
                def={def().windowS}
                min={0}
                step={0.05}
                unit="s"
                onSet={(v) => set('windowS', v)}
              />
            </Row>
            <Show when={isPosition()}>
              <Row
                label="Map smoothing"
                range={RANGE.smoothSigmaBins}
                tip="Gaussian smoothing of each training map across neighboring bins, in bins. Maps come from the training folds only."
              >
                <Num
                  label="Map smoothing (bins)"
                  value={s().smoothSigmaBins}
                  def={def().smoothSigmaBins}
                  min={0}
                  step={0.5}
                  unit="bins"
                  onSet={(v) => set('smoothSigmaBins', v)}
                />
              </Row>
            </Show>
            <Row
              label="Prior"
              tip="Occupancy: classes seen more often in the training folds are more likely. Uniform: every class is equally likely."
            >
              <Choice
                label="Prior"
                value={s().prior}
                options={[
                  { value: 'occupancy', label: 'Occupancy' },
                  { value: 'uniform', label: 'Uniform' },
                ]}
                onSet={(v) => set('prior', v)}
              />
            </Row>
          </section>
        }
      >
        <section class="cb-setgroup">
          <h3>Logistic regression</h3>
          <Row
            label="Mode"
            tip="One-vs-rest fits one behavior against all other frames and works when behaviors overlap. Multiclass picks one behavior per frame and needs non-overlapping classes."
          >
            <Choice
              label="Mode"
              value={b().mode}
              options={[
                { value: 'one_vs_rest', label: 'One-vs-rest' },
                { value: 'multiclass', label: 'Multiclass', gate: gates().multiclass },
              ]}
              onSet={(v) => setBehaviorDecoding('mode', v)}
            />
          </Row>
          <Row
            label="C"
            range={RANGE.C}
            tip="Inverse of the regularization strength: smaller values regularize more."
          >
            <Num
              label="C"
              value={b().C}
              def={DEFAULT_BEHAVIOR_DECODING.C}
              min={0}
              step={0.1}
              onSet={(v) => setBehaviorDecoding('C', v)}
            />
          </Row>
          <Row
            label="Time bin"
            range={RANGE.binS}
            tip="Events are summed in bins of this length before fitting. Longer bins give more events per sample and fewer samples."
          >
            <Num
              label="Time bin (s)"
              value={b().binS}
              def={DEFAULT_BEHAVIOR_DECODING.binS}
              min={0}
              step={0.1}
              unit="s"
              onSet={(v) => setBehaviorDecoding('binS', v)}
            />
          </Row>
        </section>
      </Show>
    </div>
  );
}

/** Behaviors to decode, with frame counts under the chosen overlap policy. */
function BehaviorList(): JSX.Element {
  const all = () => populationContext().labels.behaviors;
  const picked = () => selectedBehaviors();
  const move = (label: string, by: -1 | 1) => {
    const list = [...picked()];
    const i = list.indexOf(label);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setBehaviorDecoding('labels', list);
  };
  const toggle = (label: string) =>
    setBehaviorDecoding(
      'labels',
      picked().includes(label) ? picked().filter((l) => l !== label) : [...picked(), label],
    );
  const n = (label: string) => counts()?.perClass[label];
  const min = () => behaviorDecoding.minFramesPerClass;
  const fs = () => samplingRate() ?? 30;
  // Rows per page: as many as fit the list's box, so the list never scrolls inside it.
  const [perPage, setPerPage] = createSignal(6);
  const [page, setPage] = createSignal(0);
  const pages = () => Math.max(1, Math.ceil(all().length / perPage()));
  const shown = createMemo(() => {
    const at = Math.min(page(), pages() - 1);
    return all().slice(at * perPage(), (at + 1) * perPage());
  });
  let box!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(([e]) =>
      setPerPage(Math.max(3, Math.floor((e.contentRect.height - 30) / 30))),
    );
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });
  return (
    <>
      <div class="cb-dec-tablewrap" ref={box}>
        <table class="cb-auroc-table cb-as-tbl">
          <thead>
            <tr>
              <th aria-label="Decode" />
              <th>Behavior</th>
              <th class="cb-as-num">Frames used</th>
              <th>Status</th>
              <Show when={behaviorDecoding.overlap === 'priority'}>
                <th>Priority</th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={shown()}>
              {(label) => (
                <tr classList={{ 'cb-muted': !picked().includes(label) }}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Decode ${label}`}
                      checked={picked().includes(label)}
                      onChange={() => toggle(label)}
                    />
                  </td>
                  <td>{label}</td>
                  <td class="cb-as-num">
                    <Show when={picked().includes(label) && n(label) != null} fallback="–">
                      {n(label)!.toLocaleString()}
                    </Show>
                  </td>
                  <td>
                    <Show when={picked().includes(label) && n(label) != null} fallback="Left out">
                      {n(label)! >= min() ? 'Enough frames' : `Too few: minimum ${min()}`}
                    </Show>
                  </td>
                  <Show when={behaviorDecoding.overlap === 'priority'}>
                    <td class="cb-dec-move">
                      <Show when={picked().includes(label)}>
                        <button
                          type="button"
                          class="cb-ib"
                          aria-label={`Move ${label} up`}
                          onClick={() => move(label, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class="cb-ib"
                          aria-label={`Move ${label} down`}
                          onClick={() => move(label, 1)}
                        >
                          ↓
                        </button>
                      </Show>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
            <Show when={behaviorDecoding.other && page() >= pages() - 1}>
              <tr>
                <td />
                <td>{OTHER_NAME}</td>
                <td class="cb-as-num">{counts()?.perClass[OTHER_NAME]?.toLocaleString() ?? '–'}</td>
                <td>
                  {(counts()?.perClass[OTHER_NAME] ?? 0) >= min()
                    ? 'Enough frames'
                    : `Too few: minimum ${min()}`}
                </td>
                <Show when={behaviorDecoding.overlap === 'priority'}>
                  <td />
                </Show>
              </tr>
            </Show>
          </tbody>
        </table>
      </div>
      <div class="cb-pager">
        <span class="cb-muted">
          {all().length} behavior{all().length === 1 ? '' : 's'}
        </span>
        <span class="cb-pager__btns">
          <button
            class="btn-secondary btn-small"
            aria-label="Previous behaviors"
            disabled={page() === 0}
            onClick={() => setPage(Math.max(0, page() - 1))}
          >
            ‹
          </button>
          <span class="cb-muted">
            {Math.min(page(), pages() - 1) + 1} / {pages()}
          </span>
          <button
            class="btn-secondary btn-small"
            aria-label="Next behaviors"
            disabled={page() >= pages() - 1}
            onClick={() => setPage(Math.min(pages() - 1, page() + 1))}
          >
            ›
          </button>
        </span>
      </div>
      <Show when={counts()}>
        {(c) => (
          <p class="cb-dec-note">
            {c().totalFrames.toLocaleString()} frames in the session.{' '}
            {framesText(c().overlapFrames, fs())} are covered by two or more selected behaviors
            {behaviorDecoding.overlap === 'exclude'
              ? ' and are left out'
              : ' and go to the behavior higher in the list'}
            ; {framesText(c().noneFrames, fs())} are covered by none.
          </p>
        )}
      </Show>
    </>
  );
}

export function FramesView(): JSX.Element {
  const s = () => shared();
  const b = () => behaviorDecoding;
  return (
    <div class="cb-dec-cols">
      <section class="cb-setgroup">
        <h3>Frames</h3>
        <Show
          when={!isPosition()}
          fallback={
            <>
              <Row
                label="Speed filter"
                tip="Frames below this speed are not used for training or testing. One value, shared with Place cells; changing it here changes it there and in Preprocess."
              >
                <SpeedFilterField />
              </Row>
              <p class="cb-dec-note">
                Shared with Place cells (currently {prep.minSpeed} cm/s). Position smoothing and the
                spatial bin size are set in Preprocess and Experimental setup.
              </p>
              <Row
                label="Minimum frames per bin"
                range={RANGE.minFramesPerClass}
                tip="A bin with fewer training frames is not decoded and shows as excluded in the results. The framework counts the frames; occupancy from training folds only needs a framework update."
              >
                <Num
                  label="Minimum frames per bin"
                  value={s().minFramesPerClass}
                  def={def().minFramesPerClass}
                  min={1}
                  step={1}
                  integer
                  onSet={(v) => set('minFramesPerClass', v)}
                />
              </Row>
              <p class="cb-dec-note">
                Frames per bin are counted by the framework during the run; excluded bins are marked
                in the results with this rule.
              </p>
            </>
          }
        >
          <Row
            label="Overlap policy"
            tip="Frames where two selected behaviors are annotated at once. Exclude leaves them out of training and testing. Priority gives each such frame to the behavior higher in the list."
          >
            <Choice
              label="Overlap policy"
              value={b().overlap}
              options={[
                {
                  value: 'exclude',
                  label: 'Exclude overlapping frames',
                  gate: gates().overlapExclude,
                },
                { value: 'priority', label: 'Priority list' },
              ]}
              onSet={(v) => setBehaviorDecoding('overlap', v)}
            />
          </Row>
          <Row
            label="Other class"
            tip={`Adds "${OTHER_NAME}" as a class made of every frame covered by none of the selected behaviors.`}
          >
            <label class="cb-as-check">
              <input
                type="checkbox"
                checked={b().other}
                onChange={(e) => setBehaviorDecoding('other', e.currentTarget.checked)}
              />
              Add "{OTHER_NAME}"
            </label>
          </Row>
          <Row
            label="Minimum frames per class"
            range={RANGE.minFramesPerClass}
            tip="A class with fewer frames is not decoded. The frame counts below follow the overlap policy."
          >
            <Num
              label="Minimum frames per class"
              value={s().minFramesPerClass}
              def={def().minFramesPerClass}
              min={1}
              step={1}
              integer
              onSet={(v) => set('minFramesPerClass', v)}
            />
          </Row>
        </Show>
      </section>
      <Show when={!isPosition()}>
        <section class="cb-setgroup cb-dec-behaviors">
          <h3>Behaviors</h3>
          <BehaviorList />
        </section>
      </Show>
    </div>
  );
}

export function FoldsView(): JSX.Element {
  const s = () => shared();
  return (
    <div class="cb-dec-cols cb-dec-cols--one">
      <section class="cb-setgroup">
        <h3>Cross-validation</h3>
        <Row
          label="Folds"
          range={RANGE.folds}
          tip="The used frames are cut into this many contiguous blocks of time. Each block is decoded by a model trained on the others."
        >
          <Num
            label="Folds"
            value={s().folds}
            def={def().folds}
            min={2}
            step={1}
            integer
            onSet={(v) => set('folds', v)}
          />
        </Row>
        <Row
          label="Fold gap"
          range={RANGE.foldGapS}
          tip="Frames within this time of a test fold are left out of training, so slow drift cannot carry information across the border."
        >
          <Num
            label="Fold gap (s)"
            value={s().foldGapS}
            def={def().foldGapS}
            min={0}
            step={0.5}
            unit="s"
            disabled={gates().foldGap.disabled}
            onSet={(v) => set('foldGapS', v)}
          />
        </Row>
        <Show when={gates().foldGap.disabled}>
          <p class="cb-dec-why">Fold gap: {gates().foldGap.reason}</p>
        </Show>
        <FoldStrip folds={s().folds} gapS={s().foldGapS} gapApplied={!gates().foldGap.disabled} />
      </section>
    </div>
  );
}

export function SignificanceView(): JSX.Element {
  const s = () => shared();
  return (
    <div class="cb-dec-cols">
      <section class="cb-setgroup">
        <h3>Label-shuffle test</h3>
        <Row
          label="Shuffles"
          range={RANGE.shuffles}
          tip="Each shuffle is a full cross-validated run on block-shuffled labels. The smallest possible p-value is 1 / (shuffles + 1)."
        >
          <Num
            label="Shuffles"
            value={s().shuffles}
            def={def().shuffles}
            min={1}
            step={50}
            integer
            onSet={(v) => set('shuffles', v)}
          />
        </Row>
        <Row
          label="Block length"
          range={RANGE.blockS}
          tip="Labels are cut into blocks of this length and the blocks are permuted, which keeps the slow drift of the labels."
        >
          <Num
            label="Block length (s)"
            value={s().blockS}
            def={def().blockS}
            min={0.05}
            step={0.5}
            unit="s"
            onSet={(v) => set('blockS', v)}
          />
        </Row>
        <Row
          label="Correction"
          tip="Max-stat compares each value with the best-looking value of every shuffle, within the family named here. None leaves p-values uncorrected."
        >
          <Choice
            label="Correction"
            value={s().correction}
            options={[
              { value: 'max_stat', label: 'Max-stat' },
              { value: 'none', label: 'None' },
            ]}
            onSet={(v) => set('correction', v)}
          />
        </Row>
        <p class="cb-dec-note">
          <Show
            when={s().correction === 'max_stat'}
            fallback="Uncorrected p-values only. Results are marked exploratory."
          >
            Max-stat correction {correctionFamily(isPosition() ? 'position' : 'behaviors')}.
          </Show>{' '}
          <Show
            when={hasCapability('decoding_overall_test')}
            fallback="The overall value is not tested by the installed framework."
          >
            The overall value is tested and not corrected.
          </Show>
        </p>
        <Row label="Alpha" range={RANGE.alpha}>
          <Num
            label="Alpha"
            value={s().alpha}
            def={def().alpha}
            min={0}
            max={1}
            step={0.01}
            onSet={(v) => set('alpha', v)}
          />
        </Row>
        <Row
          label="Seed"
          tip="Starting value of the random generator; the same seed gives the same shuffles."
        >
          <Num
            label="Seed"
            value={s().seed}
            def={def().seed}
            step={1}
            integer
            onSet={(v) => set('seed', v)}
          />
        </Row>
      </section>
      <section class="cb-setgroup">
        <h3>Quick preview</h3>
        <p>
          Runs the same analysis with {PREVIEW_DECODING_SHUFFLES} shuffles to check the settings.
          Its results are labeled Preliminary and are kept apart from the full run of{' '}
          {s().shuffles.toLocaleString()} shuffles. Use the Quick preview button beside Run.
        </p>
        <p class="cb-dec-note">
          With {PREVIEW_DECODING_SHUFFLES} shuffles the smallest possible p-value is{' '}
          {(1 / (PREVIEW_DECODING_SHUFFLES + 1)).toFixed(3)}, so corrected p-values cannot reach
          small values.
          <InfoTip label="About the quick preview">
            Do not report a preview as a result. Rerun with the full number of shuffles.
          </InfoTip>
        </p>
      </section>
    </div>
  );
}

/** Validation: what to fix, and what needs a framework update, written on the page. */
export function ChecksView(): JSX.Element {
  const c = () => checks();
  return (
    <section class="cb-setgroup cb-dec-checks">
      <h3>Checks before running</h3>
      <Show
        when={c().engineOff || c().needsInput.length || c().framework.length}
        fallback={<p>All checks passed. The analysis can run.</p>}
      >
        <Unavailable engineOff framework={c().framework} input={c().needsInput} />
      </Show>
    </section>
  );
}
