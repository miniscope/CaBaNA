// The open entry of the Data setup page: a loaded file with its sections (Overview, QC, ...),
// an empty slot to load, or an unassigned file. A file's sections are the steps of StepWizard.

import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import { entry, sectionOf, setView, viewOf } from '../../lib/data-setup-view.ts';
import { sectionsFor, type SectionId } from '../../lib/file-sections.ts';
import { SLOTS, type Slot, type SlotId } from '../../lib/slots.ts';
import { addFiles, levelOf, loaded, unrecognized } from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { FileButton, SlotPreview } from '../Preview.tsx';
import { RoleTagButton } from './AnalysisRole.tsx';
import { ConfigView } from './ConfigView.tsx';
import { DataTable, hasTable } from './DataTable.tsx';
import { FileArena } from './FileArena.tsx';
import { FilePrep } from './FilePrep.tsx';
import { FileQc } from './FileQc.tsx';
import { GetStarted, Unassigned } from './GetStarted.tsx';
import { MATRIX, NeuralFileOverview } from './NeuralOverview.tsx';
import { accepted, LEVEL, noteOf, slotLabel } from './FileList.tsx';
import { StepFooter, StepIntro, StepWizard } from './StepWizard.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** Overview of a file as its plots or as a table; sits at the end of the step's explanation. */
function ViewSwitch(props: { slot: SlotId }): JSX.Element {
  return (
    <Show when={hasTable(props.slot) && sectionOf(props.slot) === 'overview'}>
      <div class="cb-ds-view" role="tablist" aria-label="Show the file as">
        <For each={['plot', 'table'] as const}>
          {(v) => (
            <button
              type="button"
              role="tab"
              aria-selected={viewOf(props.slot) === v}
              classList={{ 'cb-ds-view--on': viewOf(props.slot) === v }}
              onClick={() => setView(props.slot, v)}
            >
              {v === 'plot' ? 'Plot' : 'Data table'}
            </button>
          )}
        </For>
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
      <Match when={props.section === 'qc'}>
        <FileQc id={props.slot} />
      </Match>
      <Match when={props.section === 'arena'}>
        <FileArena />
      </Match>
      <Match when={props.section === 'prep'}>
        <FilePrep slot={props.slot} />
      </Match>
    </Switch>
  );
}

/** The one check across files: the miniscope and camera clocks against each other. */
function Sync(): JSX.Element {
  return (
    <>
      <div class="cb-ds-head">
        <h3>Timestamp alignment</h3>
        <span class="cb-muted">Cross-data check</span>
        <InfoTip label="About Timestamp alignment">
          Dropped frames, frame-time jitter, and whether the miniscope and behavior camera clocks
          line up after the clock offset and scale in Experiment config.
        </InfoTip>
      </div>
      <div class="cb-ds-body">
        <FileQc id="sync" />
      </div>
    </>
  );
}

function LoadedFile(props: { slot: Slot }): JSX.Element {
  const info = () => loaded[props.slot.id]!;
  return (
    <>
      <div class="cb-ds-head">
        <h3>{slotLabel(props.slot)}</h3>
        <RoleTagButton slot={props.slot.id} />
        <span class="cb-muted">{LEVEL[levelOf(props.slot.id)]}</span>
        <span class="cb-muted cb-ds-head__file" title={props.slot.format}>
          <code>{info().name}</code> · {info().summary}
        </span>
        <InfoTip label="Expected format">{props.slot.format}</InfoTip>
        <span class="cb-spacer" />
        <FileButton slot={props.slot.id} />
      </div>
      <Show when={noteOf(props.slot.id)}>
        <p class="cb-ds-meta" classList={{ 'cb-error': !!info().error, 'cb-warn': !info().error }}>
          {noteOf(props.slot.id)}
        </p>
      </Show>
      <Show when={sectionsFor(props.slot.id).length > 1}>
        <StepWizard slot={props.slot.id} />
      </Show>
      <StepIntro slot={props.slot.id} right={<ViewSwitch slot={props.slot.id} />} />
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
      <div class="cb-ds-head">
        <h3>{slotLabel(props.slot)}</h3>
        <span class="cb-muted">{LEVEL[levelOf(props.slot.id)]}</span>
      </div>
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

export function EntryView(): JSX.Element {
  const slot = () => SLOTS.find((s) => s.id === entry());
  const file = () => {
    const e = entry();
    return e.startsWith('file:') ? unrecognized().find((f) => `file:${f.name}` === e) : undefined;
  };
  return (
    <div class="cb-gs-section cb-ds-entry">
      <Switch>
        <Match when={entry() === 'sync'}>
          <Sync />
        </Match>
        <Match when={entry() === 'config'}>
          <ConfigView />
        </Match>
        <Match when={entry() === 'start'}>
          <GetStarted />
        </Match>
        <Match when={file()}>{(f) => <Unassigned file={f()} />}</Match>
        <Match when={slot() && isLoaded(slot()!.id) && slot()}>
          {(s) => <LoadedFile slot={s()} />}
        </Match>
        <Match when={slot()}>{(s) => <EmptySlot slot={s()} />}</Match>
      </Switch>
    </div>
  );
}
