// Experiment config on the Data setup page: the six sections of the experiment's config.yaml, each
// in its own block with the fields that matter most shown and the rest under "Show all fields".
// The fields are the ones from Experimental setup, bound to the same settings, so a change here
// is a change to the config the GUI writes and the framework reads.

import { Show, type JSX } from 'solid-js';
import { arena, calibrationIssue, positionUnitsPerCm, setArena } from '../../lib/arena.ts';
import { openEntry } from '../../lib/data-setup-view.ts';
import { downloadConfig } from '../../lib/session-config.ts';
import {
  addFiles,
  derivedCameraFps,
  derivedDuration,
  derivedNeuralFps,
  override,
  setOverride,
  setSource,
  source,
} from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import {
  DerivedField,
  DEVICES,
  ImportedConfig,
  StimuliTab,
  Text,
  ToolSelect,
} from '../SetupPanel.tsx';
import { Experiment, Num, Section, Select, Spatial } from './ConfigFields.tsx';

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

function Tracking(): JSX.Element {
  return (
    <Section
      id="tracking"
      title="Tracking & coordinates"
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

function Neural(): JSX.Element {
  return (
    <Section
      id="neural"
      title="Neural acquisition"
      why="A record of the hardware and the extraction and deconvolution tools. The tool names only change the export advice shown; check it against your tool's current version."
      keyFields={
        <Text
          label="Miniscope"
          value={source.device}
          onInput={(v) => setSource('device', v)}
          list={DEVICES}
        />
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

export function ConfigView(): JSX.Element {
  return (
    <div class="cb-ds-config">
      <div class="cb-ds-head">
        <h3>Experiment config</h3>
        <span class="cb-spacer" />
        <label class="btn-secondary btn-small cb-file">
          Load previous config
          <input
            type="file"
            hidden
            accept=".yaml,.yml"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void addFiles([f], 'config');
            }}
          />
        </label>
        <button class="btn-secondary btn-small" onClick={downloadConfig}>
          Save config as…
        </button>
      </div>
      <ImportedConfig />
      <p class="cb-muted cb-ds-meta">
        Changes here, and in each file's sections, update the same config.yaml.
      </p>
      <Spatial />
      <Experiment />
      <Session />
      <Tracking />
      <section class="cb-ds-cfg">
        <header class="cb-ds-cfg__bar">
          <h4>Stimuli & cues</h4>
          <InfoTip label="Why Stimuli & cues matters" icon="?">
            What the animal was shown or given. Each stimulus takes its times from a loaded label,
            so PETH and auROC can group frames by it. Written to metadata.stimuli.
          </InfoTip>
        </header>
        <div class="cb-ds-cfg__body">
          <StimuliTab />
        </div>
      </section>
      <Neural />
    </div>
  );
}
