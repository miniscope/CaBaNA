import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { arena, DEFAULT_BIN_CM, effectiveBin, setArena, setBinCm, sizeCm } from '../lib/arena.ts';
import {
  DEFAULT_PLACE_SETTINGS,
  cancelPlaceRun,
  placeOutcome,
  placeSettings,
  placeStatus,
  runPlaceCells,
  placeShowResults,
  setPlaceSettings,
  setPlaceShowResults,
} from '../lib/place-run.ts';
import { placeChanges } from '../lib/place-ui.ts';
import { placeFrames, placeNeural, positionIssue } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { deconvolved, goToStep } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { OccupancyPreview } from './OccupancyPreview.tsx';
import { Note, SpeedFilterField } from './parts.tsx';
import { PlaceIntro, PlaceMethodText } from './PlaceMethodText.tsx';
import { PlaceResults } from './PlaceResults.tsx';
import { fitToWindow } from './QcPanel.tsx';

type NumKey =
  | 'nShuffles'
  | 'alpha'
  | 'fieldThreshold'
  | 'minFieldBins'
  | 'sigma'
  | 'minShiftS'
  | 'minOccFieldsS';

/** A compact number box with its unit beside it. Boxes holding something other than the default are highlighted. */
function Num(props: {
  k: NumKey;
  label: string;
  unit?: string;
  step: number;
  min?: number;
  max?: number;
  hint?: string;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <Show when={props.label}>
        <div class="cb-setting__title">
          {props.label}
          <Show when={props.hint}>
            <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.hint}</InfoTip>
          </Show>
        </div>
      </Show>
      <label
        class="cb-prep-field"
        classList={{
          'cb-prep-field--changed': placeSettings[props.k] !== DEFAULT_PLACE_SETTINGS[props.k],
        }}
      >
        <input
          type="number"
          min={props.min ?? 0}
          max={props.max}
          step={props.step}
          value={placeSettings[props.k]}
          onInput={(e) => {
            const v = +e.currentTarget.value;
            if (Number.isFinite(v))
              setPlaceSettings(
                props.k,
                Math.min(props.max ?? Infinity, Math.max(props.min ?? 0, v)),
              );
          }}
        />
        {props.unit}
      </label>
    </div>
  );
}

/** Auto (chosen from the data when the analysis runs) or Manual (a number you set), with what the last run used. */
function AutoManual(props: {
  title: string;
  auto: 'sigmaAuto' | 'shiftAuto';
  k: 'sigma' | 'minShiftS';
  unit: string;
  step: number;
  used?: string;
  hint: string;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <div class="cb-setting__title">
        {props.title}
        <InfoTip label={`About ${props.title.toLowerCase()}`}>{props.hint}</InfoTip>
      </div>
      <div class="cb-controls">
        <For each={[true, false]}>
          {(a) => (
            <label class="cb-radio">
              <input
                type="radio"
                name={props.auto}
                checked={placeSettings[props.auto] === a}
                onChange={() => setPlaceSettings(props.auto, a)}
              />
              {a ? 'Auto' : 'Manual'}
            </label>
          )}
        </For>
        <Show when={!placeSettings[props.auto]}>
          <Num k={props.k} label="" unit={props.unit} step={props.step} />
        </Show>
      </div>
      <Show when={props.used}>
        <div class="cb-muted">Last run chose {props.used}.</div>
      </Show>
    </div>
  );
}

type Sec = 'maps' | 'tests' | 'fields';
// Kept outside the page so the open section survives a visit to the results.
const [openSec, setOpenSec] = createSignal<Sec>('maps');

/** One settings group that opens on click. Closed, its header shows the current values. */
function Section(props: {
  id: Sec;
  n: number;
  title: string;
  summary: string;
  tag?: string;
  tagClass?: string;
  children: JSX.Element;
}): JSX.Element {
  const open = () => openSec() === props.id;
  return (
    <section class="cb-acc" classList={{ 'cb-acc--open': open() }}>
      <button
        type="button"
        class="cb-acc__head"
        aria-expanded={open()}
        aria-controls={`pc-sec-${props.id}`}
        onClick={() => setOpenSec(props.id)}
      >
        <span class="cb-acc__n">{props.n}</span>
        <span class="cb-acc__title">
          {props.title}
          <Show when={!open()}>
            <span class="cb-muted">{props.summary}</span>
          </Show>
        </span>
        <Show when={props.tag}>
          <span class={`cb-acc__tag ${props.tagClass}`}>{props.tag}</span>
        </Show>
        <span aria-hidden="true">{open() ? '▴' : '▾'}</span>
      </button>
      <Show when={open()}>
        <div class="cb-acc__body" id={`pc-sec-${props.id}`}>
          {props.children}
        </div>
      </Show>
    </section>
  );
}

