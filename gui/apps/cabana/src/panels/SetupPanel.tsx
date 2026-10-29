import { createSignal, For, Show, type JSX } from 'solid-js';
import { configReport } from '../lib/config-import.ts';
import {
  CARDS,
  setSetupCard,
  setupCard,
  setupSnapshot,
  statusOf,
  type CardId,
} from '../lib/setup-status.ts';
import { arena, arenaSummary, setArena } from '../lib/arena.ts';
import { INDICATORS } from '../lib/decon.ts';
import { indicatorId, setIndicator } from '../lib/decon-state.ts';
import { PARADIGMS } from '../lib/experiments.ts';
import { downloadConfig } from '../lib/session-config.ts';
import { ConfigReport, setupItems } from './ConfigReport.tsx';
import {
  derivedCameraFps,
  derivedDuration,
  derivedNeuralFps,
  markConfigProvided,
  experiment,
  experimentId,
  goToStep,
  labelRegistry,
  loaded,
  override,
  sessionName,
  setExperiment,
  setOverride,
  setSessionName,
  setSource,
  source,
} from '../lib/store.ts';
import { HELP, OPTIONS, type Field } from '../lib/tool-help.ts';
import { rangeText, showLabel } from '../lib/label-view.ts';
import { LabelRoles, RolesHelp, setStimuliView, stimuliView } from './LabelRoles.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Note } from './parts.tsx';
import { SpatialSetup } from './SpatialSetup.tsx';

const BRAIN_REGIONS = [
  'CA1',
  'CA3',
  'Dentate gyrus',
  'Subiculum',
  'mPFC',
  'ACC',
  'Amygdala',
  'Striatum',
];
const DEVICES = [
  'UCLA Miniscope V4',
  'UCLA Miniscope V4 wire-free',
  'UCLA Miniscope V3',
  'Inscopix nVista',
];
const STIMULUS_KINDS = [
  'Tone or sound',
  'Light',
  'Shock',
  'Reward',
  'Odor',
  'Object',
  'Other animal',
  'Other',
];

function Text(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  list?: string[];
  placeholder?: string;
}): JSX.Element {
  const id = `list-${props.label.replace(/\W/g, '')}`;
  return (
    <label class="cb-setup-field">
      {props.label}
      <input
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        list={props.list ? id : undefined}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <Show when={props.list}>
        <datalist id={id}>
          <For each={props.list}>{(o) => <option value={o} />}</For>
        </datalist>
      </Show>
    </label>
  );
}

function ToolSelect(props: { field: Field }): JSX.Element {
  return (
    <label class="cb-setup-field">
      {OPTIONS[props.field].label}
      <select
        value={source[props.field]}
        onChange={(e) => setSource(props.field, e.currentTarget.value)}
      >
        <For each={OPTIONS[props.field].options}>{([v, t]) => <option value={v}>{t}</option>}</For>
      </select>
    </label>
  );
}

/** Export advice for the tool chosen in `field`. */
const Help = (props: { field: Field }): JSX.Element => (
  <p class="cb-muted">
    {HELP[props.field].byTool[source[props.field]] ?? HELP[props.field].general}
  </p>
);

/**
 * A number worked out from the data files. It shows as text with an Edit button; editing asks first,
 * since the file is usually right. With no file loaded it is a plain box.
 */
