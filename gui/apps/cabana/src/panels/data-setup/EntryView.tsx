// The open entry of the Data setup page, in a pop-up over the page: a loaded file with its steps
// (Overview, QC, ...), an empty slot to load, the experimental setup, the timestamp alignment
// check, or an unassigned file. A file's steps are those of StepWizard. Under the title, a loaded
// file has a bar with the plots/table switch, its name and shape, Replace file and Remove. The
// three neural activity files share one pop-up with a tab each.

import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { NEURAL_LAYERS } from '../../lib/analysis-data.ts';
import {
  closeEntry,
  entry,
  openEntry,
  openSection,
  popupOpen,
  sectionOf,
  setView,
  viewOf,
} from '../../lib/data-setup-view.ts';
import { sectionsFor, type SectionId } from '../../lib/file-sections.ts';
import { ACTIVITY_SLOTS, isActivity, LEVEL_WORD } from '../../lib/setup-rows.ts';
import { SLOTS, type Slot, type SlotId } from '../../lib/slots.ts';
import { addFiles, levelOf, loaded, removeFile, unrecognized } from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { FileButton, SlotPreview } from '../Preview.tsx';
import { RoleInfo, RoleTagButton } from './AnalysisRole.tsx';
import { ConfigView } from './ConfigView.tsx';
import { DataTable, hasTable } from './DataTable.tsx';
import { FileArena } from './FileArena.tsx';
import { FileQc } from './FileQc.tsx';
import { GetStarted, Unassigned } from './GetStarted.tsx';
import { MATRIX, NeuralFileOverview } from './NeuralOverview.tsx';
import { accepted, noteOf, slotLabel } from './FileList.tsx';
import { StepFooter, StepIntro, StepWizard } from './StepWizard.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** Plots and checks, or the file's values as a table (shown on the Overview step). */
function ViewSwitch(props: { slot: SlotId }): JSX.Element {
  const table = () => viewOf(props.slot) === 'table' && sectionOf(props.slot) === 'overview';
  const show = (v: 'plot' | 'table') => {
    setView(props.slot, v);
    if (v === 'table') openSection(props.slot, 'overview');
  };
  return (
    <Show when={hasTable(props.slot)}>
      <div class="cb-ds-view" role="tablist" aria-label="Show the file as">
        <button
          type="button"
          role="tab"
          aria-selected={!table()}
          classList={{ 'cb-ds-view--on': !table() }}
          onClick={() => show('plot')}
        >
          Plots and checks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={table()}
          classList={{ 'cb-ds-view--on': table() }}
          onClick={() => show('table')}
        >
          Data table
        </button>
      </div>
    </Show>
  );
}

/** The whole file: its plots, or its values as loaded. */
function Overview(props: { slot: SlotId }): JSX.Element {
  return (
    <Show
      when={viewOf(props.slot) === 'table' && hasTable(props.slot)}
      fallback={
        MATRIX[props.slot] ? (
          <NeuralFileOverview slot={props.slot} />
        ) : (
          <SlotPreview slot={props.slot} />
        )
      }
    >
      <DataTable slot={props.slot} />
    </Show>
  );
}

/** The body of one section of a loaded file. */
function Section(props: { slot: SlotId; section: SectionId }): JSX.Element {
  return (
    <Switch fallback={<Overview slot={props.slot} />}>
      <Match when={props.section === 'arena'}>
        <FileArena />
      </Match>
    </Switch>
  );
}

/** The body of the timestamp alignment check; its title is the pop-up's. */
function Sync(): JSX.Element {
  return (
    <div class="cb-ds-body">
      <FileQc id="sync" />
    </div>
  );
}

/** Under the title of a loaded file: view switch, file name and shape, Replace file, Remove. */
function FileBar(props: { slot: Slot }): JSX.Element {
  const info = () => loaded[props.slot.id]!;
  const remove = () => {
    const ok = window.confirm(
      `Remove ${info().name} from this session? The original file is not changed.`,
    );
    if (ok) removeFile(props.slot.id);
  };
  return (
    <>
      <ViewSwitch slot={props.slot.id} />
      <span class="sc">File</span>
      <span class="cb-ds-bar__file" title={info().name}>
        {info().name}
      </span>
      <span class="cb-muted cb-ds-bar__shape">{info().summary}</span>
      <span class="cb-spacer" />
      <span class="cb-muted cb-ds-bar__hint">or drop a new file anywhere on this window</span>
      <label class="btn-primary btn-small cb-file">
        Replace file
        <input
          type="file"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void addFiles([f], props.slot.id);
          }}
        />
      </label>
      <button type="button" class="btn-secondary btn-small" onClick={remove}>
        Remove
      </button>
    </>
  );
}

