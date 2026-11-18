import { createSignal, Show, type JSX } from 'solid-js';
import { CompactHeader } from '@calab/ui';
import pkg from '../../package.json';
import {
  closeSession,
  deconvolved,
  goToStep,
  experiment,
  experimentId,
  samplingRate,
  sessionDuration,
  sessionName,
  setSessionName,
  source,
  traceMatrix,
} from '../lib/store.ts';
import { errorText, showMessage } from '../lib/confirm.ts';
import { headerLine, type SessionFacts } from '../lib/header-line.ts';
import { nothingLoaded } from '../lib/data-setup-view.ts';
import { renameSaved } from '../lib/settings-template.ts';
import { openProject, setOpenProject } from '../lib/open-project.ts';
import { projects } from '../lib/projects-client.ts';
import { hasUnsaved, saveNow, updateAutosaveProject } from '../lib/autosave.ts';
import { openProjectSettings, setExportOpen } from '../lib/project-dialogs.ts';
import { projectsOn } from '../lib/project-session.ts';
import { sizeText } from '../lib/project-view.ts';
import { ProjectWindows } from '../panels/projects/ProjectWindows.tsx';
import type { MenuItem } from '../lib/actions-menu.ts';
import {
  ClearSessionDialog,
  DeleteProjectDialog,
  RenameDialog,
} from '../panels/projects/ProjectDialogs.tsx';
import { ActionsMenu } from './ActionsMenu.tsx';
import { SavedIndicator } from './SavedIndicator.tsx';

/** What is known about the open session; undefined while no neural data is loaded. */
function facts(): SessionFacts | undefined {
  const m = traceMatrix() ?? deconvolved();
  if (!m) return undefined;
  const dur = sessionDuration();
  return {
    name: sessionName() || source.subjectId || undefined,
    task: experimentId() === 'custom' ? undefined : experiment().label,
    cells: m.cells,
    frames: m.frames,
    hz: samplingRate(),
    minutes: dur === undefined ? undefined : dur / 60,
  };
}

const NEEDS_ENGINE = 'Needs saved projects (engine)';
const NEEDS_PROJECT = 'Open or create a project first';
type Dialog = 'rename' | 'clear' | 'delete';

export function Header(): JSX.Element {
  const [dialog, setDialog] = createSignal<Dialog>();
  const projectName = () => sessionName() || 'this session';
  // Actions on the project folder need the engine and an open project.
  const needs = () => (openProject() ? undefined : projectsOn() ? NEEDS_PROJECT : NEEDS_ENGINE);
  const fail = (e: unknown) => showMessage('Project action failed', errorText(e));
  const items = (): MenuItem[] => [
    ...(openProject()?.save_mode === 'manual'
      ? ([
          {
            kind: 'action',
            label: 'Save project',
            disabled: hasUnsaved() ? undefined : 'Nothing to save',
            onSelect: () => void saveNow(),
          },
          { kind: 'separator' },
        ] as MenuItem[])
      : []),
    { kind: 'action', label: 'Rename project', onSelect: () => setDialog('rename') },
    {
      kind: 'action',
      label: 'Project settings',
      disabled: needs(),
      onSelect: () => openProjectSettings(),
    },
    {
      kind: 'action',
      label: 'Duplicate project',
      disabled: needs(),
      onSelect: () =>
        void projects
          .duplicate(openProject()!.id)
          .then(() => goToStep('library'))
          .catch(fail),
    },
    {
      kind: 'action',
      label: 'Export portable project…',
      disabled: needs(),
      onSelect: () => setExportOpen(true),
    },
    { kind: 'action', label: 'Open project library', onSelect: () => goToStep('library') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Clear session data…',
      danger: true,
      onSelect: () => setDialog('clear'),
    },
    {
      kind: 'action',
      label: 'Delete project…',
      danger: true,
      disabled: needs(),
      onSelect: () => setDialog('delete'),
    },
  ];
  const rename = (name: string) => {
    const project = openProject();
    if (project) {
      // The engine renames the folder too; the session name follows what it made of the name.
      projects
        .rename(project.id, name)
        .then((p) => {
          setOpenProject(p);
          updateAutosaveProject(p);
          setSessionName(p.name);
          setDialog(undefined);
        })
        .catch((e) => showMessage('Could not rename the project', errorText(e)));
      return;
    }
    const old = sessionName();
    if (old) renameSaved(old, name);
    setSessionName(name);
    setDialog(undefined);
  };
  return (
    <>
      <CompactHeader
        title="CaBaNA"
        version={`CaLab v${pkg.version}`}
        onBrandClick={() => goToStep('welcome')}
        info={<span class="cb-hd-line">{headerLine(facts())}</span>}
        actions={
          <Show when={!nothingLoaded()}>
            <SavedIndicator />
            <ActionsMenu
              label="Manage project"
              class="btn-secondary btn-small cb-hd-btn"
              items={items}
            />
          </Show>
        }
      />
      <Show when={dialog() === 'rename'}>
        <RenameDialog
          name={sessionName() ?? ''}
          onRename={rename}
          onClose={() => setDialog(undefined)}
        />
      </Show>
      <Show when={dialog() === 'delete' && openProject()}>
        {(p) => (
          <DeleteProjectDialog
            name={p().name}
            size={sizeText(p().size_bytes)}
            onClose={() => setDialog(undefined)}
            onConfirm={() => {
              setDialog(undefined);
              void projects
                .remove(p().id)
                .then(() => closeSession())
                .catch(fail);
            }}
          />
        )}
      </Show>
      <ProjectWindows />
      <Show when={dialog() === 'clear'}>
        <ClearSessionDialog
          name={projectName()}
          onConfirm={() => {
            setDialog(undefined);
            closeSession();
          }}
          onClose={() => setDialog(undefined)}
        />
      </Show>
    </>
  );
}
