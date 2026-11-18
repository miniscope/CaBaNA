import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js';
import { ConfigureBody, type ConfigureControl } from '../components/ConfigureBody.tsx';
import { type GuidedSection } from '../components/GuidedSetup.tsx';
import { guided } from '../lib/guided.ts';
import { BackToCards } from './AnalysisBack.tsx';
import { arena, effectiveBin } from '../lib/arena.ts';
import {
  placeOutcome,
  placeSettings,
  placeStatus,
  runPlaceCells,
  placeShowResults,
  setPlaceShowResults,
  watchPlaceRuns,
} from '../lib/place-run.ts';
import { engineFor, frameworkReady, startRunTracking } from '../lib/engine.ts';
import { placeChanges } from '../lib/place-ui.ts';
import { placeFrames, placeNeural, positionIssue } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { deconvolved } from '../lib/store.ts';
import { OccupancyPreview } from './OccupancyPreview.tsx';
import { PlaceFieldSettings } from './PlaceFieldSettings.tsx';
import { PlaceMapsSettings } from './PlaceMapsSettings.tsx';
import { PlaceResults } from './PlaceResults.tsx';
import { PlaceReviewStage, placeSummary } from './PlaceReviewStage.tsx';
import { auto } from './PlaceSettingFields.tsx';
import { PlaceTuningSettings } from './PlaceTuningSettings.tsx';

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

/** The Configure settings groups, or with `review` the Preview window's content. */
export function PlaceSetup(props: {
  configure?: ConfigureControl;
  /** The Preview window's content instead of the setting groups. */
  review?: boolean;
}): JSX.Element {
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
    g.setStage('run'); // the Preview window closes when a run starts
    void runPlaceCells(preview ? { preview: true } : {});
  };

  const sectionBody = () => (
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
  );
  const configureView = (c: () => ConfigureControl) => (
    <Show
      when={ready() && ok()}
      fallback={
        <div class="cb-empty">
          {ready()
            ? (error() ?? 'No frames to analyze.')
            : 'Load deconvolved neural data and position to run this analysis.'}
        </div>
      }
    >
      <ConfigureBody g={g} label="Place cell settings" sections={sections()} control={c()}>
        {sectionBody}
      </ConfigureBody>
    </Show>
  );

  const reviewView = () => (
    <Show
      when={ready() && ok()}
      fallback={
        <div class="cb-empty">
          {ready()
            ? (error() ?? 'No frames to analyze.')
            : 'Load deconvolved neural data and position to run this analysis.'}
        </div>
      }
    >
      <PlaceReviewStage
        g={g}
        groups={placeSummary(ok()?.used, framework())}
        running={!!running()}
        blocked={blocked()}
        previewBlocked={previewBlocked()}
        onRun={start}
      />
    </Show>
  );

  return (
    <Show
      when={props.review}
      fallback={<Show when={props.configure}>{(c) => configureView(c)}</Show>}
    >
      {reviewView()}
    </Show>
  );
}

/** The Place cells results page. Without a result, setup is in the card's Actions. */
export function PlaceCellsPanel(): JSX.Element {
  startRunTracking();
  watchPlaceRuns();
  const changes = createMemo(placeChanges);
  return (
    <Show when={placeShowResults() && placeOutcome()} keyed fallback={<BackToCards id="place" />}>
      {(out) => (
        <PlaceResults out={out} changes={changes()} onEdit={() => setPlaceShowResults(false)} />
      )}
    </Show>
  );
}
