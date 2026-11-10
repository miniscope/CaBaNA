// Data setup: load the files, then open each one to look at it, check it and set what applies to
// it alone. Files are matched to data types by name; dropping anywhere on the page adds them.

import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { entry, openEntry, reviewed } from '../../lib/data-setup-view.ts';
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
  sessionName,
  unrecognized,
} from '../../lib/store.ts';
import { ConflictReview } from '../ConflictReview.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { ApplySettings, ExamplePicker, fileList } from '../LoadPanel.tsx';
import { fitToWindow } from '../QcPanel.tsx';
import { StatusIcon } from '../QcParts.tsx';
import { EntryView } from './EntryView.tsx';
import { FileList } from './FileList.tsx';

const loadedIds = () =>
  SLOTS.filter((s) => loaded[s.id]?.summary && loaded[s.id]!.size).map((s) => s.id);

/** Files loaded and reviewed, required files missing, and files with no data type. */
function Status(): JSX.Element {
  const n = () => loadedIds().length;
  const done = () => loadedIds().filter((id) => reviewed(id)).length;
  return (
    <div class="cb-ds-status" role="status">
      <span>
        <Show when={n()} fallback={<span class="cb-muted">No files loaded</span>}>
          {n()} {n() === 1 ? 'file' : 'files'} loaded{' '}
          <span class="cb-muted">
            · {done()} of {n()} reviewed
          </span>
        </Show>
      </span>
      <span>
        <Show
          when={missingRequired().length}
          fallback={<span class="cb-muted">No required files missing</span>}
        >
          <span class="cb-warn">
            Required, not loaded:{' '}
            {missingRequired()
              .map((s) => s.label)
              .join(', ')}
          </span>
        </Show>
        <Show when={unrecognized().length}>
          {' · '}
          <button class="cb-linkbtn" onClick={() => openEntry(`file:${unrecognized()[0].name}`)}>
            {unrecognized().length} {unrecognized().length === 1 ? 'file has' : 'files have'} no
            data type
          </button>
        </Show>
      </span>
    </div>
  );
}

export function DataSetupPanel(): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [applied, setApplied] = createSignal<string>();
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  createEffect(on(sessionName, () => setApplied(undefined), { defer: true }));
  // Get started is the page until something loads, and again after Clear all.
  createEffect(
    on(
      () => loadedIds().length + unrecognized().length > 0,
      (any) => {
        if (any && entry() === 'start') openEntry('config');
        if (!any) openEntry('start');
      },
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
        void addFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      {/* Title, load toolbar and status share one row. */}
      <div class="cb-ds-top cb-load__bar">
        <h2>Data setup</h2>
        <InfoTip label="About Data setup">
          Load your files, then open each one on the left: an overview of the whole file, its
          quality checks, and anything that applies to that file alone. Settings that describe the
          experiment are in Experiment config and are saved to config.yaml. Only missing required
          files stop you from continuing. Files can also be dropped anywhere on the page; each is
          matched to a data type by its name.
        </InfoTip>
        <label class="btn-primary btn-small cb-file">
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
        <ApplySettings onApplied={setApplied} />
        <span class="cb-muted cb-ds-top__hint">or drop files anywhere</span>
        <Show when={loadedIds().length || unrecognized().length}>
          <button class="btn-secondary btn-small" onClick={clearAll}>
            Clear all
          </button>
        </Show>
        <span class="cb-spacer" />
        <Status />
      </div>
      <Show when={applied()}>
        <p class="cb-load__applied" role="status">
          <StatusIcon status="pass" /> {applied()}{' '}
          <button class="cb-linkbtn" onClick={() => setApplied(undefined)}>
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
      <div
        class="cb-gs-body cb-ds-body-grid"
        style={{ display: reviewingConflicts() ? 'none' : undefined }}
      >
        <FileList />
        <EntryView />
      </div>
    </div>
  );
}
