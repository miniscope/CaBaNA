// Project settings: one pop-up with sections on the left: General, Saving, Configuration files,
// Storage and History. Everything here acts on the open project through the engine.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { SavedIndicator } from '../../components/SavedIndicator.tsx';
import { setSaveMode } from '../../lib/autosave.ts';
import { dataFiles, openProject, setOpenProject } from '../../lib/open-project.ts';
import {
  openConfigFile,
  projectSettings,
  setProjectSettings,
  type SettingsSection,
} from '../../lib/project-dialogs.ts';
import { openExisting, tidyPath, updateProjectYaml } from '../../lib/project-session.ts';
import { RETENTION, sizeText, storageRows, type StorageRow } from '../../lib/project-view.ts';
import {
  CONFIG_FILES,
  projects,
  type DeletableCategory,
  type FileName,
  type Retention,
} from '../../lib/projects-client.ts';
import { savedWhen } from '../../lib/project-library.ts';
import { downloadYaml } from '../../lib/session-config.ts';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { RenameDialog } from './ProjectDialogs.tsx';

const SECTIONS: [SettingsSection, string][] = [
  ['general', 'General'],
  ['saving', 'Saving'],
  ['files', 'Configuration files'],
  ['storage', 'Storage'],
  ['history', 'History'],
];

const FILE_ROLE: Record<FileName, string> = {
  'project.yaml': 'name, data file references, storage settings',
  'experiment.yaml': 'experimental setup, the format the framework reads',
  'processing.yaml': 'QC decisions, corrections, preprocessing settings',
  'analysis.yaml': 'settings of all five analyses',
};

const Row = (props: { label: string; children: JSX.Element; action?: JSX.Element }) => (
  <div class="cb-ps__row">
    <span class="cb-muted">{props.label}</span>
    <span>{props.children}</span>
    {props.action}
  </div>
);

/** Run an engine call; its error shows under the section. */
const [problem, setProblem] = createSignal('');
async function attempt(what: () => Promise<unknown>): Promise<boolean> {
  setProblem('');
  try {
    await what();
    return true;
  } catch (e) {
    setProblem(e instanceof Error ? e.message : String(e));
    return false;
  }
}

function General(): JSX.Element {
  const project = () => openProject()!;
  const [renaming, setRenaming] = createSignal(false);
  const copy = async (on: boolean) => {
    await attempt(async () => {
      await updateProjectYaml({ copy_data: on });
      // Turning it on copies each referenced file now; turning it off keeps the copies already made.
      if (on)
        for (const f of dataFiles()) await projects.registerData(project().id, f.slot, f.path);
    });
  };
  return (
    <>
      <Row
        label="Project name"
        action={
          <button type="button" class="btn-secondary btn-small" onClick={() => setRenaming(true)}>
            Rename
          </button>
        }
      >
        {project().name}
      </Row>
      <Row
        label="Location"
        action={
          <span class="cb-ps__acts">
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => void attempt(() => projects.reveal(project().id))}
            >
              Show in Finder
            </button>
            <button
              type="button"
              class="btn-secondary btn-small"
              disabled
              title="Moving a project is not available yet. Duplicate it or export it as a zip."
            >
              Move…
            </button>
          </span>
        }
      >
        <span class="cb-sp-mono">{tidyPath(project().path)}/</span>
      </Row>
      <Row label="Created">{savedWhen(project().created)}</Row>
      <Row label="Data files">
        {dataFiles().length} referenced,{' '}
        {project().copy_data ? 'also copied into the project' : 'not copied'}
      </Row>
      <label class="cb-ps__check">
        <input
          type="checkbox"
          checked={project().copy_data}
          onChange={(e) => void copy(e.currentTarget.checked)}
        />
        <span>
          Copy data into the project
          <span class="cb-muted cb-dlg__sub">
            For archiving: a copy of each data file is kept in the project folder. Original files
            stay where they are and are never changed.
          </span>
        </span>
      </label>
      <For each={dataFiles()}>
        {(f) => (
          <div class="cb-ps__file">
            <span class="cb-sp-mono">{f.name}</span>
            <span class="cb-muted" title={f.path}>
              {f.slot.replace(/_/g, ' ')}
            </span>
            <span
              classList={{ 'cb-ps__missing': f.status === 'missing' || f.status === 'changed' }}
            >
              {f.status === 'present'
                ? 'found'
                : f.status === 'moved'
                  ? 'found at a new place'
                  : f.status === 'changed'
                    ? 'changed since it was added'
                    : 'missing'}
            </span>
          </div>
        )}
      </For>
      <Show when={renaming()}>
        <RenameDialog
          name={project().name}
          onClose={() => setRenaming(false)}
          onRename={(name) => {
            setRenaming(false);
            void attempt(async () => setOpenProject(await projects.rename(project().id, name)));
          }}
        />
      </Show>
    </>
  );
}