function PlaceSetup(): JSX.Element {
  const frames = createMemo(() => placeFrames());
  const ready = () => !!(deconvolved() && placeNeural());
  const ok = () => {
    const f = frames();
    return f && !('error' in f) ? f : undefined;
  };
  const running = () => {
    const s = placeStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const error = () => {
    const s = placeStatus();
    const f = frames();
    if (s.kind === 'error') return s.message;
    if (!f && ready()) return positionIssue(true);
    if (f && 'error' in f) return f.error;
    return f && f.used === 0
      ? 'No frame passes the speed threshold. Lower the minimum speed.'
      : undefined;
  };
  const rejected = () => (deconvolved()?.cells ?? 0) - (placeNeural()?.cells ?? 0);
  const ps = placeSettings;
  const auto = (on: boolean, v: string) => (on ? 'Auto' : v);
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  const runButton = () => (
    <Show
      when={!running()}
      fallback={
        <button class="btn-secondary" onClick={cancelPlaceRun}>
          Cancel
        </button>
      }
    >
      <button
        class="btn-primary"
        disabled={!ready() || !ok() || ok()?.used === 0}
        onClick={() => void runPlaceCells()}
      >
        {placeOutcome() ? 'Run again' : 'Run analysis'}
      </button>
    </Show>
  );

  const status = () => {
    const s = running();
    if (s) return `${s.step}${s.total > 1 ? ` (${s.done} of ${s.total} cells)` : '…'}`;
    if (!ready()) return 'Load deconvolved neural data and position';
    if (error()) return 'Needs attention';
    return 'Ready to run';
  };

  return (
    <div class="cb-place" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Place cell analysis</h2>
          <PlaceIntro />
        </div>
        <div class="cb-place-head__side">
          <span class="cb-place-method__status">
            <i classList={{ 'cb-dot--ok': ready() && !error() && !running() }} /> {status()}
          </span>
          <Show when={placeNeural()}>
            <span class="cb-muted">
              {placeNeural()!.cells} cells included
              <Show when={rejected() > 0}>
                {' · '}
                {rejected()} excluded in{' '}
                <button class="cb-link" onClick={() => goToStep('qc')}>
                  Data QC
                </button>
              </Show>
            </span>
          </Show>
        </div>
        <div class="cb-controls">
          <Show when={placeOutcome()}>
            <button class="btn-secondary" onClick={() => setPlaceShowResults(true)}>
              {placeChanges().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>

      <Show when={running() && running()!.total > 1}>
        <progress class="cb-progress" value={running()!.done} max={running()!.total} />
      </Show>
      <Show when={error()}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ready()}>
        <div class="cb-empty">Load deconvolved neural data and position to run this analysis.</div>
      </Show>

      <Show when={ready() && ok()}>
        <div class="cb-place-body">
          <div class="cb-place-settings">
            <Section
              id="maps"
              n={1}
              title="Build spatial maps"
              summary={`${prep.minSpeed} cm/s · ${effectiveBin()} cm bins · ${arena.minOccupancy} s per bin · smoothing ${auto(ps.sigmaAuto, `${ps.sigma} bins`)}`}
            >
              <div class="cb-setting">
                <div class="cb-setting__title">
                  Minimum speed
                  <InfoTip label="About minimum speed">
                    Frames below this speed are left out of the maps and tests. Shared with auROC:
                    one value for both, which auROC uses only when its own speed filter is on.
                  </InfoTip>
                </div>
                <SpeedFilterField />
                <div class="cb-retained">
                  <div>
                    <strong>{ok()!.used.toLocaleString()}</strong> of{' '}
                    {placeNeural()!.frames.toLocaleString()} frames retained (
                    {Math.round((100 * ok()!.used) / placeNeural()!.frames)}%)
                  </div>
                  <progress
                    class="cb-progress cb-progress--thin"
                    value={ok()!.used}
                    max={placeNeural()!.frames}
                  />
                </div>
                <Note title="About retained frames">
                  <p>
                    Only frames at or above the minimum speed are included in spatial maps and
                    tuning tests. This restricts the analysis to periods of movement.
                  </p>
                  <p>
                    The retained percentage shows how much of the recording is included. Keeping
                    fewer frames can reduce spatial coverage and make rate estimates less reliable;
                    check the occupancy preview to assess sampling across the arena. A speed
                    threshold of 0 removes speed filtering.
                  </p>
                </Note>
              </div>
              <div class="cb-setting">
                <div class="cb-setting__title">
                  Spatial bin size
                  <InfoTip label="About spatial bin size">
                    Side length of each square spatial bin.
                  </InfoTip>
                </div>
                <label
                  class="cb-prep-field"
                  classList={{ 'cb-prep-field--changed': effectiveBin() !== DEFAULT_BIN_CM }}
                >
                  <input
                    type="number"
                    min="0.5"
                    max={Math.min(...sizeCm()) / 2}
                    step="0.5"
                    value={effectiveBin()}
                    onInput={(e) => setBinCm(+e.currentTarget.value || 0.5)}
                  />
                  cm <span class="cb-muted">default {DEFAULT_BIN_CM}</span>
                </label>
              </div>
              <div class="cb-setting">
                <div class="cb-setting__title">
                  Minimum time per bin
                  <InfoTip label="About minimum time per bin">
                    Bins below this duration have no rate and are excluded from the spatial-tuning
                    tests.
                  </InfoTip>
                </div>
                <label
                  class="cb-prep-field"
                  classList={{
                    'cb-prep-field--changed': arena.minOccupancy !== DEFAULT_PLACE_SETTINGS.minOccS,
                  }}
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={arena.minOccupancy}
                    onInput={(e) => {
                      const v = +e.currentTarget.value;
                      if (Number.isFinite(v)) setArena('minOccupancy', Math.max(0, v));
                    }}
                  />
                  s <span class="cb-muted">default {DEFAULT_PLACE_SETTINGS.minOccS}</span>
                </label>
              </div>
              <AutoManual
                title="Smoothing"
                hint="Smooth across neighboring spatial bins to reduce variability in event-rate estimates."
                auto="sigmaAuto"
                k="sigma"
                unit="bins"
                step={0.5}
                used={
                  placeOutcome() &&
                  `${placeOutcome()!.sigma} bins (${(placeOutcome()!.sigma * placeOutcome()!.data.grid.bin).toFixed(1)} cm)`
                }
              />
              <Note title="Choosing these settings">
                <p>
                  <strong>Bin size.</strong> Choose bins small enough to resolve spatial patterns,
                  but large enough to estimate activity reliably. Use the occupancy preview to check
                  coverage; if sampling is sparse, increase the bin size. Published calcium-imaging
                  place maps use bins of about 2 to 6.5 cm (3.5 cm, Ziv et al. 2013,
                  doi:10.1038/nn.3329; 4 cm, Rubin et al. 2015, doi:10.7554/eLife.12247; 6.5 cm, Cai
                  et al. 2016, doi:10.1038/nature17955; 2 cm, Shuman et al. 2020,
                  doi:10.1038/s41593-019-0559-0). Smoothing is set in bins, so changing the bin size
                  changes the blur in cm.
                </p>
                <p>
                  <strong>Minimum time per bin</strong> (default {DEFAULT_PLACE_SETTINGS.minOccS}{' '}
                  s). A bin with less time than this has no rate in the tests. The occupancy preview
                  shows how many bins meet it. The default is from the Miniscope place cell guide's
                  example run, not from a paper.
                </p>
                <p>
                  <strong>Smoothing</strong> is a Gaussian width in bins. Too little leaves maps
                  spiky, since a bin with few events looks like a field. Too much spreads one field
                  over its neighbors and merges nearby fields. <em>Auto</em> tries 0 to 4 bins and
                  keeps the least smoothing that predicts held-out data about as well as the best,
                  so no p-value is used to choose it. Use <em>Manual</em> to match a published
                  pipeline or to compare sessions with the same width.
                </p>
              </Note>
            </Section>

            <Section
              id="tests"
              n={2}
              title="Test spatial tuning"
              summary={`${ps.nShuffles} shuffles · p < ${ps.alpha} · shift ${auto(ps.shiftAuto, `${ps.minShiftS} s`)}`}
              tag="Classification"
              tagClass="cb-acc__tag--class"
            >
              <p class="cb-muted">
                Compare each cell’s spatial tuning with a null distribution made by circularly
                shifting its neural data relative to position. These settings decide which cells
                meet place-cell criteria.
              </p>
              <Num
                k="nShuffles"
                label="Shuffles"
                step={100}
                min={10}
                hint="Number of circular time shifts used to generate each cell’s null distribution."
              />
              <Num
                k="alpha"
                label="Significance (p <)"
                step={0.01}
                max={0.5}
                min={0.001}
                hint="Both spatial-tuning tests must meet this significance threshold."
              />
              <AutoManual
                title="Minimum circular shift"
                hint="Minimum time offset between neural data and position in shuffled data."
                auto="shiftAuto"
                k="minShiftS"
                unit="s"
                step={1}
                used={placeOutcome() && `${placeOutcome()!.minShiftS.toFixed(1)} s`}
              />
              <Note title="Choosing these settings">
                <p>
                  <strong>Shuffles</strong> (default 1000). The smallest p possible is 1 divided by
                  shuffles + 1, so 1000 shuffles resolves p down to about 0.001. More shuffles give
                  finer p-values, which a strict significance cutoff needs, but run time grows in
                  proportion. Fewer is fine for a quick look.
                </p>
                <p>
                  <strong>Significance</strong> (default 0.05). A cell is called a place cell when
                  both its spatial information and its stability reach this p. Lowering it gives
                  fewer cells and fewer chance calls; raising it does the reverse. Because both
                  tests must pass, chance calls are rarer than this value. Testing many cells still
                  produces some by chance.
                </p>
                <p>
                  <strong>Minimum circular shift.</strong> A copy slides the whole series forward in
                  time, wrapping around the end. That keeps the cell’s own rhythm but breaks its
                  link to position. The slide must be longer than how long the cell’s data and the
                  animal’s position stay correlated, or the copy still resembles the real data and
                  real cells are missed. <em>Auto</em> uses 3 times the longer of those two
                  timescales, between 5 s and a quarter of the session. Very long shifts leave few
                  distinct copies in a short session.
                </p>
              </Note>
            </Section>

            <Section
              id="fields"
              n={3}
              title="Outline place fields"
              summary={`${ps.fieldThreshold} of peak · ≥ ${ps.minFieldBins} bins · ${ps.minOccFieldsS} s per bin`}
              tag="Descriptive only"
              tagClass="cb-acc__tag--desc"
            >
              <p class="cb-muted">
                Identify contiguous regions with event rates above a fraction of the cell’s peak.
                These settings set field outlines and field measurements. They do not change which
                cells meet place-cell criteria.
              </p>
              <Num
                k="fieldThreshold"
                label="Fraction of peak"
                step={0.05}
                min={0.05}
                max={1}
                hint="Minimum event rate for field inclusion, as a fraction of the cell’s peak rate."
              />
              <Num
                k="minFieldBins"
                label="Smallest region"
                unit="bins"
                step={1}
                min={1}
                hint="Minimum number of contiguous bins required to define a field."
              />
              <Num
                k="minOccFieldsS"
                label="Minimum time per bin"
                unit="s"
                step={0.01}
                hint="Bins below this duration are excluded when outlining place fields."
              />
              <Note title="Choosing these settings">
                <p>
                  <strong>Fraction of peak</strong> (default 0.5). At 0.5 a field is every connected
                  group of bins at or above half the cell’s highest rate. Raising it shrinks
                  outlines to the core of each field; lowering it widens them and can join nearby
                  fields.
                </p>
                <p>
                  <strong>Smallest region</strong> (default 2 bins). Groups of fewer bins are
                  dropped, so one noisy bin is not a field. The size is in bins, so a larger bin
                  size means a larger area in cm.
                </p>
                <p>
                  <strong>Minimum time per bin</strong> (default 0.1 s). Bins visited for less time
                  are left out of field detection, so they can never be inside a field. This is
                  separate from the spatial-tuning value because the two are set independently in
                  the reference framework. The default is a framework default, with no published
                  source.
                </p>
                <p>
                  These settings set the outlines, the number of fields, and the in-field to
                  out-of-field rate ratio shown under field measures.
                </p>
              </Note>
            </Section>

            <details class="cb-notebox cb-place-method">
              <summary>How the analysis works</summary>
              <div class="cb-muted">
                <PlaceMethodText />
              </div>
            </details>
          </div>

          <OccupancyPreview which={openSec() === 'fields' ? 'fields' : 'tuning'} />
        </div>
      </Show>

      <div class="cb-place-foot cb-muted">
        Inputs: deconvolved events and position
        <Show when={placeNeural()}>
          {' · '}
          {placeNeural()!.cells} cells · {placeNeural()!.frames.toLocaleString()} frames · arena{' '}
          {sizeCm()[0].toFixed(0)} × {sizeCm()[1].toFixed(0)} cm
        </Show>
      </div>
      <div class="cb-pe-foot">
        <span class="cb-pe-foot__text">
          <i classList={{ 'cb-dot--ok': ready() && !error() && !running() }} />{' '}
          <span class="cb-muted">{status()}</span>
        </span>
        {runButton()}
      </div>
    </div>
  );
}

/** The Place cells page: its settings, or after a run its results. The results stay while the settings are edited. */
export function PlaceCellsPanel(): JSX.Element {
  const changes = createMemo(placeChanges);
  return (
    <Show when={placeShowResults() && placeOutcome()} keyed fallback={<PlaceSetup />}>
      {(out) => (
        <PlaceResults out={out} changes={changes()} onEdit={() => setPlaceShowResults(false)} />
      )}
    </Show>
  );
}