function LoadedFile(props: { slot: Slot }): JSX.Element {
  const info = () => loaded[props.slot.id]!;
  return (
    <>
      <Show when={noteOf(props.slot.id)}>
        <p class="cb-ds-meta" classList={{ 'cb-error': !!info().error, 'cb-warn': !info().error }}>
          {noteOf(props.slot.id)}
        </p>
      </Show>
      <Show when={sectionsFor(props.slot.id).length > 1}>
        <StepWizard slot={props.slot.id} />
      </Show>
      <StepIntro slot={props.slot.id} />
      <div class="cb-ds-body">
        <Section slot={props.slot.id} section={sectionOf(props.slot.id)} />
      </div>
      <StepFooter slot={props.slot.id} />
    </>
  );
}

function EmptySlot(props: { slot: Slot }): JSX.Element {
  const [over, setOver] = createSignal(false);
  const info = () => loaded[props.slot.id];
  return (
    <>
      <p class="cb-muted cb-ds-meta">{props.slot.format}</p>
      <Show when={info()?.error}>
        <p class="cb-error">
          {info()!.name}: {info()!.error}
        </p>
      </Show>
      <div
        class="cb-ds-drop"
        classList={{ 'cb-ds-drop--over': over() }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void addFiles([f], props.slot.id);
        }}
      >
        <p>Drop the {slotLabel(props.slot).toLowerCase()} file here</p>
        <FileButton slot={props.slot.id} primary />
        <p class="cb-muted">
          Accepted file types: <code>{accepted(props.slot)}</code>
        </p>
      </div>
    </>
  );
}

/** The three neural activity files as tabs, each with its level. */
function ActivityTabs(props: { slot: SlotId }): JSX.Element {
  const name = (id: SlotId) => NEURAL_LAYERS.find((l) => l.slot === id)!.label;
  return (
    <div class="cb-ds-view cb-ds-tabs" role="tablist" aria-label="Neural activity file">
      <For each={ACTIVITY_SLOTS}>
        {(id) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.slot === id}
            classList={{ 'cb-ds-view--on': props.slot === id }}
            onClick={() => openEntry(id)}
          >
            {name(id)} · {LEVEL_WORD[levelOf(id)].toLowerCase()}
            <Show when={!loaded[id]?.summary}> · not loaded</Show>
          </button>
        )}
      </For>
    </div>
  );
}

/** Title, help and tags of the pop-up for a data type. */
function SlotHead(props: { slot: Slot }): JSX.Element {
  return (
    <>
      <Show
        when={isActivity(props.slot.id)}
        fallback={<InfoTip label={`About ${slotLabel(props.slot)}`}>{props.slot.format}</InfoTip>}
      >
        <RoleInfo />
        <ActivityTabs slot={props.slot.id} />
      </Show>
      <Show when={!isActivity(props.slot.id)}>
        <span class="cb-muted">{LEVEL_WORD[levelOf(props.slot.id)]}</span>
      </Show>
      <RoleTagButton slot={props.slot.id} />
    </>
  );
}

const title = (e: string, slot?: Slot): string =>
  e === 'sync'
    ? 'Timestamp alignment'
    : e === 'config'
      ? 'Experimental setup'
      : e.startsWith('file:')
        ? 'Unassigned file'
        : slot && isActivity(slot.id)
          ? 'Neural activity'
          : slot
            ? slotLabel(slot)
            : '';

/** The open entry in its pop-up. */
export function EntryPopup(): JSX.Element {
  const slot = () => SLOTS.find((s) => s.id === entry());
  const file = () => {
    const e = entry();
    return e.startsWith('file:') ? unrecognized().find((f) => `file:${f.name}` === e) : undefined;
  };
  const loadedSlot = () => {
    const s = slot();
    return s && s.id !== 'config' && isLoaded(s.id) ? s : undefined;
  };
  return (
    <Show when={popupOpen() && entry() !== 'start' && entry() !== 'config'}>
      <Modal
        label={title(entry(), slot())}
        title={title(entry(), slot())}
        head={
          <Switch>
            <Match when={entry() === 'sync'}>
              <span class="cb-muted">Cross-data check</span>
              <InfoTip label="About Timestamp alignment">
                Dropped frames, frame-time jitter, and whether the miniscope and behavior camera
                clocks line up after the clock offset and scale in the experimental setup.
              </InfoTip>
            </Match>
            <Match when={slot() && slot()!.id !== 'config' && slot()}>
              {(s) => <SlotHead slot={s()} />}
            </Match>
          </Switch>
        }
        bar={loadedSlot() ? <FileBar slot={loadedSlot()!} /> : undefined}
        onClose={closeEntry}
        onDropFiles={loadedSlot() ? (f) => void addFiles([f[0]], loadedSlot()!.id) : undefined}
      >
        <div class="cb-gs-section cb-ds-entry">
          <Switch>
            <Match when={entry() === 'sync'}>
              <Sync />
            </Match>
            <Match when={entry() === 'config'}>
              <ConfigView />
            </Match>
            <Match when={file()}>{(f) => <Unassigned file={f()} />}</Match>
            <Match when={loadedSlot()}>{(s) => <LoadedFile slot={s()} />}</Match>
            <Match when={slot()}>{(s) => <EmptySlot slot={s()} />}</Match>
            <Match when={entry() === 'start'}>
              <GetStarted />
            </Match>
          </Switch>
        </div>
      </Modal>
    </Show>
  );
}