function Saving(): JSX.Element {
  const mode = () => openProject()!.save_mode;
  const choose = (m: 'auto' | 'manual') =>
    attempt(async () => {
      await updateProjectYaml({ save_mode: m });
      setSaveMode(m);
    });
  return (
    <>
      <label class="cb-ps__check">
        <input
          type="radio"
          name="save-mode"
          checked={mode() === 'auto'}
          onChange={() => void choose('auto')}
        />
        <span>
          Save automatically (recommended)
          <span class="cb-muted cb-dlg__sub">
            Settings are written about a second after each change. QC corrections and preprocessing
            are saved when they are applied.
          </span>
        </span>
      </label>
      <label class="cb-ps__check">
        <input
          type="radio"
          name="save-mode"
          checked={mode() === 'manual'}
          onChange={() => void choose('manual')}
        />
        <span>
          Save only when I choose Save project
          <span class="cb-muted cb-dlg__sub">
            Manage project then has Save project, and closing with unsaved changes asks first.
          </span>
        </span>
      </label>
    </>
  );
}

function Files(): JSX.Element {
  const project = () => openProject()!;
  const download = (name: FileName) =>
    attempt(async () => downloadYaml((await projects.readFile(project().id, name)).text, name));
  return (
    <>
      <For each={CONFIG_FILES}>
        {(name) => (
          <Row
            label={name}
            action={
              <ActionsMenu
                class="btn-secondary btn-small"
                items={[
                  { kind: 'action', label: 'View', onSelect: () => openConfigFile(name) },
                  {
                    kind: 'action',
                    label: 'Open in text editor',
                    sub: 'Shows the project folder in Finder',
                    onSelect: () => void projects.reveal(project().id),
                  },
                  { kind: 'separator' },
                  {
                    kind: 'action',
                    label: 'Import…',
                    disabled:
                      'Import where the settings live: Apply settings from, Import preprocessing settings, Load configuration.',
                    onSelect: () => undefined,
                  },
                  { kind: 'action', label: 'Export a copy…', onSelect: () => void download(name) },
                ]}
              />
            }
          >
            <span class="cb-muted">{FILE_ROLE[name]}</span>
          </Row>
        )}
      </For>
      <p class="cb-muted cb-ps__note">
        Files edited outside CaBaNA are checked before they are used; problems are listed with the
        line they are on.
      </p>
    </>
  );
}

