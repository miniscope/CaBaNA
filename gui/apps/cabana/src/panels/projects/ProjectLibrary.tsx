// Project Library: the sessions whose settings this browser kept, newest first. Saved projects on
// disk replace this list when the engine can list them. Opening one asks for its folder again,
// loads it and applies the settings saved for it.

import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { setAppliedNote } from '../../lib/data-setup-view.ts';
import { formatBytes } from '../../lib/new-project.ts';
import { savedWhen, recentSessions, type RecentSession } from '../../lib/project-library.ts';
import {
  chooseFilePath,
  library,
  libraryError,
  openExisting,
  openFromPath,
  projectsOn,
  refreshLibrary,
} from '../../lib/project-session.ts';
import { projects, type ProjectSummary } from '../../lib/projects-client.ts';
import { applySettings, savedDatasets, TEMPLATE_GROUPS } from '../../lib/settings-template.ts';
import { addFiles, goToStep } from '../../lib/store.ts';
import { fileList } from '../LoadPanel.tsx';
import { FolderButton } from './FolderButton.tsx';
import { DeleteProjectDialog, RenameDialog } from './ProjectDialogs.tsx';

const NEEDS_ENGINE = 'Needs saved projects (engine)';

/** Load the session's folder again, then apply every group of the settings saved for it. */
async function reopen(r: RecentSession, files: File[]): Promise<void> {
  if (!files.length) return;
  // Held before loading: loading saves the new session's settings under its folder name.
  const saved = r.saved;
  await addFiles(files);
  applySettings(
    saved.settings,
    TEMPLATE_GROUPS.map((g) => g.id),
  );
  setAppliedNote(
    `Applied the settings saved for ${saved.name}: ${TEMPLATE_GROUPS.map((g) => g.label.toLowerCase()).join(', ')}.`,
  );
  goToStep('data');
}

/** A folder that is not in the list: load it like a new project, without saved settings. */
async function openFolder(files: File[]): Promise<void> {
  if (!files.length) return;
  await addFiles(files);
  goToStep('data');
}

const KIND_WORD = { neural: 'neural', position: 'position', behavior: 'behavior' } as const;

