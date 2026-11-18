// Data setup: load the files, then open each one to look at it, check it and set what applies to
// it alone. Files are matched to data types by name; dropping anywhere on the page adds them.
// The page lists one row per data type (SetupRows.tsx); a row's View opens the file in a pop-up.
// With nothing loaded the page is the Project library.

import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  appliedNote,
  entry,
  nothingLoaded,
  openEntry,
  reviewed,
  setAppliedNote,
} from '../../lib/data-setup-view.ts';
import {
  activeLabel,
  clearActiveLabel,
  reviewingConflicts,
  setReviewingConflicts,
  takeFocus,
} from '../../lib/label-view.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  clearAll,
  labelRegistry,
  loaded,
  missingRequired,
  unrecognized,
} from '../../lib/store.ts';
import { ConflictReview } from '../ConflictReview.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { ApplySettings, ExamplePicker, fileList } from '../LoadPanel.tsx';
import { fitToWindow } from '../QcPanel.tsx';
import { StatusIcon } from '../QcParts.tsx';
import { EntryPopup } from './EntryView.tsx';
import { ProjectLibrary } from './ProjectLibrary.tsx';
import { SetupRows } from './SetupRows.tsx';

const loadedIds = () =>
  SLOTS.filter((s) => loaded[s.id]?.summary && loaded[s.id]!.size).map((s) => s.id);

/** One line in small caps: files loaded and reviewed, required files missing, originals unchanged. */
function Status(): JSX.Element {
  const n = () => loadedIds().length;
  const done = () => loadedIds().filter((id) => reviewed(id)).length;
  return (
    <div class="cb-ds-strip sc" role="status">
      <span>
        {n()} {n() === 1 ? 'file' : 'files'} loaded
      </span>
      <Show when={n()}>
        <span>
          {done()} of {n()} reviewed
        </span>
      </Show>
      <Show when={missingRequired().length} fallback={<span>All required inputs loaded</span>}>
        <span class="cb-ds-tone--fail">
          Required, not loaded:{' '}
          {missingRequired()
            .map((s) => s.label)
            .join(', ')}
        </span>
      </Show>
      <Show when={unrecognized().length}>
        <span class="cb-ds-tone--warn">
          {unrecognized().length} {unrecognized().length === 1 ? 'file has' : 'files have'} no data
          type
        </span>
      </Show>
      <span>Original files unchanged</span>
    </div>
  );
}

export function DataSetupPanel(): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  // The Project library is the page until something loads, and again after Clear all.
  createEffect(
    on(
      () => loadedIds().length + unrecognized().length > 0,
      (any) => !any && openEntry('start'),
    ),
  );
  // A link from another page: open the file a label came from.
  createEffect(() => {
    const f = takeFocus('load');
    if (!f) return;
    setReviewingConflicts(false);
    const e = labelRegistry().find((x) => x.name === f.name && (!f.file || x.file === f.file));
    if (e?.slot) openEntry(e.slot as SlotId);
  });
  const missingLabel = () => {
    const f = activeLabel();
    return f?.to === 'load' && !labelRegistry().some((e) => e.name === f.name) ? f.name : undefined;
  };
  return (
    <div
      class="cb-ds"
      classList={{ 'cb-load--drag': dragging(), 'cb-ds--library': nothingLoaded() }}
      ref={root}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.target === root && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <Show when={!(nothingLoaded() && entry() === 'start')} fallback={<ProjectLibrary />}>
        {/* Title with the load actions on the right, then the status strip. */}
        <div class="cb-ds-top cb-load__bar">
          <h2>Data setup</h2>
          <InfoTip label="About Data setup">
            One row per data type, matched to your files by name. View opens a file: an overview of
            the whole file, its quality checks, and anything that applies to that file alone.
            Settings that describe the experiment are in the experimental setup and are saved to
            config.yaml. Only missing required files stop you from continuing. Files can also be
            dropped anywhere on the page.
          </InfoTip>
          <span class="cb-spacer" />
          <span class="cb-muted cb-ds-top__hint">or drop files anywhere</span>
          <label class="btn-secondary btn-small cb-file">
            Select files
            <input type="file" hidden multiple onChange={(e) => void addFiles(fileList(e))} />
          </label>
          <label class="btn-secondary btn-small cb-file">
            Select folder
            <input
              type="file"
              hidden
              multiple
              // @ts-expect-error webkitdirectory is not in the DOM typings
              webkitdirectory=""
              onChange={(e) => void addFiles(fileList(e))}
            />
          </label>
          <ExamplePicker />
          <ApplySettings onApplied={setAppliedNote} />
          <Show when={loadedIds().length || unrecognized().length}>
            <button class="btn-secondary btn-small" onClick={clearAll}>
              Clear all
            </button>
          </Show>
        </div>
        <Status />
        <Show when={appliedNote()}>
          <p class="cb-load__applied" role="status">
            <StatusIcon status="pass" /> {appliedNote()}{' '}
            <button class="cb-linkbtn" onClick={() => setAppliedNote(undefined)}>
              Dismiss
            </button>
          </p>
        </Show>
        <Show when={missingLabel()}>
          <p class="cb-warn cb-load__missing">
            Label '{missingLabel()}' is not in any loaded file. Add the time-marker, annotation or
            frame-label file that contains it.{' '}
            <button class="cb-linkbtn" onClick={clearActiveLabel}>
              Dismiss
            </button>
          </p>
        </Show>
        <Show when={reviewingConflicts()}>
          <div class="cb-load__review">
            <ConflictReview />
          </div>
        </Show>
        <Show when={!reviewingConflicts()}>
          <SetupRows />
        </Show>
      </Show>
      <EntryPopup />
    </div>
  );
}
