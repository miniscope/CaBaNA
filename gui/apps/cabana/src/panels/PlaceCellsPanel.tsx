import { createMemo, For, Show, type JSX } from 'solid-js';
import { arena, effectiveBin, setArena } from '../lib/arena.ts';
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
import { placeFrames, placeNeural } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { deconvolved, goToStep } from '../lib/store.ts';
import { OccupancyPreview } from './OccupancyPreview.tsx';
import { Note } from './parts.tsx';
import { PlaceIntro, PlaceMethodText } from './PlaceMethodText.tsx';
import { PlaceResults } from './PlaceResults.tsx';

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
      <div class="cb-setting__title">{props.label}</div>
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
      <Show when={props.hint}>
        <div class="cb-muted">{props.hint}</div>
      </Show>
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
      <div class="cb-setting__title">{props.title}</div>
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
      <div class="cb-muted">{props.hint}</div>
      <Show when={props.used}>
        <div class="cb-muted">Last run chose {props.used}.</div>
      </Show>
    </div>
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
    if (f && 'error' in f) return f.error;
    return f && f.used === 0
      ? 'No frame passes the speed threshold. Lower the minimum speed in Preprocess.'
      : undefined;
  };
  const rejected = () => (deconvolved()?.cells ?? 0) - (placeNeural()?.cells ?? 0);

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
    <>
      <div class="cb-place-head">
        <div>
          <h2>Place cell analysis</h2>
          <PlaceIntro />
          <Show when={placeNeural()}>
            <p class="cb-muted">
              {placeNeural()!.cells} cells included
              <Show when={rejected() > 0}>
                {' · '}
                {rejected()} excluded in{' '}
                <button class="cb-link" onClick={() => goToStep('qc')}>
                  Data QC
                </button>
              </Show>
            </p>
          </Show>
        </div>
        <div class="cb-controls">
          <Show when={placeOutcome()}>
            <button class="btn-secondary" onClick={() => setPlaceShowResults(true)}>
              {placeChanges().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
          {runButton()}
        </div>
      </div>

      <details class="cb-notebox cb-place-method">
        <summary>
          How the analysis works
          <span class="cb-place-method__status">
            <i classList={{ 'cb-dot--ok': ready() && !error() && !running() }} /> {status()}
          </span>
        </summary>
        <div class="cb-muted">
          <PlaceMethodText />
        </div>
      </details>
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
        <div class="cb-place-cols">
          <section class="cb-setgroup">
            <h3>Spatial maps</h3>
            <p class="cb-muted">
              Calculate each cell’s event-rate map from movement-filtered data, with smoothing.
            </p>
            <div class="cb-setting">
              <div class="cb-setting__title">Minimum speed</div>
              <div>
                {prep.minSpeed} cm/s, set in{' '}
                <button class="cb-link" onClick={() => goToStep('prep')}>
                  Preprocess
                </button>
              </div>
              <div class="cb-muted">Exclude frames with movement below this speed.</div>
            </div>
            <div class="cb-statbox">
              <div class="cb-setting__title">
                {ok()!.used.toLocaleString()} / {placeNeural()!.frames.toLocaleString()} frames
                retained ({Math.round((100 * ok()!.used) / placeNeural()!.frames)}%)
              </div>
              <progress
                class="cb-progress cb-progress--thin"
                value={ok()!.used}
                max={placeNeural()!.frames}
              />
              <Note>
                <p>
                  Only frames at or above the minimum speed are included in spatial maps and tuning
                  tests. This restricts the analysis to periods of movement.
                </p>
                <p>
                  The retained percentage shows how much of the recording is included. Keeping fewer
                  frames can reduce spatial coverage and make rate estimates less reliable; check
                  the occupancy preview to assess sampling across the arena. A speed threshold of 0
                  removes speed filtering.
                </p>
              </Note>
            </div>
            <div class="cb-setting">
              <div class="cb-setting__title">Spatial bin size</div>
              <div>
                {effectiveBin()} cm, set in{' '}
                <button class="cb-link" onClick={() => goToStep('prep')}>
                  Preprocess
                </button>
              </div>
              <div class="cb-muted">Side length of each square spatial bin.</div>
              <Note>
                <p>
                  Choose bins small enough to resolve spatial patterns, but large enough to estimate
                  activity reliably. Use the occupancy preview to check coverage; if sampling is
                  sparse, increase bin size in Preprocess.
                </p>
                <p>Smoothing is set in bins, so changing the bin size changes the blur in cm.</p>
              </Note>
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
            <Note>
              <p>
                A Gaussian width in bins. Too little leaves maps spiky, since a bin with few events
                looks like a field. Too much spreads one field over its neighbors and merges nearby
                fields. <em>Auto</em> tries 0 to 4 bins and keeps the least smoothing that predicts
                held-out data about as well as the best, so no p-value is used to choose it. Use{' '}
                <em>Manual</em> to match a published pipeline or to compare sessions with the same
                width.
              </p>
            </Note>
          </section>

          <section class="cb-setgroup">
            <h3>Spatial tuning</h3>
            <p class="cb-muted">
              Compare each cell’s spatial tuning with a null distribution made by circularly
              shifting its neural data relative to position.
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
            <div class="cb-setting">
              <div class="cb-setting__title">Minimum time per bin</div>
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
                s
              </label>
              <div class="cb-muted">
                Bins below this duration are excluded from the spatial-tuning tests.
              </div>
            </div>
            <Note>
              <p>
                <strong>Shuffles</strong> (default 1000). The smallest p possible is 1 divided by
                shuffles + 1, so 1000 shuffles resolves p down to about 0.001. More shuffles give
                finer p-values, which a strict significance cutoff needs, but run time grows in
                proportion. Fewer is fine for a quick look.
              </p>
              <p>
                <strong>Significance</strong> (default 0.05). A cell is called a place cell when
                both its spatial information and its stability reach this p. Lowering it gives fewer
                cells and fewer chance calls; raising it does the reverse. Because both tests must
                pass, chance calls are rarer than this value. Testing many cells still produces some
                by chance.
              </p>
              <p>
                <strong>Minimum circular shift.</strong> A copy slides the whole series forward in
                time, wrapping around the end. That keeps the cell’s own rhythm but breaks its link
                to position. The slide must be longer than how long the cell’s data and the animal’s
                position stay correlated, or the copy still resembles the real data and real cells
                are missed. <em>Auto</em> uses 3 times the longer of those two timescales, between 5
                s and a quarter of the session. Very long shifts leave few distinct copies in a
                short session.
              </p>
              <p>
                <strong>Minimum time per bin</strong> (default 0.05 s). A bin with less time than
                this has no rate in the tests. The occupancy preview shows how many bins meet it.
                The default is the one used by the reference framework; no source for it is
                documented.
              </p>
            </Note>
          </section>

          <section class="cb-setgroup">
            <h3>Place-field boundaries</h3>
            <p class="cb-muted">
              Identify contiguous regions with event rates above a fraction of the cell’s peak.
              These settings define field boundaries without affecting place-cell classification.
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
            <Note>
              <p>
                <strong>Fraction of peak</strong> (default 0.5). At 0.5 a field is every connected
                group of bins at or above half the cell’s highest rate. Raising it shrinks outlines
                to the core of each field; lowering it widens them and can join nearby fields.
              </p>
              <p>
                <strong>Smallest region</strong> (default 2 bins). Groups of fewer bins are dropped,
                so one noisy bin is not a field. The size is in bins, so a larger bin size means a
                larger area in cm.
              </p>
              <p>
                <strong>Minimum time per bin</strong> (default 0.1 s). Bins visited for less time
                are left out of field detection, so they can never be inside a field. This is
                separate from the spatial-tuning value because the two are set independently in the
                reference framework.
              </p>
              <p>
                These settings set the outlines, the number of fields, and the in-field to
                out-of-field rate ratio shown under field measures.
              </p>
            </Note>
          </section>
        </div>

        <OccupancyPreview />
      </Show>
    </>
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
