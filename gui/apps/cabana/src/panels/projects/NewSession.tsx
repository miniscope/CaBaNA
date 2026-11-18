// New Project: pick a folder, files or an example dataset. The files are held in a list, with the
// data type each will be matched as, and load only when the user continues to Data setup.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { nothingLoaded } from '../../lib/data-setup-view.ts';
import { previewPlacements } from '../../lib/file-match.ts';
import {
  defaultProjectName,
  formatBytes,
  mergeHeld,
  pathOf,
  requiredNote,
} from '../../lib/new-project.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  clearAll,
  EXAMPLES,
  fetchExample,
  goToStep,
  loadFetchedExample,
  setSessionName,
} from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { fileList } from '../LoadPanel.tsx';
import { FolderButton } from './FolderButton.tsx';

// Kept outside the page so the list survives a visit to another page.
const [held, setHeld] = createSignal<File[]>([]);
/** The example the list came from; its picture and video load with it. */
const [example, setExample] = createSignal<{ id: string; frame?: File; video?: File }>();
const [typedName, setTypedName] = createSignal<string>();
const [loading, setLoading] = createSignal(false);
const [problem, setProblem] = createSignal<string>();
const [busy, setBusy] = createSignal(false);

const exampleLabel = () => EXAMPLES.find((x) => x.id === example()?.id)?.label;
const projectName = () => typedName() ?? exampleLabel() ?? defaultProjectName(held());
const slotLabel = (id: SlotId) => SLOTS.find((s) => s.id === id)!.label;

function clearList(): void {
  setHeld([]);
  setExample(undefined);
  setTypedName(undefined);
  setProblem(undefined);
}

/** Add picked files; picking after an example keeps the example's files and adds to them. */
const addHeld = (files: File[]) => files.length && setHeld((h) => mergeHeld(h, files));

async function chooseExample(id: string): Promise<void> {
  clearList();
  setLoading(true);
  try {
    const got = await fetchExample(id);
    if (!got.files.length) throw new Error('The example has no files.');
    setExample({ id, frame: got.frame, video: got.video });
    setHeld(got.files);
  } catch {
    setProblem('The example files could not be loaded.');
  } finally {
    setLoading(false);
  }
}

/** Load the held files as the open session, named by the project name, and open Data setup. */
async function next(): Promise<void> {
  const name = projectName().trim();
  setBusy(true);
  const ex = example();
  if (ex) await loadFetchedExample(ex.id, { files: held(), frame: ex.frame, video: ex.video });
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
      onClick={(e) => !(e.target as HTMLElement).closest('.cb-np__actions') && picker.click()}
    >
      <p class="cb-np__droptitle">
        {loading()
          ? 'Loading the example files…'
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
        <FolderButton class="btn-primary" onFiles={addHeld}>
          Choose folder
        </FolderButton>
        <label class="btn-secondary cb-file">
          Choose files
          <input type="file" hidden multiple onChange={(e) => addHeld(fileList(e))} />
        </label>
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

function FileTable(): JSX.Element {
  const [placed] = createResource(held, previewPlacements);
  const rows = () => placed() ?? held().map((file) => ({ file, slots: [] as SlotId[] }));
  const matched = () => new Set(rows().flatMap((r) => r.slots));
  const used = () => rows().filter((r) => r.slots.length).length;
  const note = () => requiredNote(matched());
  return (
    <div class="cb-proj__card">
      <div class="cb-np__head">
        <div>
          <div class="cb-np__folder">
            {example()
              ? `Example: ${exampleLabel()}`
              : (rootFolder() ?? `${held().length} files selected`)}
          </div>
          <div class="cb-muted cb-np__meta">
            {held().length} files · {formatBytes(held().reduce((n, f) => n + f.size, 0))} · {used()}{' '}
            recognized
          </div>
        </div>
        <label class="btn-secondary btn-small cb-file">
          Add files
          <input type="file" hidden multiple onChange={(e) => addHeld(fileList(e))} />
        </label>
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
        <span class="cb-muted">Not saved: engine off · work is kept in this browser</span>
      </div>
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
                  <td>{pathOf(r.file).split('/').pop()}</td>
                  <td>{r.slots.length ? r.slots.map(slotLabel).join(', ') : 'not used'}</td>
                  <td>{formatBytes(r.file.size)}</td>
                  <td>
                    <button
                      type="button"
                      class="cb-linkbtn"
                      aria-label={`Remove ${r.file.name}`}
                      onClick={() => setHeld((h) => h.filter((f) => f !== r.file))}
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
        addHeld(Array.from(e.dataTransfer?.files ?? []));
      }}
      classList={{ 'cb-load--drag': over() }}
    >
      <div class="cb-proj__title">
        <div>
          <h2>New Project</h2>
          <p class="cb-muted cb-proj__sub">
            Load your own data or an example. Files load when you continue.
          </p>
        </div>
      </div>
      <Show when={held().length} fallback={<EmptyState />}>
        <FileTable />
      </Show>
      <div class="cb-proj__foot">
        <button
          type="button"
          class="btn-primary"
          disabled={!held().length || busy()}
          onClick={() => void next()}
        >
          {busy() ? 'Loading…' : 'Next: Data setup'}
        </button>
      </div>
    </div>
  );
}
