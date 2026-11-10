// Data setup: load the files, then open each one to look at it, check it and set what applies to
// it alone. Files are matched to data types by name; dropping anywhere on the page adds them.

import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { openEntry, reviewed } from '../../lib/data-setup-view.ts';
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

function Status(): JSX.Element {
  const n = () => loadedIds().length;
  const done = () => loadedIds().filter((id) => reviewed(id)).length;
  return (
    <div class="cb-ds-status">
      <Show when={n()} fallback={<span class="cb-muted">No files loaded</span>}>
        <span>
          {n()} {n() === 1 ? 'file' : 'files'} loaded
        </span>
        <span class="cb-muted">
          {done()} of {n()} reviewed
        </span>
      </Show>
    </div>
  );
}

export function DataSetupPanel(): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [applied, setApplied] = createSignal<string>();
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  createEffect(on(sessionName, () => setApplied(undefined), { defer: true }));
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
      <div class="cb-ds-top">
        <h2>Data setup</h2>
        <InfoTip label="About Data setup">
          Load your files, then open each one on the left: an overview of the whole file, its
          quality checks, and anything that applies to that file alone. Settings that describe the
          experiment are in Experiment config and are saved to config.yaml. Only missing required
          files stop you from continuing.
        </InfoTip>
        <span class="cb-spacer" />
        <Status />
      </div>
      <div class="cb-load__bar">
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
        <span class="cb-muted">or drop files anywhere · matched to a data type by name</span>
        <span class="cb-spacer" />
        <Show when={loadedIds().length || unrecognized().length}>
          <button class="btn-secondary btn-small" onClick={clearAll}>
            Clear all
          </button>
        </Show>
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
      <div class="cb-gs-foot">
        <span class="cb-gs-foot__text">
          <span>
            {loadedIds().length} {loadedIds().length === 1 ? 'file' : 'files'} loaded
          </span>
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
            <button class="cb-linkbtn" onClick={() => openEntry(`file:${unrecognized()[0].name}`)}>
              {unrecognized().length} {unrecognized().length === 1 ? 'file has' : 'files have'} no
              data type
            </button>
          </Show>
        </span>
      </div>
    </div>
  );
}
