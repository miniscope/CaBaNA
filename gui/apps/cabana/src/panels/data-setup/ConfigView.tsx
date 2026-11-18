// The settings of the experiment, in the Experimental setup pop-up: the six groups of the config
// on the left, the chosen group's fields on the right. The fields are bound to the same settings
// as before, so a change here is a change to the config the GUI writes and the framework reads.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { arena, calibrationIssue, positionUnitsPerCm, setArena } from '../../lib/arena.ts';
import { openEntry } from '../../lib/data-setup-view.ts';
import {
  derivedCameraFps,
  derivedDuration,
  derivedNeuralFps,
  override,
  setOverride,
  setSource,
  source,
} from '../../lib/store.ts';
import { PopButton } from '../QcParts.tsx';
import {
  DerivedField,
  DEVICES,
  ImportedConfig,
  StimuliTab,
  Text,
  ToolSelect,
} from '../SetupPanel.tsx';
import { analysisKind, NEURAL_LAYERS } from '../../lib/analysis-data.ts';
import { AnalysisDataField, AnalysisDataTable } from './AnalysisRole.tsx';
import {
  Experiment,
  experimentSummary,
  Num,
  Section,
  Select,
  Spatial,
  spatialSummary,
} from './ConfigFields.tsx';
import { AboutConfig, YamlView } from './ConfigYaml.tsx';
import { HelpMark } from '../../components/HelpMark.tsx';

const round = (v: number) => Math.round(v * 100) / 100;

// Kept while the pop-up is open; Actions, View as YAML shows the YAML.
export const [asYaml, setAsYaml] = createSignal(false);

const sessionSummary = () =>
  [
    override.durationS ?? derivedDuration(),
    override.neuralFps ?? derivedNeuralFps(),
    override.cameraFps ?? derivedCameraFps(),
  ]
    .map((v, i) => (v === undefined ? '–' : `${round(v)} ${i ? 'Hz' : 's'}`))
    .join(' · ');

function Session(): JSX.Element {
  return (
    <Section
      id="session"
      title="Session structure"
      why="Session length and frame rates put every frame on one time axis; the first three are worked out from the timestamp files. The behavior clock offset is how long the video ran before the miniscope started, and the scale corrects a camera clock that runs at a slightly different rate. Check the result in Timestamp alignment."
      keyFields={
        <>
          <DerivedField
            label="Session duration"
            unit="s"
            derived={derivedDuration}
            value={() => override.durationS ?? derivedDuration()}
            set={(v) => setOverride('durationS', v)}
            step={1}
          />
          <DerivedField
            label="Miniscope frame rate"
            unit="Hz"
            derived={derivedNeuralFps}
            value={() => override.neuralFps ?? derivedNeuralFps()}
            set={(v) => setOverride('neuralFps', v)}
          />
          <DerivedField
            label="Camera frame rate"
            unit="Hz"
            derived={derivedCameraFps}
            value={() => override.cameraFps ?? derivedCameraFps()}
            set={(v) => setOverride('cameraFps', v)}
          />
        </>
      }
      more={
        <>
          <Num
            label="Behavior clock offset"
            unit="s"
            value={source.clockOffsetS}
            set={(v) => setSource('clockOffsetS', v ?? 0)}
            step={0.01}
          />
          <Num
            label="Behavior clock scale"
            unit=""
            value={source.clockScale}
            set={(v) => setSource('clockScale', v || 1)}
            step={0.0001}
          />
          <p class="cb-ds-cfg__wide cb-muted">
            <button class="cb-linkbtn" onClick={() => openEntry('sync')}>
              Check the clocks in Timestamp alignment
            </button>
          </p>
        </>
      }
    />
  );
}