function Storage(): JSX.Element {
  const project = () => openProject()!;
  const [report, { refetch }] = createResource(() => projects.storage(project().id));
  const [asking, setAsking] = createSignal<StorageRow>();
  const rows = () => (report() ? storageRows(report()!) : []);
  const retain = (r: Retention) => attempt(() => updateProjectYaml({ retention: r }));
  const remove = async (row: StorageRow) => {
    setAsking(undefined);
    if (await attempt(() => projects.deleteStorage(project().id, row.id as DeletableCategory)))
      void refetch();
  };
  return (
    <>
      <div class="cb-ps__retention">
        <span>Keep old analysis outputs</span>
        <span class="cb-seg" role="group" aria-label="Keep old analysis outputs">
          <For each={RETENTION}>
            {(r) => (
              <button
                type="button"
                classList={{ 'cb-seg__on': project().retention === r.id }}
                aria-pressed={project().retention === r.id}
                onClick={() => void retain(r.id)}
              >
                {r.label}
              </button>
            )}
          </For>
        </span>
      </div>
      <p class="cb-muted cb-ps__note">
        Runs past the limit lose their large files but keep their record, settings and summary
        table.
      </p>
      <Show when={report.error}>
        <p class="cb-warn">The storage sizes could not be read.</p>
      </Show>
      <For each={rows()}>
        {(row) => (
          <Row
            label={row.label}
            action={
              <Show when={row.deletable}>
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  disabled={!row.bytes}
                  onClick={() => setAsking(row)}
                >
                  Delete
                </button>
              </Show>
            }
          >
            <span class="cb-sp-mono">{sizeText(row.bytes)}</span>{' '}
            <span class="cb-muted">{row.note}</span>
          </Row>
        )}
      </For>
      <Show when={asking()}>
        {(row) => (
          <Modal
            label={`Delete ${row().label}`}
            title={`Delete ${row().label.toLowerCase()}?`}
            width={460}
            onClose={() => setAsking(undefined)}
            footer={
              <>
                <span class="cb-spacer" />
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  onClick={() => setAsking(undefined)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-primary btn-small cb-btn-danger"
                  onClick={() => void remove(row())}
                >
                  Delete {sizeText(row().bytes)}
                </button>
              </>
            }
          >
            <p class="cb-muted cb-dlg__text">
              This frees {sizeText(row().bytes)}. {row().consequence}
            </p>
          </Modal>
        )}
      </Show>
    </>
  );
}

function History(): JSX.Element {
  const project = () => openProject()!;
  const [report] = createResource(() => projects.history(project().id));
  const [asking, setAsking] = createSignal<{ id: string; time: string }>();
  const restore = async (id: string) => {
    setAsking(undefined);
    // The files are read again from disk, so the whole project is loaded again.
    if (await attempt(() => projects.restore(project().id, id))) {
      await attempt(() => openExisting({ id: project().id }));
      setProjectSettings(undefined);
    }
  };
  const changes = () => [...(report()?.changes ?? [])].reverse().slice(0, 40);
  return (
    <>
      <div class="sc">restore points</div>
      <Show
        when={report()?.snapshots.length}
        fallback={
          <p class="cb-muted">
            No restore points yet. One is kept before each run and after 30 minutes of editing.
          </p>
        }
      >
        <For each={report()!.snapshots}>
          {(s) => (
            <Row
              label={savedWhen(s.time)}
              action={
                <button type="button" class="btn-secondary btn-small" onClick={() => setAsking(s)}>
                  Restore
                </button>
              }
            >
              {s.reason === 'before run'
                ? 'Before a run'
                : s.reason === 'before restore'
                  ? 'Before a restore'
                  : 'While editing'}
            </Row>
          )}
        </For>
      </Show>
      <div class="sc cb-ps__gap">recent changes</div>
      <For each={changes()}>
        {(c) => (
          <Row label={savedWhen(c.time)}>
            {c.summary} <span class="cb-muted">· {c.file}</span>
          </Row>
        )}
      </For>
      <p class="cb-muted cb-ps__note">
        Restore brings back settings only; results are never changed.
      </p>
      <Show when={asking()}>
        {(s) => (
          <Modal
            label="Restore settings"
            title="Restore these settings?"
            width={460}
            onClose={() => setAsking(undefined)}
            footer={
              <>
                <span class="cb-spacer" />
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  onClick={() => setAsking(undefined)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-primary btn-small"
                  onClick={() => void restore(s().id)}
                >
                  Restore settings
                </button>
              </>
            }
          >
            <p class="cb-muted cb-dlg__text">
              Brings back experiment.yaml, processing.yaml and analysis.yaml as they were{' '}
              {savedWhen(s().time)}. The current settings are kept as a restore point first. Results
              and runs are not changed.
            </p>
          </Modal>
        )}
      </Show>
    </>
  );
}

const BODY: Record<SettingsSection, () => JSX.Element> = {
  general: General,
  saving: Saving,
  files: Files,
  storage: Storage,
  history: History,
};

export function ProjectSettings(): JSX.Element {
  const project = () => openProject()!;
  const section = () => projectSettings()!;
  return (
    <Modal
      label="Project settings"
      title="Project settings"
      head={<span class="cb-muted cb-vw-facts">{tidyPath(project().path)}/</span>}
      width={860}
      height={520}
      onClose={() => setProjectSettings(undefined)}
      actions={<SavedIndicator />}
    >
      <div class="cb-ps">
        <nav class="cb-ps__nav" aria-label="Project settings sections">
          <For each={SECTIONS}>
            {([id, label]) => (
              <button
                type="button"
                classList={{ 'cb-ps__nav--on': section() === id }}
                aria-current={section() === id ? 'page' : undefined}
                onClick={() => {
                  setProblem('');
                  setProjectSettings(id);
                }}
              >
                {label}
              </button>
            )}
          </For>
        </nav>
        <div class="cb-ps__body">
          <h3>{SECTIONS.find(([id]) => id === section())![1]}</h3>
          <Show when={problem()}>
            <p class="cb-warn" role="alert">
              {problem()}
            </p>
          </Show>
          <Show when={section()} keyed>
            {(s) => BODY[s]()}
          </Show>
        </div>
      </div>
    </Modal>
  );
}
