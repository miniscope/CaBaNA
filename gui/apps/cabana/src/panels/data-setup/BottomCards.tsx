// The two cards under the data cards: Experiment details (the experimental setup and its
// experiment.yaml) and Import settings (settings reused from another project). Their main buttons
// have the same width and sit at the same height.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Pill } from '../../components/Pill.tsx';
import { arena } from '../../lib/arena.ts';
import { confirmAction, errorText, showMessage } from '../../lib/confirm.ts';
import { openEntry, setAppliedNote } from '../../lib/data-setup-view.ts';
import { byPath } from '../../lib/data-files.ts';
import { applied, importYaml, noteCopied, undoApplied } from '../../lib/import-settings.ts';
import { pickFile } from '../../lib/pick-file.ts';
import { addPathToProject, chooseFilePath, forgetSlot } from '../../lib/project-session.ts';
import { statusOfItem } from '../../lib/readiness-snapshot.ts';
import { captureSettings } from '../../lib/settings-template.ts';
import { alignmentText, arenaText, durationText, rateText } from '../../lib/setup-summary.ts';
import {
  addFiles,
  deconvolved,
  derivedCameraFps,
  experiment,
  experimentId,
  loaded,
  override,
  resetExperimentDetails,
  samplingRate,
  sessionDuration,
  traceMatrix,
} from '../../lib/store.ts';
import { behaviorTests } from '../BehaviorQc.tsx';
import { ApplyFrom } from './ApplyFrom.tsx';
import { ExportCopy } from './ExportCopy.tsx';
import { GroupInfo } from './slot-help.tsx';

const fail = (what: string) => (e: unknown) => showMessage(`${what} did not work`, errorText(e));

/** Add or replace the experiment.yaml: by path with the engine, else through the browser. */
function chooseExperimentFile(): void {
  if (!byPath()) return pickFile((f) => void addFiles([f], 'config'), '.yaml,.yml');
  void chooseFilePath('Select an experiment.yaml')
    .then((p) => (p ? addPathToProject('config', p) : undefined))
    .catch(fail('Adding the experiment.yaml'));
}

/** Details are set once a config is loaded or the experimental setup has content. */
const detailsSet = () =>
  !!loaded.config?.size || ['in_progress', 'complete'].includes(statusOfItem('setup').kind);

function removeDetails(): void {
  confirmAction({
    title: 'Remove experiment details?',
    message:
      'The experiment type, arena, zones, scale, frame rates and units go back to not set, and experiment.yaml is emptied. The data files stay.',
    confirmLabel: 'Remove experiment details',
    danger: true,
    onConfirm: () => {
      resetExperimentDetails();
      void forgetSlot('config');
    },
  });
}