function DerivedField(props: {
  label: string;
  unit: string;
  derived: () => number | undefined;
  value: () => number | undefined;
  set: (v: number | undefined) => void;
  step?: number;
}): JSX.Element {
  const [asking, setAsking] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const fromFile = () => props.derived() !== undefined;
  const shown = () =>
    props
      .value()
      ?.toFixed(2)
      .replace(/\.?0+$/, '');
  return (
    <div class="cb-setup-field">
      {props.label}
      <Show
        when={fromFile() && !editing()}
        fallback={
          <div class="cb-controls">
            <input
              type="number"
              min="0"
              step={props.step ?? 0.01}
              value={shown() ?? ''}
              onInput={(e) => props.set(e.currentTarget.value ? +e.currentTarget.value : undefined)}
            />{' '}
            {props.unit}
            <Show when={fromFile()}>
              <button
                class="cb-link"
                onClick={() => {
                  props.set(undefined);
                  setEditing(false);
                }}
              >
                Use the value from the files ({props.derived()!.toFixed(2)})
              </button>
            </Show>
          </div>
        }
      >
        <div class="cb-controls">
          <span>
            {shown()} {props.unit}
            <span class="cb-muted">
              {props.value() === props.derived() ? ' from your files' : ' edited'}
            </span>
          </span>
          <button class="btn-secondary btn-small" onClick={() => setAsking(true)}>
            Edit
          </button>
        </div>
        <Show when={asking()}>
          <div class="cb-note">
            This number was worked out from your data files. Changing it can put times, QC and
            results out of step with the data. Change it at your own risk.
            <div class="cb-controls">
              <button
                class="btn-secondary btn-small"
                onClick={() => {
                  setAsking(false);
                  setEditing(true);
                }}
              >
                Change anyway
              </button>
              <button class="btn-secondary btn-small" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function ExperimentTab(): JSX.Element {
  return (
    <section class="cb-group">
      <p class="cb-muted">
        Everything in this section is optional. What you fill in is saved with the config and helps
        QC and the analyses.
      </p>
      <div class="cb-setup-grid">
        <label class="cb-setup-field">
          Experimental paradigm
          <select value={experimentId()} onChange={(e) => setExperiment(e.currentTarget.value)}>
            <For each={PARADIGMS}>{(x) => <option value={x.id}>{x.label}</option>}</For>
          </select>
        </label>
        <Text label="Session name" value={sessionName() ?? ''} onInput={setSessionName} />
        <label class="cb-setup-field">
          Session date
          <input
            type="date"
            value={source.sessionDate}
            onInput={(e) => setSource('sessionDate', e.currentTarget.value)}
          />
        </label>
        <Text
          label="Subject ID"
          value={source.subjectId}
          onInput={(v) => setSource('subjectId', v)}
        />
        <Text
          label="Species"
          value={source.species}
          onInput={(v) => setSource('species', v)}
          placeholder="Mouse"
        />
        <Text
          label="Brain region"
          value={source.brainRegion}
          onInput={(v) => setSource('brainRegion', v)}
          list={BRAIN_REGIONS}
        />
        <label class="cb-setup-field">
          Calcium indicator
          <select value={indicatorId()} onChange={(e) => setIndicator(e.currentTarget.value)}>
            <For each={INDICATORS}>{(i) => <option value={i.id}>{i.label}</option>}</For>
          </select>
        </label>
        <Text
          label="Group or condition"
          value={source.group}
          onInput={(v) => setSource('group', v)}
        />
      </div>
      <p class="cb-muted">{experiment().summary}</p>
      <label class="cb-setup-field">
        Notes
        <textarea
          rows="2"
          value={source.notes}
          onInput={(e) => setSource('notes', e.currentTarget.value)}
        />
      </label>
      <Note>
        The indicator sets the decay time used when Deconvolution QC compares events with the trace.
        The paradigm decides which files are marked required, recommended or optional on Load data.
      </Note>
    </section>
  );
}

function SessionTab(): JSX.Element {
  return (
    <section class="cb-group">
      <p class="cb-muted">
        The first three are worked out from your timestamp files. They can be edited if the files
        are wrong.
      </p>
      <div class="cb-setup-grid">
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
        <label class="cb-setup-field">
          Behavior clock offset (s)
          <input
            type="number"
            step="0.01"
            value={source.clockOffsetS}
            onInput={(e) => setSource('clockOffsetS', +e.currentTarget.value || 0)}
          />
        </label>
        <label class="cb-setup-field">
          Behavior clock scale
          <input
            type="number"
            step="0.0001"
            min="0"
            value={source.clockScale}
            onInput={(e) => setSource('clockScale', +e.currentTarget.value || 1)}
          />
        </label>
      </div>
      <Note>
        The clock offset is how long the behavior video ran before the miniscope started. The clock
        scale corrects a camera clock that runs at a slightly different rate; leave it at 1 unless
        the two clocks drift apart. Camera times become scale x (time - offset), so position lines
        up with the neural frames everywhere in CaBaNA and in the saved config. Check the result
        under Timing and alignment in Data QC.
      </Note>
    </section>
  );
}

function TrackingTab(): JSX.Element {
  return (
    <div class="cb-setup-cols">
      <section class="cb-group">
        <h3>Position</h3>
        <div class="cb-setup-grid">
          <ToolSelect field="positionTool" />
          <label class="cb-setup-field">
            Position units
            <select
              value={source.positionUnit}
              onChange={(e) => setSource('positionUnit', e.currentTarget.value as 'cm' | 'px')}
            >
              <option value="cm">Centimeters</option>
              <option value="px">Pixels</option>
            </select>
          </label>
          <Show when={source.positionUnit === 'px'}>
            <label class="cb-setup-field">
              Pixels per cm
              <input
                type="number"
                min="0.01"
                value={source.pxPerCm}
                onInput={(e) => setSource('pxPerCm', Math.max(0.01, +e.currentTarget.value))}
              />
            </label>
          </Show>
          <Show when={source.positionUnit === 'cm'}>
            <label class="cb-setup-field">
              y increases
              <select
                value={source.yDown ? 'down' : 'up'}
                onChange={(e) => setSource('yDown', e.currentTarget.value === 'down')}
              >
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
          </Show>
          <Text
            label="Body part tracked"
            value={source.bodyPart}
            onInput={(v) => setSource('bodyPart', v)}
            placeholder="Back of the head"
          />
          <label class="cb-setup-field">
            Likelihood threshold
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={source.likelihoodMin ?? ''}
              onInput={(e) =>
                setSource(
                  'likelihoodMin',
                  e.currentTarget.value ? +e.currentTarget.value : undefined,
                )
              }
            />
          </label>
          <label class="cb-setup-field">
            Head direction offset (degrees)
            <input
              type="number"
              step="1"
              value={arena.headOffset}
              onInput={(e) => setArena('headOffset', +e.currentTarget.value || 0)}
            />
          </label>
        </div>
        <Help field="positionTool" />
        <Note>
          Position frames below the likelihood threshold are treated as lost. The head direction
          offset is added to the head orientation so that 0 degrees points to the right of the
          picture and angles grow counterclockwise. It only matters for head direction. Maps and
          zones put y up, with 0 at the arena's bottom edge. Camera tracking often has y growing
          downward instead; choose Down for position files like that, and y is flipped using the
          arena height. Zones in a loaded config are flipped the same way. Pixel positions are
          already read with y down, so this applies to centimeters only.
        </Note>
      </section>
      <section class="cb-group">
        <h3>Behavior annotations</h3>
        <div class="cb-setup-grid">
          <ToolSelect field="annotationTool" />
          <label class="cb-setup-field">
            Annotation units
            <select
              value={source.annotationUnit}
              onChange={(e) =>
                setSource('annotationUnit', e.currentTarget.value as typeof source.annotationUnit)
              }
            >
              <option value="seconds">Seconds</option>
              <option value="milliseconds">Milliseconds</option>
              <option value="camera frames">Camera frames</option>
              <option value="miniscope frames">Miniscope frames</option>
            </select>
          </label>
        </div>
        <Help field="annotationTool" />
      </section>
    </div>
  );
}

const STIM_PER_PAGE = 5;
const [stimPage, setStimPage] = createSignal(0);

function StimuliTab(): JSX.Element {
  const loadedLabels = () => [...new Set(labelRegistry().map((e) => e.name))];
  return (
    <section class="cb-group">
      <div class="cb-lbl-viewbar">
        <div class="cb-tabs" role="tablist" aria-label="Stimuli and cues views">
          <button
            role="tab"
            aria-selected={stimuliView() === 'stimuli'}
            classList={{ 'cb-tab--on': stimuliView() === 'stimuli' }}
            onClick={() => setStimuliView('stimuli')}
          >
            Stimuli
          </button>
          <button
            role="tab"
            aria-selected={stimuliView() === 'roles'}
            classList={{ 'cb-tab--on': stimuliView() === 'roles' }}
            onClick={() => setStimuliView('roles')}
          >
            Label roles <span class="cb-muted">{labelRegistry().length}</span>
          </button>
        </div>
        <span class="cb-muted">
          {stimuliView() === 'stimuli' ? (
            'What the animal was shown or given. Each stimulus takes its times from a label loaded on Load data.'
          ) : (
            <>
              Role sets the default selection only. <RolesHelp />
            </>
          )}
        </span>
      </div>
      <div style={{ display: stimuliView() === 'stimuli' ? 'block' : 'none' }}>
      <For each={source.stimuli.slice(stimPage() * STIM_PER_PAGE, (stimPage() + 1) * STIM_PER_PAGE)}>
        {(s, j) => {
          const i = () => stimPage() * STIM_PER_PAGE + j();
          return (
          <div class="cb-controls">
            <input
              type="text"
              placeholder="Name"
              value={s.name}
              onInput={(e) => setSource('stimuli', i(), 'name', e.currentTarget.value)}
            />
            <select
              value={s.kind}
              onChange={(e) => setSource('stimuli', i(), 'kind', e.currentTarget.value)}
            >
              <For each={STIMULUS_KINDS}>{(k) => <option>{k}</option>}</For>
            </select>
            <label>
              Label
              <select
                value={s.label ?? ''}
                onChange={(e) => setSource('stimuli', i(), 'label', e.currentTarget.value)}
              >
                <option value="" disabled>
                  Choose a label
                </option>
                <Show when={s.label && !loadedLabels().includes(s.label)}>
                  <option value={s.label}>{s.label}</option>
                </Show>
                <For each={loadedLabels()}>{(l) => <option value={l}>{l}</option>}</For>
              </select>
            </label>
            <Show when={s.label && !loadedLabels().includes(s.label)}>
              <span class="cb-error">
                Missing label '{s.label}'.{' '}
                <button class="cb-link" onClick={() => showLabel('load', s.label!)}>
                  Open Load data
                </button>
              </span>
            </Show>
            <label>
              Length
              <input
                type="number"
                min="0"
                step="0.1"
                value={s.durationS ?? ''}
                onInput={(e) =>
                  setSource(
                    'stimuli',
                    i(),
                    'durationS',
                    e.currentTarget.value ? +e.currentTarget.value : undefined,
                  )
                }
              />
              s
            </label>
            <input
              type="text"
              placeholder="Note"
              value={s.note}
              onInput={(e) => setSource('stimuli', i(), 'note', e.currentTarget.value)}
            />
            <button
              class="cb-link"
              onClick={() => setSource('stimuli', (l) => l.filter((_, k) => k !== i()))}
            >
              Remove
            </button>
          </div>
          );
        }}
      </For>
      <div class="cb-controls">
        <button
          class="btn-secondary btn-small"
          onClick={() => {
            setSource('stimuli', (l) => [...l, { name: '', kind: STIMULUS_KINDS[0], note: '' }]);
            setStimPage(Math.floor((source.stimuli.length - 1) / STIM_PER_PAGE));
          }}
        >
          Add a stimulus
        </button>
        <Show when={source.stimuli.length > STIM_PER_PAGE}>
          <button
            class="btn-secondary btn-small"
            disabled={stimPage() === 0}
            onClick={() => setStimPage(stimPage() - 1)}
          >
            Previous
          </button>
          <span class="cb-muted">
            {rangeText(stimPage(), source.stimuli.length, STIM_PER_PAGE)}
          </span>
          <button
            class="btn-secondary btn-small"
            disabled={(stimPage() + 1) * STIM_PER_PAGE >= source.stimuli.length}
            onClick={() => setStimPage(stimPage() + 1)}
          >
            Next
          </button>
        </Show>
      </div>
      </div>
      <div style={{ display: stimuliView() === 'roles' ? 'block' : 'none' }}>
        <LabelRoles />
      </div>
    </section>
  );
}

function NeuralTab(): JSX.Element {
  return (
    <section class="cb-group">
      <div class="cb-setup-grid">
        <Text
          label="Miniscope"
          value={source.device}
          onInput={(v) => setSource('device', v)}
          list={DEVICES}
        />
        <ToolSelect field="extractionTool" />
        <ToolSelect field="deconTool" />
      </div>
      <Help field="extractionTool" />
      <Help field="deconTool" />
      <Note>
        The tool names only change the export advice shown here. Check the advice against your
        tool's current version.
      </Note>
    </section>
  );
}

/** Records the settings as the session's config, so the Load data step shows it as loaded. */
function UpdateConfig(): JSX.Element {
  const [saved, setSaved] = createSignal(false);
  return (
    <>
      <Show when={saved()}>
        <span class="cb-muted">Config updated.</span>
      </Show>
      <button
        class="btn-secondary"
        onClick={() => {
          markConfigProvided(arenaSummary());
          setSaved(true);
        }}
      >
        Update config
      </button>
    </>
  );
}

/** What the config file filled in, as one line with the warnings and an expandable review. */
function ImportedConfig(): JSX.Element {
  return (
    <Show when={configReport()}>
      {(r) => (
        <div class="cb-setup-import">
          <strong>Configuration loaded</strong>
          <span class="cb-muted">
            {r().read.length} settings filled in from {loaded.config?.name ?? 'config.yaml'}; changes
            made here replace them.
          </span>
          <details class="cb-setup-pop">
            <summary>
              Review details
              <Show when={setupItems().length}>
                {' '}
                ({setupItems().length} to check)
              </Show>
            </summary>
            <div class="cb-setup-pop__body">
              <ConfigReport />
              <Show when={setupItems().length}>
                <ul class="cb-warn cb-setup-warns">
                  <For each={setupItems()}>
                    {(w) => (
                      <li>
                        {w.text}{' '}
                        <Show when={w.card}>
                          <button class="cb-link" onClick={() => setSetupCard(w.card!)}>
                            Open {CARDS.find((c) => c.id === w.card)!.title}
                          </button>
                        </Show>
                        <Show when={w.step}>
                          <button class="cb-link" onClick={() => goToStep(w.step!)}>
                            Go to Load data
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </details>
        </div>
      )}
    </Show>
  );
}

/** Where the user describes the experiment, the session, the arena and how the data was made. */
export function SetupPanel(): JSX.Element {
  const tab = setupCard;
  const only = (id: string) => ({ display: tab() === id ? 'block' : 'none' });
  const status = (id: CardId) => statusOf(id, setupSnapshot());
  return (
    <div class="cb-panel cb-panel--wide cb-setup">
      <div class="cb-setup-head">
        <h2>Experimental Setup</h2>
        <InfoTip label="About Experimental Setup">
          Describe your experiment so CaBaNA can interpret your data and identify available
          analyses. Spatial setup is required for many spatial analyses. Complete the other sections
          when they apply to your experiment; some settings may be required for particular analyses.
        </InfoTip>
        <span class="cb-muted">Describe the experiment so CaBaNA can offer the right analyses.</span>
        <span class="cb-spacer" />
        <UpdateConfig />
        <button class="btn-primary" onClick={downloadConfig}>
          Download Config
        </button>
      </div>
      <ImportedConfig />
      <div class="cb-setup-cards" role="tablist" aria-label="Setup sections">
        <For each={CARDS}>
          {(c) => (
            <button
              role="tab"
              class="cb-setup-card"
              aria-selected={tab() === c.id}
              classList={{ 'cb-setup-card--on': tab() === c.id }}
              onClick={() => setSetupCard(c.id)}
            >
              <span class="cb-setup-card__title">{c.title}</span>
              <span class="cb-setup-card__meta">
                <span class={`cb-pill cb-pill--${c.priority === 'Required' ? 'warn' : 'plain'}`}>
                  {c.priority}
                </span>
                <span class={`cb-setup-status cb-setup-status--${status(c.id).toLowerCase()}`}>
                  {status(c.id) === 'Complete' ? '✓ ' : status(c.id) === 'Incomplete' ? '◐ ' : '○ '}
                  {status(c.id)}
                </span>
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="cb-setup-view">
      <div style={only('experiment')}>
        <ExperimentTab />
      </div>
      <div style={only('session')}>
        <SessionTab />
      </div>
      {/* Kept mounted so the picture and tools survive a change of section. */}
      <div style={only('spatial')}>
        <SpatialSetup />
      </div>
      <div style={only('tracking')}>
        <TrackingTab />
      </div>
      <div style={only('stimuli')}>
        <StimuliTab />
      </div>
      <div style={only('neural')}>
        <NeuralTab />
      </div>
      </div>
    </div>
  );
}