/** Projects on disk, listed by the engine: open, rename, duplicate, show in Finder, delete. */
function DiskLibrary(props: { query: string }): JSX.Element {
  const [renaming, setRenaming] = createSignal<ProjectSummary>();
  const [deleting, setDeleting] = createSignal<ProjectSummary>();
  const [problem, setProblem] = createSignal<string>();
  onMount(() => void refreshLibrary());
  const rows = () => {
    const q = props.query.trim().toLowerCase();
    return (library()?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
  };
  // One place for the engine's errors (a run in progress, a name already taken, a missing folder).
  const attempt = async (what: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await what();
      await refreshLibrary();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const open = (p: ProjectSummary) => attempt(() => openExisting({ id: p.id }));
  const items = (p: ProjectSummary) =>
    [
      { kind: 'action', label: 'Open', onSelect: () => void open(p) },
      { kind: 'action', label: 'Rename', onSelect: () => setRenaming(p) },
      {
        kind: 'action',
        label: 'Duplicate',
        onSelect: () => void attempt(() => projects.duplicate(p.id)),
      },
      {
        kind: 'action',
        label: 'Show in Finder',
        onSelect: () => void attempt(() => projects.reveal(p.id)),
      },
      { kind: 'separator' },
      { kind: 'action', label: 'Delete project…', danger: true, onSelect: () => setDeleting(p) },
    ] as const;
  return (
    <>
      <Show when={problem() || libraryError()}>
        <p class="cb-warn">{problem() ?? libraryError()}</p>
      </Show>
      <div class="cb-proj__card cb-pl__table">
        <Show
          when={rows().length}
          fallback={
            <p class="cb-muted cb-pl__empty">
              {props.query.trim()
                ? 'No project matches the search.'
                : 'No projects yet. Use + New Project in the sidebar to start one.'}
            </p>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Last opened</th>
                <th>Files</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(p) => (
                  <tr
                    class="cb-pl__row"
                    classList={{ 'cb-pl__row--off': !p.readable }}
                    onClick={() => void open(p)}
                  >
                    <td>
                      <div class="cb-pl__name">{p.name}</div>
                      <div class="cb-muted cb-pl__kinds">
                        {p.readable
                          ? p.kinds.map((k) => KIND_WORD[k]).join(', ') || 'No data files yet'
                          : 'Folder not readable'}
                        <Show when={p.missing_count}>
                          {' · '}
                          <span class="cb-pl__missing">
                            {p.missing_count} {p.missing_count === 1 ? 'file' : 'files'} missing
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td>{savedWhen(p.modified)}</td>
                    <td>{p.file_count} files</td>
                    <td>{formatBytes(p.size_bytes)}</td>
                    <td class="cb-pl__act" onClick={(e) => e.stopPropagation()}>
                      <ActionsMenu class="btn-secondary btn-small" items={[...items(p)]} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
      <Show when={renaming()}>
        {(p) => (
          <RenameDialog
            name={p().name}
            onClose={() => setRenaming(undefined)}
            onRename={(name) => {
              setRenaming(undefined);
              void attempt(() => projects.rename(p().id, name));
            }}
          />
        )}
      </Show>
      <Show when={deleting()}>
        {(p) => (
          <DeleteProjectDialog
            name={p().name}
            size={formatBytes(p().size_bytes)}
            onClose={() => setDeleting(undefined)}
            onConfirm={() => {
              setDeleting(undefined);
              void attempt(() => projects.remove(p().id));
            }}
          />
        )}
      </Show>
    </>
  );
}

/** A project folder, project.yaml or .cabana.zip chosen with the engine's dialog. */
async function openFromDialog(): Promise<string | undefined> {
  try {
    const path = await chooseFilePath('Open a project folder, project.yaml or .cabana.zip');
    if (path) await openFromPath(path);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function ProjectLibrary(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [openProblem, setOpenProblem] = createSignal<string>();
  const [opening, setOpening] = createSignal<RecentSession>();
  let picker!: HTMLInputElement;
  const rows = () => {
    const q = query().trim().toLowerCase();
    return recentSessions(savedDatasets()).filter((r) => r.name.toLowerCase().includes(q));
  };
  const open = (r: RecentSession) => {
    setOpening(r);
    picker.click();
  };
  const disabled = (label: string) => ({
    kind: 'action' as const,
    label,
    disabled: NEEDS_ENGINE,
    onSelect: () => {},
  });
  return (
    <div class="cb-proj">
      <div class="cb-proj__title">
        <div>
          <h2>Project Library</h2>
          <p class="cb-muted cb-proj__sub">
            {projectsOn()
              ? 'Open a recent project to continue your work.'
              : 'Open a recent project to continue your work. Choose its folder again to load it.'}
          </p>
        </div>
        <span class="cb-spacer" />
        <Show
          when={projectsOn()}
          fallback={
            <FolderButton class="btn-secondary" onFiles={(f) => void openFolder(f)}>
              Open from file…
            </FolderButton>
          }
        >
          <button
            type="button"
            class="btn-secondary"
            title="A project folder, a project.yaml or a .cabana.zip that is not in the list"
            onClick={() => void openFromDialog().then(setOpenProblem)}
          >
            Open from file…
          </button>
        </Show>
        <input
          type="search"
          class="cb-proj__search"
          placeholder="Search projects"
          aria-label="Search projects"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        onChange={(e) => {
          const r = opening();
          const files = fileList(e);
          if (r) void reopen(r, files);
        }}
      />
      <Show when={openProblem()}>
        <p class="cb-warn">{openProblem()}</p>
      </Show>
      <Show when={!projectsOn()} fallback={<DiskLibrary query={query()} />}>
        <div class="cb-proj__card cb-pl__table">
          <Show
            when={rows().length}
            fallback={
              <p class="cb-muted cb-pl__empty">
                {query().trim()
                  ? 'No project matches the search.'
                  : 'No projects opened in this browser yet. Use + New Project in the sidebar to start one.'}
              </p>
            }
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last opened</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <tr class="cb-pl__row" onClick={() => open(r)}>
                      <td>
                        <div class="cb-pl__name">{r.name}</div>
                        <div class="cb-muted cb-pl__kinds">
                          {r.task ?? 'Experiment type not set'}
                        </div>
                      </td>
                      <td>{r.when}</td>
                      <td>—</td>
                      <td>—</td>
                      <td class="cb-pl__act" onClick={(e) => e.stopPropagation()}>
                        <ActionsMenu
                          class="btn-secondary btn-small"
                          items={[
                            { kind: 'action', label: 'Open', onSelect: () => open(r) },
                            disabled('Rename'),
                            disabled('Duplicate'),
                            disabled('Show in Finder'),
                            { kind: 'separator' },
                            { ...disabled('Delete project…'), danger: true },
                          ]}
                        />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </div>
      </Show>
    </div>
  );
}