function DetailsSummary(): JSX.Element {
  const timing = () => behaviorTests().find((c) => c.id === 'timing')?.checks ?? [];
  const alignment = () => alignmentText(timing().map((c) => c.status));
  const cells = () => (traceMatrix() ?? deconvolved())?.cells;
  const zones = () => arena.zones.filter((z) => z.kind === 'zone').length;
  const items = (): [string, JSX.Element][] => [
    ['Experiment', experimentId() === 'custom' ? 'Not set' : experiment().label],
    ['Arena', arenaText(arena.shape, arena.width, arena.height, zones())],
    ['Miniscope', rateText(samplingRate())],
    ['Camera', rateText(override.cameraFps ?? derivedCameraFps())],
    ['Duration', durationText(sessionDuration())],
    ['Cells', cells() === undefined ? 'Not known' : cells()!.toLocaleString('en-US')],
    [
      'Timestamp alignment',
      <Show when={timing().length} fallback={<span class="cb-muted">{alignment().text}</span>}>
        <button
          type="button"
          class="cb-sp-sum__link"
          title="Open the alignment checks"
          onClick={() => openEntry('sync')}
        >
          <Pill tone={alignment().tone === 'ok' ? 'ok' : 'flag'}>{alignment().text}</Pill>
        </button>
      </Show>,
    ],
  ];
  return (
    <dl class="cb-ld-kv">
      <For each={items()}>
        {([k, v]) => (
          <div>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

export function DetailsCard(): JSX.Element {
  const [exporting, setExporting] = createSignal(false);
  return (
    <section class="cb-ld-card" aria-label="Experiment details">
      <header class="cb-ld-card__head">
        <h3>Experiment details</h3>
        <GroupInfo label="Experiment details">
          <p>
            Experiment type, arena size and shape, scale, zones, frame rates and units.{' '}
            <b>Add experiment details</b> opens the experimental setup and creates{' '}
            <span class="cb-sp-mono">experiment.yaml</span> for this project. You can also start
            from an <span class="cb-sp-mono">experiment.yaml</span> from another project.
          </p>
          <p>Spatial analyses need the arena’s real size.</p>
        </GroupInfo>
      </header>
      <Show
        when={detailsSet()}
        fallback={
          <div class="cb-ld-card__body">
            <p class="cb-ld-card__desc">Experiment type, arena, scale, zones and timing.</p>
            <div class="cb-ld-mid">
              <button
                type="button"
                class="btn-secondary cb-ld-mainbtn"
                title="Creates experiment.yaml and saves it to this project"
                onClick={() => openEntry('config')}
              >
                Add experiment details
              </button>
            </div>
            <div class="cb-ld-under">
              <button
                type="button"
                class="cb-ld-ghost"
                title="Use an experiment.yaml from another project"
                onClick={chooseExperimentFile}
              >
                or add an existing experiment.yaml
              </button>
            </div>
          </div>
        }
      >
        <div class="cb-ld-card__body cb-ld-card__body--set">
          <DetailsSummary />
          <div class="cb-ld-cfgfoot">
            <span class="cb-ld-row__file">experiment.yaml</span>
            <ActionsMenu
              label="Edit"
              items={[
                { kind: 'action', label: 'Edit details', onSelect: () => openEntry('config') },
                {
                  kind: 'action',
                  label: 'Replace with another experiment.yaml',
                  onSelect: chooseExperimentFile,
                },
                {
                  kind: 'action',
                  label: 'Export experiment.yaml',
                  onSelect: () => setExporting(true),
                },
                { kind: 'separator' },
                {
                  kind: 'action',
                  label: 'Remove experiment details',
                  danger: true,
                  onSelect: removeDetails,
                },
              ]}
            />
          </div>
        </div>
      </Show>
      <Show when={exporting()}>
        <ExportCopy onClose={() => setExporting(false)} />
      </Show>
    </section>
  );
}

export function ImportCard(): JSX.Element {
  const [copying, setCopying] = createSignal<ReturnType<typeof captureSettings>>();
  const fromFile = (kind: 'processing' | 'analysis') =>
    pickFile((f) => void importYaml(kind, f).catch(fail('Importing the settings')), '.yaml,.yml');
  return (
    <section class="cb-ld-card cb-ld-card--optional" aria-label="Import settings">
      <header class="cb-ld-card__head">
        <h3>Import settings</h3>
        <GroupInfo label="Import settings">
          <p>
            Optional. Reuse a saved project’s settings so this recording is processed the same way.{' '}
            <b>+ YAML file</b> takes a project’s <span class="cb-sp-mono">processing.yaml</span> (QC
            and preprocessing) or <span class="cb-sp-mono">analysis.yaml</span>, or copies settings
            from another project.
          </p>
          <p>
            Arena geometry, clock alignment, rejected cells and label selections are never copied;
            they depend on the data.
          </p>
        </GroupInfo>
        <span class="cb-muted">Optional</span>
      </header>
      <div class="cb-ld-card__body">
        <p class="cb-ld-card__desc">
          Reuse settings from another CaBaNA project. Your data is not replaced.
        </p>
        <div class="cb-ld-mid">
          <ActionsMenu
            label="+ YAML file"
            class="btn-secondary cb-ld-mainbtn"
            items={[
              {
                kind: 'action',
                label: 'QC & preprocessing (processing.yaml)…',
                onSelect: () => fromFile('processing'),
              },
              {
                kind: 'action',
                label: 'Analysis (analysis.yaml)…',
                onSelect: () => fromFile('analysis'),
              },
              { kind: 'separator' },
              {
                kind: 'action',
                label: 'Copy from another project…',
                onSelect: () => setCopying(captureSettings()),
              },
            ]}
          />
        </div>
        <div class="cb-ld-under">
          <For each={applied()}>
            {(a) => (
              <div class="cb-ld-applied">
                <span class="cb-ld-row__mark">✓</span>
                <span>{a.label}</span>
                <span class="cb-ld-row__file" title={a.source}>
                  {a.source}
                </span>
                <span class="cb-spacer" />
                <button
                  type="button"
                  class="cb-ld-x"
                  title={`Undo ${a.label}: put back the settings from before`}
                  aria-label={`Undo ${a.label}`}
                  onClick={() => undoApplied(a)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={copying()}>
        {(before) => (
          <ApplyFrom
            onClose={() => setCopying(undefined)}
            onApplied={(text) => {
              noteCopied(text, before());
              setAppliedNote(text);
            }}
          />
        )}
      </Show>
    </section>
  );
}