const trackingSummary = () =>
  [
    source.bodyPart || 'Body part not set',
    source.positionUnit === 'cm' ? 'cm' : 'pixels',
    source.positionUnit === 'cm' ? `y ${source.yDown ? 'down' : 'up'}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

function Tracking(): JSX.Element {
  return (
    <Section
      id="tracking"
      title="Tracking and coordinates"
      why="How positions and annotations were recorded, so they are read in the right units and orientation. Pixel positions need the arena scale from Spatial setup. The head direction offset is added so that 0 degrees points right and angles grow counterclockwise. The tool names only change the export advice shown."
      keyFields={
        <>
          <Text
            label="Body part(s) tracked"
            value={source.bodyPart}
            onInput={(v) => setSource('bodyPart', v)}
            placeholder="Back of the head"
          />
          <Select
            label="Position units"
            value={source.positionUnit}
            options={[
              ['cm', 'Centimeters'],
              ['px', 'Pixels'],
            ]}
            set={(v) => setSource('positionUnit', v)}
          />
          <Show
            when={source.positionUnit === 'cm'}
            fallback={
              <div class="cb-setup-field">
                Pixels per cm
                <span class={positionUnitsPerCm() ? 'cb-muted' : 'cb-error'}>
                  {positionUnitsPerCm()
                    ? `${positionUnitsPerCm()!.toFixed(2)}, from the arena scale`
                    : calibrationIssue()}
                </span>
              </div>
            }
          >
            <Select
              label="y increases"
              value={source.yDown ? 'down' : 'up'}
              options={[
                ['up', 'Up'],
                ['down', 'Down'],
              ]}
              set={(v) => setSource('yDown', v === 'down')}
            />
          </Show>
        </>
      }
      more={
        <>
          <ToolSelect field="positionTool" />
          <Num
            label="Head direction offset"
            unit="degrees"
            value={arena.headOffset}
            set={(v) => setArena('headOffset', v ?? 0)}
          />
          <ToolSelect field="annotationTool" />
          <Select
            label="Annotation units"
            value={source.annotationUnit}
            options={[
              ['seconds', 'Seconds'],
              ['milliseconds', 'Milliseconds'],
              ['camera frames', 'Camera frames'],
              ['miniscope frames', 'Miniscope frames'],
            ]}
            set={(v) => setSource('annotationUnit', v)}
          />
        </>
      }
    />
  );
}

const neuralSummary = () =>
  [NEURAL_LAYERS.find((l) => l.kind === analysisKind())?.label ?? 'No neural file', source.device]
    .filter(Boolean)
    .join(' · ');

function Neural(): JSX.Element {
  return (
    <Section
      id="neural"
      title="Neural acquisition"
      why="Which neural file the analyses read (the analysis data, written as neural.file; the others are reference data, under neural.alternatives), and a record of the hardware and the extraction and deconvolution tools. The tool names only change the export advice shown; check it against your tool's current version."
      keyFields={
        <>
          <AnalysisDataField />
          <Text
            label="Miniscope"
            value={source.device}
            onInput={(v) => setSource('device', v)}
            list={DEVICES}
          />
          <AnalysisDataTable />
        </>
      }
      more={
        <>
          <ToolSelect field="extractionTool" />
          <ToolSelect field="deconTool" />
        </>
      }
    />
  );
}

function Stimuli(): JSX.Element {
  return (
    <Section
      id="stimuli"
      title="Stimuli and cues"
      why="What the animal was shown or given. Each stimulus takes its times from a loaded label, so PETH and auROC can group frames by it. Written to metadata.stimuli."
      keyFields={<StimuliTab />}
      wide
    />
  );
}

const stimuliSummary = () =>
  source.stimuli.length
    ? `${source.stimuli.length} ${source.stimuli.length === 1 ? 'stimulus' : 'stimuli'}`
    : 'No stimuli set';

/** The six groups of the experimental setup, in the order of the list. */
const GROUPS: { id: string; title: string; summary: () => string; Body: () => JSX.Element }[] = [
  {
    id: 'experiment',
    title: 'Experiment and subjects',
    summary: experimentSummary,
    Body: Experiment,
  },
  { id: 'session', title: 'Session structure', summary: sessionSummary, Body: Session },
  { id: 'neural', title: 'Neural acquisition', summary: neuralSummary, Body: Neural },
  { id: 'tracking', title: 'Tracking and coordinates', summary: trackingSummary, Body: Tracking },
  { id: 'spatial', title: 'Spatial setup', summary: spatialSummary, Body: Spatial },
  { id: 'stimuli', title: 'Stimuli and cues', summary: stimuliSummary, Body: Stimuli },
];

// Kept while the pop-up is closed, so it opens on the group last used.
const [group, setGroup] = createSignal('experiment');

/** The settings of the experiment: the groups on the left, the chosen group's fields on the right. */
export function ConfigView(): JSX.Element {
  const current = () => GROUPS.find((g) => g.id === group()) ?? GROUPS[0];
  return (
    <div class="cb-es">
      <nav class="cb-es-nav" aria-label="Setup groups">
        <For each={GROUPS}>
          {(g) => (
            <button
              type="button"
              class="cb-es-nav__item"
              classList={{ 'cb-es-nav__item--on': current().id === g.id }}
              aria-current={current().id === g.id ? 'page' : undefined}
              onClick={() => setGroup(g.id)}
            >
              <span>{g.title}</span>
              <span class="cb-muted cb-es-nav__sum">{g.summary()}</span>
            </button>
          )}
        </For>
      </nav>
      <div class="cb-es-pane">
        <Show
          when={!asYaml()}
          fallback={
            <>
              <div class="cb-es-pane__bar">
                <strong>experiment.yaml</strong>
                <span class="cb-spacer" />
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  onClick={() => setAsYaml(false)}
                >
                  Back to settings
                </button>
                <PopButton
                  label="About config.yaml"
                  title="About config.yaml"
                  width={620}
                  class="cb-tip__btn"
                  button={<HelpMark />}
                >
                  {(close) => (
                    <AboutConfig
                      onYaml={() => {
                        setAsYaml(true);
                        close();
                      }}
                    />
                  )}
                </PopButton>
              </div>
              <YamlView />
            </>
          }
        >
          <ImportedConfig compact />
          {current().Body()}
        </Show>
      </div>
    </div>
  );
}
