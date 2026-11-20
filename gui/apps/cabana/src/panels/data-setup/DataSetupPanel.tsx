// Data setup: the project's name, the folder box, any unassigned files, the Neural data and
// Behavioral data cards, and the Experiment details and Import settings cards. Files are matched to
// data types by name; dropping a folder anywhere on the page adds it (browser-only mode, or example
// data). With the engine on, files are chosen by path so the project can find them again.

import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { errorText, showMessage } from '../../lib/confirm.ts';
import {
  appliedNote,
  nothingLoaded,
  openEntry,
  setAppliedNote,
} from '../../lib/data-setup-view.ts';
import { addFolderByPath, adding, byPath } from '../../lib/data-files.ts';
import {
  activeLabel,
  clearActiveLabel,
  reviewingConflicts,
  setReviewingConflicts,
  takeFocus,
} from '../../lib/label-view.ts';
import { setFolderHelpOpen } from '../../lib/load-data-windows.ts';
import { projectsOn } from '../../lib/project-session.ts';
import { nameField, nameSaved, saveProject, setNameField } from '../../lib/save-project.ts';
import { isExample } from '../../lib/example-session.ts';
import type { SlotId } from '../../lib/slots.ts';
import { dataFiles } from '../../lib/open-project.ts';
import { addFiles, folderInfo, labelRegistry, sessionName, unrecognized } from '../../lib/store.ts';
import { HelpMark } from '../../components/HelpMark.tsx';
import { ConflictReview } from '../ConflictReview.tsx';
import { fileList } from '../file-input.ts';
import { fitToWindow } from '../QcPanel.tsx';
import { StatusIcon } from '../QcParts.tsx';
import { DetailsCard, ImportCard } from './BottomCards.tsx';
import { DataCards } from './DataCards.tsx';
import { SetupPopups } from './SetupPopups.tsx';
import { Unassigned } from './Unassigned.tsx';

/** A problem with the last drop or folder, shown above the cards until dismissed. */
const [dropProblem, setDropProblem] = createSignal<string>();

