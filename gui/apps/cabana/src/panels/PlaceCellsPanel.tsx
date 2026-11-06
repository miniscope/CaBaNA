import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import {
  SectionList,
  StageBar,
  StageFooter,
  type GuidedSection,
} from '../components/GuidedSetup.tsx';
import { HowItWorks } from '../components/GuidedReview.tsx';
import { guided } from '../lib/guided.ts';
import { Requirements } from '../components/Requirements.tsx';
import { arena, effectiveBin } from '../lib/arena.ts';
import {
  cancelPlaceRun,
  placeOutcome,
  placeSettings,
  placeStatus,
  runPlaceCells,
  placeShowResults,
  progressText,
  setPlaceShowResults,
  watchPlaceRuns,
} from '../lib/place-run.ts';
import { engineFor, frameworkReady, startRunTracking } from '../lib/engine.ts';
import { placeChanges } from '../lib/place-ui.ts';
import { placeFrames, placeNeural, positionIssue } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { deconvolved, goToStep } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { OccupancyPreview } from './OccupancyPreview.tsx';
import { PlaceFieldSettings } from './PlaceFieldSettings.tsx';
import { PlaceIntro, PlaceMethodText } from './PlaceMethodText.tsx';
import { PlaceMapsSettings } from './PlaceMapsSettings.tsx';
import { PlaceResults } from './PlaceResults.tsx';
import { PlaceReviewStage, placeSummary } from './PlaceReviewStage.tsx';
import { PlaceRunStage } from './PlaceRunStage.tsx';
import { auto } from './PlaceSettingFields.tsx';
import { PlaceTuningSettings } from './PlaceTuningSettings.tsx';
import { fitToWindow } from './QcPanel.tsx';

const SECTIONS = ['maps', 'tests', 'fields', 'occupancy'];
// Kept outside the page so the open stage and section survive a visit to the results.
const g = guided('place', 'maps');
// The occupancy check follows the settings group opened last.
const [lastSettings, setLastSettings] = createSignal<'tuning' | 'fields'>('tuning');

/** The body of one settings group. */
function Section(props: { id: string; children: JSX.Element }): JSX.Element {
  return (
    <Show when={g.section() === props.id}>
      <div class="cb-acc__body" id={`pc-sec-${props.id}`}>
        {props.children}
      </div>
    </Show>
  );
}

