// Data setup: the experimental summary, the Neural data and Behavior data cards, and any files no
// data type matched. Files are matched to data types by name; dropping anywhere on the page adds
// them. A row's Actions open the file in a look-only pop-up (ViewData.tsx); the experimental
// setup is a pop-up too (ExperimentalSetup.tsx).

import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { appliedNote, openEntry, setAppliedNote } from '../../lib/data-setup-view.ts';
import {
  activeLabel,
  clearActiveLabel,
  reviewingConflicts,
  setReviewingConflicts,
  takeFocus,
} from '../../lib/label-view.ts';
import type { SlotId } from '../../lib/slots.ts';
import { addFiles, labelRegistry, unrecognized } from '../../lib/store.ts';
import { ConflictReview } from '../ConflictReview.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { fileList } from '../LoadPanel.tsx';
import { fitToWindow } from '../QcPanel.tsx';
import { StatusIcon } from '../QcParts.tsx';
import { OtherFiles } from './OtherFiles.tsx';
import { DataCards, SummaryCard } from './SetupRows.tsx';
import { SetupPopups } from './SetupPopups.tsx';

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
        void addFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <div class="cb-sp-top">
        <h2>Data setup</h2>
        <InfoTip label="About Data setup">
          Load the files of this session. Each is matched to a data type by name; Actions opens a
          file to look at it and its quality checks, replaces it or removes it. Experiment details,
          such as the arena and frame rates, are in the experimental setup. Only missing required
          files stop you from continuing. Files can also be dropped anywhere on the page.
        </InfoTip>
        <span class="cb-spacer" />
        <label class="btn-secondary cb-file">
          Add files
          <input type="file" hidden multiple onChange={(e) => void addFiles(fileList(e))} />
        </label>
      </div>
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
      <Show
        when={!reviewingConflicts()}
        fallback={
          <div class="cb-load__review">
            <ConflictReview />
          </div>
        }
      >
        <SummaryCard />
        <DataCards />
        <Show when={unrecognized().length}>
          <OtherFiles />
        </Show>
      </Show>
      <SetupPopups onApplied={setAppliedNote} />
    </div>
  );
}