/** Select folder: the engine's dialog, or the browser's folder chooser. */
function SelectFolder(props: { label: string; class: string }): JSX.Element {
  let input!: HTMLInputElement;
  const choose = () => {
    setDropProblem(undefined);
    if (!byPath()) return input.click();
    void addFolderByPath().catch((e) =>
      showMessage('Adding the folder did not work', errorText(e)),
    );
  };
  return (
    <>
      <button type="button" class={props.class} disabled={!!adding()} onClick={choose}>
        {props.label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        onChange={(e) => void addFiles(fileList(e))}
      />
    </>
  );
}

const FolderInfoButton = () => (
  <button
    type="button"
    class="cb-tip__btn"
    aria-label="Organizing your data folder"
    title="Organizing your data folder"
    onClick={() => setFolderHelpOpen(true)}
  >
    <HelpMark />
  </button>
);

/** The folder of the open project's data files, when they share one. */
const projectFolder = () => {
  const dirs = new Set(dataFiles().map((f) => f.path.split(/[\\/]/).slice(-2, -1)[0]));
  return dirs.size === 1 ? [...dirs][0] : undefined;
};

/** Empty: a large drop box. Once files are added: one slim line with the folder and its counts. */
function FolderBox(): JSX.Element {
  const label = () => folderInfo()?.name ?? projectFolder();
  const counts = () => {
    const f = folderInfo();
    return f && unrecognized().length
      ? `${f.total} files: ${f.identified} identified, ${f.unassigned} not identified, ${f.ignored} ignored`
      : undefined;
  };
  return (
    <Show
      when={!nothingLoaded()}
      fallback={
        <>
          <div class="cb-ld-folder">
            <p class="cb-ld-folder__title">
              Drag and drop the folder that contains your neural and behavioral data here
              <FolderInfoButton />
            </p>
            <p class="cb-ld-folder__sub">
              CaBaNA will try to identify each file and assign it to a data type below. You can
              change any assignment.
            </p>
            <SelectFolder label="Select folder" class="btn-secondary" />
            <Show when={adding()}>
              <span class="cb-muted cb-ld-folder__count" role="status">
                {adding()}
              </span>
            </Show>
          </div>
          <div class="cb-ld-or">or select files one at a time below</div>
        </>
      }
    >
      <div class="cb-ld-folder cb-ld-folder--slim">
        <p class="cb-ld-folder__title">
          <Show
            when={label()}
            fallback={
              isExample()
                ? `Example data: ${sessionName() ?? ''}`
                : dataFiles().length
                  ? 'The files are in several folders'
                  : 'Add a folder to fill the data types below'
            }
          >
            <span>
              Folder: <span class="cb-sp-mono">{label()}/</span>
            </span>
          </Show>
          <FolderInfoButton />
        </p>
        <Show when={adding() ?? counts()}>
          <span class="cb-muted cb-ld-folder__count" role="status">
            {adding() ?? counts()}
          </span>
        </Show>
        <SelectFolder
          label={label() ? 'Select another folder' : 'Select folder'}
          class="btn-secondary btn-small"
        />
      </div>
    </Show>
  );
}

function TitleRow(): JSX.Element {
  const saveReason = () =>
    nothingLoaded()
      ? 'Add data files first'
      : !projectsOn()
        ? 'Start the Python engine to save a project'
        : undefined;
  return (
    <div class="cb-sp-top">
      <h2>Data setup</h2>
      <span class="cb-ld-name">
        <label for="cb-project-name">Project name</label>
        <input
          id="cb-project-name"
          type="text"
          placeholder="Name this project"
          value={nameField()}
          onInput={(e) => setNameField(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saveReason() && saveProject(false)}
        />
      </span>
      <button
        type="button"
        class="btn-secondary btn-small"
        disabled={!!saveReason()}
        title={saveReason()}
        onClick={() => saveProject(false)}
      >
        Save project
      </button>
      <span class="cb-ld-status cb-muted">{nameSaved() ? 'Saved' : ''}</span>
    </div>
  );
}

export function DataSetupPanel(): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  // A link from another page: open the file a label came from.
  createEffect(() => {
    const f = takeFocus('load');
    if (!f) return;
    setReviewingConflicts(false);
    const e = labelRegistry().find((x) => x.name === f.name && (!f.file || x.file === f.file));
    if (e?.slot) openEntry(e.slot as SlotId, 'overview');
  });
  const missingLabel = () => {
    const f = activeLabel();
    return f?.to === 'load' && !labelRegistry().some((e) => e.name === f.name) ? f.name : undefined;
  };
  const drop = (files: File[]) => {
    setDropProblem(undefined);
    // A project keeps files by path; a dropped file has none.
    if (projectsOn() && !isExample())
      return setDropProblem('Dropped files have no folder path. Use Select folder.');
    void addFiles(files);
  };
  return (
    <div
      class="cb-sp"
      classList={{ 'cb-load--drag': dragging() }}
      ref={root}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.target === root && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        drop(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <TitleRow />
      <Show when={appliedNote()}>
        <div class="cb-ld-note" role="status">
          <StatusIcon status="pass" />
          <span>{appliedNote()}</span>
          <span class="cb-spacer" />
          <button
            type="button"
            class="btn-secondary btn-small"
            onClick={() => setAppliedNote(undefined)}
          >
            Dismiss
          </button>
        </div>
      </Show>
      <Show when={dropProblem() || missingLabel()}>
        <div class="cb-ld-note cb-warn" role="alert">
          <span>
            {dropProblem() ??
              `Label '${missingLabel()}' is not in any loaded file. Add the time-marker, annotation or frame-label file that contains it.`}
          </span>
          <span class="cb-spacer" />
          <button
            type="button"
            class="btn-secondary btn-small"
            onClick={() => (dropProblem() ? setDropProblem(undefined) : clearActiveLabel())}
          >
            Dismiss
          </button>
        </div>
      </Show>
      <Show
        when={!reviewingConflicts()}
        fallback={
          <div class="cb-load__review">
            <ConflictReview />
          </div>
        }
      >
        <FolderBox />
        <Show when={unrecognized().length}>
          <Unassigned />
        </Show>
        <DataCards />
        <div class="cb-ld-grid cb-ld-grid--meta">
          <DetailsCard />
          <ImportCard />
        </div>
      </Show>
      <SetupPopups onApplied={setAppliedNote} />
    </div>
  );
}