function PlaceSetup(): JSX.Element {
  const frames = createMemo(() => placeFrames());
  const ready = () => !!(deconvolved() && placeNeural());
  const ps = placeSettings;
  createEffect(() => {
    const id = g.section();
    if (id === 'maps' || id === 'tests') setLastSettings('tuning');
    if (id === 'fields') setLastSettings('fields');
  });
  const sections = (): GuidedSection[] => [
    {
      id: 'maps',
      title: 'Spatial maps',
      summary: `${prep.minSpeed} cm/s · ${effectiveBin()} cm bins · ${arena.minOccupancy} s per bin · smoothing ${auto(ps.sigmaAuto, `${ps.sigma} bins`)}`,
      attention: ok()?.used === 0 ? 'no frame passes the minimum speed' : undefined,
    },
    {
      id: 'tests',
      title: 'Spatial tuning',
      summary: `Classification · ${ps.nShuffles} shuffles · p < ${ps.alpha} · shift ${auto(ps.shiftAuto, `${ps.minShiftS} s`)}`,
    },
    {
      id: 'fields',
      title: 'Place fields',
      summary: `Descriptive only · ${ps.fieldThreshold} of peak · ≥ ${ps.minFieldBins} bins · ${ps.minOccFieldsS} s per bin`,
    },
    { id: 'occupancy', title: 'Occupancy', summary: 'Check: time spent in each bin' },
  ];
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
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  const framework = () => engineFor('place') === 'framework';
  const previewBlocked = () =>
    !framework()
      ? 'Needs the framework engine. This page runs on the browser engine; Quick preview runs only on the framework engine.'
      : !frameworkReady()
        ? 'Needs the framework engine, which is not connected.'
        : undefined;
  const blocked = () =>
    !ready()
      ? 'Load deconvolved neural data and position first.'
      : !ok() || ok()!.used === 0
        ? (error() ?? 'No frames to analyze.')
        : framework() && !frameworkReady()
          ? 'The framework engine is not connected. Use the browser engine button above, or connect the bridge.'
          : undefined;
  const start = (preview: boolean) => {
    g.setStage('run');
    void runPlaceCells(preview ? { preview: true } : {});
  };

  const status = () => {
    const s = running();
    if (s) return `${s.step}${progressText(s) ? ` (${progressText(s)})` : '…'}`;
    if (!ready()) return 'Load deconvolved neural data and position';
    if (error()) return 'Needs attention';
    return 'Ready to run';
  };
  return (
    <div class="cb-place cb-gs" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>
            Place cell analysis
            <InfoTip label="About the place cell analysis">
              <PlaceIntro />
            </InfoTip>
            <HowItWorks title="How the place cell analysis works">
              <div class="cb-muted">
                <PlaceMethodText />
              </div>
            </HowItWorks>
          </h2>
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
              {placeChanges().length ? 'View results (earlier settings)' : 'View results'}
            </button>
          </Show>
        </div>
      </div>

      <StageBar
        g={g}
        done={{
          configure: SECTIONS.every((id) => g.reviewed(id)),
          review: !!placeOutcome() && placeOutcome()!.record?.scope === 'preview',
          run: !!placeOutcome() && placeOutcome()!.record?.scope !== 'preview',
        }}
      />
      <Show when={!ready()}>
        <div class="cb-empty">Load deconvolved neural data and position to run this analysis.</div>
      </Show>
      <Show when={ready() && g.stage() !== 'run' && error()}>
        <div class="cb-note">{error()}</div>
      </Show>

      <Show when={ready() && ok() && g.stage() === 'configure'}>
        <SectionList g={g} label="Place cell settings" sections={sections()}>
          {() => (
            <>
              <Section id="maps">
                <PlaceMapsSettings used={ok()!.used} />
              </Section>

              <Section id="tests">
                <PlaceTuningSettings />
              </Section>

              <Section id="fields">
                <PlaceFieldSettings />
              </Section>

              <Section id="occupancy">
                <OccupancyPreview which={lastSettings()} />
              </Section>
            </>
          )}
        </SectionList>
      </Show>

      <Show when={ready() && g.stage() === 'review'}>
        <PlaceReviewStage
          g={g}
          groups={placeSummary(ok()?.used, framework())}
          running={!!running()}
          blocked={blocked()}
          previewBlocked={previewBlocked()}
          onRun={start}
        />
      </Show>

      <Show when={ready() && g.stage() === 'run'}>
        <PlaceRunStage
          running={running()}
          error={placeStatus().kind === 'error' ? error() : undefined}
        />
      </Show>

      <StageFooter
        g={g}
        status={
          <span>
            <i classList={{ 'cb-dot--ok': ready() && !error() && !running() }} /> {status()}
          </span>
        }
        actions={
          <Show when={running()}>
            <button class="btn-secondary" onClick={cancelPlaceRun}>
              Cancel
            </button>
          </Show>
        }
      />
    </div>
  );
}

/** The Place cells page: its settings, or after a run its results. The results stay while the settings are edited. */
export function PlaceCellsPanel(): JSX.Element {
  startRunTracking();
  watchPlaceRuns();
  const changes = createMemo(placeChanges);
  return (
    <>
      <Requirements analysis="place" />
      <Show when={placeShowResults() && placeOutcome()} keyed fallback={<PlaceSetup />}>
        {(out) => (
          <PlaceResults out={out} changes={changes()} onEdit={() => setPlaceShowResults(false)} />
        )}
      </Show>
    </>
  );
}
