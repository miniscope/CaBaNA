import { createSignal, For, Show, type JSX } from 'solid-js';
import { configReport } from '../lib/config-import.ts';
import { CARDS, setSetupCard } from '../lib/setup-status.ts';
import { ConfigReport, setupItems } from './ConfigReport.tsx';
import { goToStep, labelRegistry, loaded, setSource, source } from '../lib/store.ts';
import { OPTIONS, type Field } from '../lib/tool-help.ts';
import { rangeText, showLabel } from '../lib/label-view.ts';
import { LabelRoles, RolesHelp, setStimuliView, stimuliView } from './LabelRoles.tsx';

export const BRAIN_REGIONS = [
  'CA1',
  'CA3',
  'Dentate gyrus',
  'Subiculum',
  'mPFC',
  'ACC',
  'Amygdala',
  'Striatum',
];
export const DEVICES = [
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

export function Text(props: {
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

export function ToolSelect(props: { field: Field }): JSX.Element {
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
/**
 * A number worked out from the data files. It shows as text with an Edit button; editing asks first,
 * since the file is usually right. With no file loaded it is a plain box.
 */
export function DerivedField(props: {
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

const STIM_PER_PAGE = 5;
const [stimPage, setStimPage] = createSignal(0);

export function StimuliTab(): JSX.Element {
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
        <For
          each={source.stimuli.slice(stimPage() * STIM_PER_PAGE, (stimPage() + 1) * STIM_PER_PAGE)}
        >
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

/** What the config file filled in, as one line with the warnings and an expandable review. */
/** What a loaded config filled in, with its report. `compact`: one line for a page header. */
export function ImportedConfig(props: { compact?: boolean }): JSX.Element {
  return (
    <Show when={configReport()}>
      {(r) => (
        <div class="cb-setup-import" classList={{ 'cb-setup-import--compact': props.compact }}>
          <Show
            when={props.compact}
            fallback={
              <>
                <strong>Configuration loaded</strong>
                <span class="cb-muted">
                  {r().read.length} settings filled in from {loaded.config?.name ?? 'config.yaml'};
                  changes made here replace them.
                </span>
              </>
            }
          >
            <span class="cb-muted">
              {loaded.config?.name ?? 'config.yaml'} · {r().read.length} settings filled in ·
            </span>
          </Show>
          <details class="cb-setup-pop">
            <summary>
              Review details
              <Show when={setupItems().length}> ({setupItems().length} to check)</Show>
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
