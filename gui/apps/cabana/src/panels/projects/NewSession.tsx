// New Project: pick a folder, files or an example dataset. The files are held in a list, with the
// data type each will be matched as, and load only when the user continues to Data setup.

import { createResource, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { guardExample, startExample } from '../../lib/example-session.ts';
import { nothingLoaded } from '../../lib/data-setup-view.ts';
import { placeFiles, previewPlacements } from '../../lib/file-match.ts';
import {
  defaultNameFromPaths,
  defaultProjectName,
  formatBytes,
  mergeHeld,
  pathOf,
  requiredNote,
} from '../../lib/new-project.ts';
import {
  createFromFiles,
  library,
  projectsOn,
  refreshLibrary,
  tidyPath,
} from '../../lib/project-session.ts';
import { chosenPaths, projects, type ScannedFile } from '../../lib/projects-client.ts';
import { matchSlot, SLOTS, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  clearAll,
  EXAMPLES,
  fetchExample,
  goToStep,
  setSessionName,
} from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { fileList } from '../file-input.ts';
import { FolderButton } from './FolderButton.tsx';

// Kept outside the page so the list survives a visit to another page.
const [held, setHeld] = createSignal<File[]>([]);
/** The example the list came from; its picture and video load with it. */
const [example, setExample] = createSignal<{ id: string; frame?: File; video?: File }>();
/** Files chosen through the engine's dialog (a project keeps them by path, so a path is needed). */
const [scanned, setScanned] = createSignal<ScannedFile[]>([]);
/** The folder to make the project in, when changed from the projects folder. */
const [parentDir, setParentDir] = createSignal<string>();
const [typedName, setTypedName] = createSignal<string>();
const [loading, setLoading] = createSignal(false);
const [problem, setProblem] = createSignal<string>();
const [busy, setBusy] = createSignal(false);

const exampleLabel = () => EXAMPLES.find((x) => x.id === example()?.id)?.label;
const projectName = () =>
  typedName() ??
  exampleLabel() ??
  (scanned().length
    ? defaultNameFromPaths(scanned().map((f) => f.path))
    : defaultProjectName(held()));
const slotLabel = (id: SlotId) => SLOTS.find((s) => s.id === id)!.label;

function clearList(): void {
  setHeld([]);
  setScanned([]);
  setExample(undefined);
  setTypedName(undefined);
  setProblem(undefined);
}

/** Add picked files; picking after an example keeps the example's files and adds to them. */
const addHeld = (files: File[]) => files.length && setHeld((h) => mergeHeld(h, files));

/** Add files the engine scanned; a path chosen again replaces the earlier entry. */
const addScanned = (files: ScannedFile[]) =>
  files.length &&
  setScanned((list) => [...list.filter((f) => !files.some((n) => n.path === f.path)), ...files]);

/** Ask for a folder or files with the engine's dialog and list what they hold. */
async function chooseWithDialog(kind: 'folder' | 'files'): Promise<void> {
  setProblem(undefined);
  try {
    const paths = chosenPaths(
      await projects.dialog(kind, {
        title: kind === 'folder' ? 'Choose a session folder' : 'Choose data files',
      }),
    );
    if (paths) addScanned((await projects.scan(paths)).files);
  } catch (e) {
    setProblem(e instanceof Error ? e.message : 'The file dialog could not be opened.');
  }
}

/** Where the project folder goes: the projects folder unless another was chosen. */
const saveParent = () => parentDir() ?? library()?.root;

async function changeParent(): Promise<void> {
  try {
    const paths = chosenPaths(await projects.dialog('folder', { title: 'Save the project in' }));
    if (paths) setParentDir(paths[0]);
  } catch (e) {
    setProblem(e instanceof Error ? e.message : 'The folder dialog could not be opened.');
  }
}

async function chooseExample(id: string): Promise<void> {
  clearList();
  setLoading(true);
  try {
    const got = await fetchExample(id);
    if (!got.files.length) {
      setProblem(
        `The files of this example are not in this copy of CaBaNA (example_data/${id}/ is missing or empty).`,
      );
      return;
    }
    setExample({ id, frame: got.frame, video: got.video });
    setHeld(got.files);
  } catch {
    setProblem('The example files could not be loaded.');
  } finally {
    setLoading(false);
  }
}

/** Load the held files as the open session, named by the project name, and open Data setup. */
function next(): void {
  guardExample(() => void load());
}

async function load(): Promise<void> {
  const name = projectName().trim();
  setBusy(true);
  if (scanned().length) {
    try {
      await createFromFiles(
        name || `Project ${new Date().toISOString().slice(0, 10)}`,
        parentDir(),
        scanned()
          .map((f) => ({ path: f.path, slots: slotsOfScanned(f) }))
          .filter((f) => f.slots.length),
      );
      clearList();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The project could not be created.');
    }
    setBusy(false);
    return;
  }
  const ex = example();
  if (ex) await startExample(ex.id, { files: held(), frame: ex.frame, video: ex.video });
  else {
    // A new project replaces the open session rather than mixing with it.
    if (!nothingLoaded()) clearAll();
    await addFiles(held());
  }
  if (name) setSessionName(name);
  clearList();
  setBusy(false);
  goToStep('data');
}

/** The data types a scanned file fills, by its name; a config.yaml goes to the config slot. */
function slotsOfScanned(f: ScannedFile): SlotId[] {
  if (/\.ya?ml$/i.test(f.name)) return matchSlot(f.name) === 'config' ? ['config'] : [];
  return placeFiles([f], undefined, {})[0].slots;
}

/** The folder every held file was picked in, when there is one. */
const rootFolder = () => {
  const roots = new Set(held().map((f) => pathOf(f).split('/')[0]));
  return roots.size === 1 && pathOf(held()[0]).includes('/') ? [...roots][0] : undefined;
};

function EmptyState(): JSX.Element {
  let picker!: HTMLInputElement;
  return (
    <div
      class="cb-np__drop"
      onClick={(e) =>
        !(e.target as HTMLElement).closest('.cb-np__actions') &&
        (projectsOn() ? void chooseWithDialog('files') : picker.click())
      }
    >
      <p class="cb-np__droptitle">
        {loading()
          ? 'Loading the example files…'
          : projectsOn()
            ? 'Choose a session folder or files'
            : 'Drop a session folder or files here, or click to browse'}
      </p>
      <p class="cb-muted cb-np__dropnote">
        Files are matched by name: timestamps, traces, footprints, position, annotations,
        config.yaml
      </p>
      <Show when={problem()}>
        <p class="cb-warn">{problem()}</p>
      </Show>
      <div class="cb-np__actions">
        <Show
          when={projectsOn()}
          fallback={
            <>
              <FolderButton class="btn-primary" onFiles={addHeld}>
                Choose folder
              </FolderButton>
              <label class="btn-secondary cb-file">
                Choose files
                <input type="file" hidden multiple onChange={(e) => addHeld(fileList(e))} />
              </label>
            </>
          }
        >
          <button type="button" class="btn-primary" onClick={() => void chooseWithDialog('folder')}>
            Choose folder
          </button>
          <button
            type="button"
            class="btn-secondary"
            onClick={() => void chooseWithDialog('files')}
          >
            Choose files
          </button>
        </Show>
        <ExampleMenu />
      </div>
      <input ref={picker} type="file" hidden multiple onChange={(e) => addHeld(fileList(e))} />
    </div>
  );
}

function ExampleMenu(): JSX.Element {
  return (
    <ActionsMenu
      label="Use example data"
      class="btn-secondary"
      items={EXAMPLES.map((x) => ({
        kind: 'action' as const,
        label: x.label,
        sub: x.brief,
        onSelect: () => void chooseExample(x.id),
      }))}
    />
  );
}

/** One line of the list, from a browser file or a file the engine scanned. */
interface Row {
  key: string;
  name: string;
  size: number;
  slots: SlotId[];
  remove: () => void;
}

function FileTable(): JSX.Element {
  const [placed] = createResource(held, previewPlacements);
  const rows = (): Row[] =>
    scanned().length
      ? scanned().map((f) => ({
          key: f.path,
          name: f.name,
          size: f.size,
          slots: slotsOfScanned(f),
          remove: () => setScanned((l) => l.filter((x) => x !== f)),
        }))
      : (placed() ?? held().map((file) => ({ file, slots: [] as SlotId[] }))).map((r) => ({
          key: pathOf(r.file),
          name: pathOf(r.file).split('/').pop()!,
          size: r.file.size,
          slots: r.slots,
          remove: () => setHeld((h) => h.filter((f) => f !== r.file)),
        }));
  const count = () => scanned().length || held().length;
  const matched = () => new Set(rows().flatMap((r) => r.slots));
  const used = () => rows().filter((r) => r.slots.length).length;
  const note = () => requiredNote(matched());
  const heading = () =>
    example()
      ? `Example: ${exampleLabel()}`
      : scanned().length
        ? (scanned()[0].path.split('/').slice(-2, -1)[0] ?? `${count()} files selected`)
        : (rootFolder() ?? `${count()} files selected`);
  return (
    <div class="cb-proj__card">
      <div class="cb-np__head">
        <div>
          <div class="cb-np__folder">{heading()}</div>
          <div class="cb-muted cb-np__meta">
            {count()} files · {formatBytes(rows().reduce((n, r) => n + r.size, 0))} · {used()}{' '}
            recognized
          </div>
        </div>
        <Show
          when={scanned().length}
          fallback={
            <label class="btn-secondary btn-small cb-file">
              Add files
              <input type="file" hidden multiple onChange={(e) => addHeld(fileList(e))} />
            </label>
          }
        >
          <button
            type="button"
            class="btn-secondary btn-small"
            onClick={() => void chooseWithDialog('files')}
          >
            Add files
          </button>
        </Show>
        <button type="button" class="btn-secondary btn-small" onClick={clearList}>
          Clear all
        </button>
      </div>
      <label class="cb-np__row">
        <span>Project name</span>
        <input
          type="text"
          value={projectName()}
          onInput={(e) => setTypedName(e.currentTarget.value)}
        />
      </label>
      <div class="cb-np__row">
        <span>Saved to</span>
        <Show
          when={scanned().length}
          fallback={
            <span class="cb-muted">
              {!projectsOn()
                ? 'Not saved: engine off · work is kept in this browser'
                : example()
                  ? 'Example data · Unsaved. Manage project → Save as project… keeps it as a project'
                  : 'Not saved: files chosen this way have no location on disk. Use Choose folder or Choose files.'}
            </span>
          }
        >
          <span class="cb-np__where">
            <span class="cb-np__path">
              {tidyPath(saveParent() ?? '~/CaBaNA Projects')}/{projectName()}/
            </span>
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => void changeParent()}
            >
              Change…
            </button>
          </span>
        </Show>
      </div>
      <Show when={problem()}>
        <p class="cb-warn cb-np__problem">{problem()}</p>
      </Show>
      <div class="cb-np__table">
        <table>
          <thead>
            <tr>
              <th>File name</th>
              <th>Matched as</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(r) => (
                <tr classList={{ 'cb-np__unused': !r.slots.length }}>
                  <td>{r.name}</td>
                  <td>{r.slots.length ? r.slots.map(slotLabel).join(', ') : 'not used'}</td>
                  <td>{formatBytes(r.size)}</td>
                  <td>
                    <button
                      type="button"
                      class="cb-linkbtn"
                      aria-label={`Remove ${r.name}`}
                      onClick={r.remove}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <div class="cb-np__note">
        <InfoTip label="About the required files">
          Required files stop the analyses until they are loaded. Everything else can be added later
          in Data setup.
        </InfoTip>
        <span class="cb-muted">
          <Show
            when={!note().ok}
            fallback={
              <>Both required files are here. Add the remaining files now or later in Data setup.</>
            }
          >
            Required, missing: <span class="cb-np__missing">{note().missing.join(', ')}</span>. Add
            the remaining files now or later in Data setup.
          </Show>
        </span>
      </div>
    </div>
  );
}

export function NewSession(): JSX.Element {
  const [over, setOver] = createSignal(false);
  // The projects folder, for the "Saved to" line.
  onMount(() => projectsOn() && !library() && void refreshLibrary());
  return (
    <div
      class="cb-proj"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // A project keeps files by path; a dropped file has none, so it goes through the dialog.
        if (projectsOn() && !example())
          setProblem('Dropped files have no folder path. Use Choose folder or Choose files.');
        else addHeld(Array.from(e.dataTransfer?.files ?? []));
      }}
      classList={{ 'cb-load--drag': over() }}
    >
      <div class="cb-proj__title">
        <div>
          <h2>New Project</h2>
          <p class="cb-muted cb-proj__sub">
            {projectsOn()
              ? 'Load your own data or an example. The project is saved to ~/CaBaNA Projects/<project name>/.'
              : 'Load your own data or an example. The work is kept in this browser.'}
          </p>
        </div>
      </div>
      <Show when={held().length || scanned().length} fallback={<EmptyState />}>
        <FileTable />
      </Show>
      <div class="cb-proj__foot">
        <button
          type="button"
          class="btn-primary"
          disabled={!(held().length || scanned().length) || busy()}
          onClick={next}
        >
          {busy() ? 'Loading…' : 'Next: Data setup'}
        </button>
      </div>
    </div>
  );
}
