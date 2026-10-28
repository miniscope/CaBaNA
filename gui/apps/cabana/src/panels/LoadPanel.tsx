import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { configReport } from '../lib/config-import.ts';
import { GROUPS, SLOTS, type Group, type Slot, type SlotId } from '../lib/slots.ts';
import { ConfigSummary, fileMismatch, setupItems } from './ConfigReport.tsx';
import { FileButton, Preview, type PreviewItem } from './Preview.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton, StatusIcon, type Shown } from './QcParts.tsx';
import {
  EXAMPLES,
  levelOf,
  goToStep,
  addFiles,
  clearAll,
  loaded,
  loadExample,
  missingRequired,
  unrecognized,
} from '../lib/store.ts';

type Tab = Group | 'Unmatched';

// Kept outside the panel so the tab and each tab's selection survive a visit to another step.
const [tab, setTab] = createSignal<Tab>('Neural');
const [pickedIn, setPickedIn] = createStore<Partial<Record<Tab, PreviewItem>>>({
  Neural: { slot: 'neural_denoised' },
});

/** The open tab. Once the last unmatched file is assigned, its tab goes and Neural shows. */
const current = (): Tab => (tab() !== 'Unmatched' || unrecognized().length ? tab() : 'Neural');

/** The selected row of the open tab: the one picked there last, or its first row. */
function picked(): PreviewItem {
  const t = current();
  const p = pickedIn[t];
  if (t === 'Unmatched') {
    const files = unrecognized();
    return p && 'file' in p && files.includes(p.file) ? p : { file: files[0] };
  }
  return p ?? { slot: SLOTS.find((s) => s.group === t)!.id };
}
const setPicked = (p: PreviewItem) => setPickedIn(current(), p);

const LEVEL = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
  unused: '',
};

function fileList(e: Event): File[] {
  const input = e.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

/** A row's status: loaded, loaded with a note, not readable, or not added. */
function status(id: SlotId): Shown {
  const info = loaded[id];
  if (!info) return 'none';
  if (info.error) return 'fail';
  return info.warning || fileMismatch(id) ? 'warn' : 'pass';
}

/** The tab's summary icon: the worst row, or the setup warnings on the Configuration tab. */
function tabStatus(g: Group): Shown {
  const s = SLOTS.filter((x) => x.group === g).map((x) => status(x.id));
  if (s.includes('fail')) return 'fail';
  if (s.includes('warn') || (g === 'Configuration' && setupItems().length)) return 'warn';
  return s.includes('pass') ? 'pass' : 'none';
}

const isPicked = (id: SlotId) => {
  const p = picked();
  return 'slot' in p && p.slot === id;
};

function Row(props: { slot: Slot }): JSX.Element {
  const info = () => loaded[props.slot.id];
  const note = () =>
    info()?.error ??
    (fileMismatch(props.slot.id) ? `Config names ${fileMismatch(props.slot.id)}` : info()?.warning);
  return (
    <tr
      class="cb-ftab__row"
      classList={{ 'cb-ftab__row--on': isPicked(props.slot.id) }}
      tabindex="0"
      aria-selected={isPicked(props.slot.id)}
      onClick={() => setPicked({ slot: props.slot.id })}
      onKeyDown={(e) => e.key === 'Enter' && setPicked({ slot: props.slot.id })}
    >
      <td>
        <StatusIcon status={status(props.slot.id)} />
      </td>
      <td class="cb-ftab__name">
        <div>{props.slot.label}</div>
        <div class="cb-muted">
          <Show
            when={info()}
            fallback={`Not added · ${LEVEL[levelOf(props.slot.id)] || 'Not needed'}`}
          >
            {info()!.name}
          </Show>
          <Show when={note()}>
            <span classList={{ 'cb-error': !!info()?.error, 'cb-warn': !info()?.error }}>
              {' '}
              · {note()}
            </span>
          </Show>
        </div>
      </td>
      <td class="cb-muted">
        {props.slot.id === 'config' && configReport()
          ? `${configReport()!.read.length} settings`
          : info()?.summary || '—'}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <FileButton slot={props.slot.id} />
      </td>
    </tr>
  );
}

function UnmatchedRow(props: { file: File }): JSX.Element {
  const on = () => {
    const p = picked();
    return 'file' in p && p.file === props.file;
  };
  return (
    <tr
      class="cb-ftab__row"
      classList={{ 'cb-ftab__row--on': on() }}
      tabindex="0"
      aria-selected={on()}
      onClick={() => setPicked({ file: props.file })}
      onKeyDown={(e) => e.key === 'Enter' && setPicked({ file: props.file })}
    >
      <td>
        <StatusIcon status="warn" />
      </td>
      <td class="cb-ftab__name">
        <div>{props.file.name}</div>
        <div class="cb-muted">Not assigned · ignored unless you choose a type</div>
      </td>
      <td class="cb-muted">—</td>
      <td />
    </tr>
  );
}

/** Opens the list of example datasets. */
function ExamplePicker(): JSX.Element {
  const [choice, setChoice] = createSignal(EXAMPLES[0].id);
  return (
    <PopButton
      label="Try example data"
      title="Try example data"
      width={420}
      class="btn-secondary btn-small"
      button="Try example data"
    >
      {(close) => (
        <div class="cb-examples">
          <For each={EXAMPLES}>
            {(x) => (
              <label class="cb-examples__item">
                <input
                  type="radio"
                  name="cb-example"
                  checked={choice() === x.id}
                  onChange={() => setChoice(x.id)}
                />
                <span>
                  <span>{x.label}</span>
                  <span class="cb-muted">{x.note}</span>
                </span>
              </label>
            )}
          </For>
          <div class="cb-controls">
            <span class="cb-spacer" />
            <button
              class="btn-primary btn-small"
              onClick={() => {
                close();
                void loadExample(choice());
              }}
            >
              Load example
            </button>
          </div>
        </div>
      )}
    </PopButton>
  );
}

export function LoadPanel(): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const tabs = (): Tab[] => [...GROUPS, ...(unrecognized().length ? ['Unmatched' as const] : [])];
  const nLoaded = () => SLOTS.filter((s) => loaded[s.id]?.summary && loaded[s.id]!.size).length;
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div
      class="cb-load"
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
      <div class="cb-load__top">
        <h2>Load your data</h2>
        <span class="cb-muted">
          Select a session folder or individual files, or drop them anywhere on this page. Files are
          matched to data types by name.
        </span>
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
        <span class="cb-spacer" />
        <button class="btn-secondary btn-small" onClick={clearAll}>
          Clear
        </button>
      </div>

      <div class="cb-load__body">
        <section class="cb-load__files">
          <div class="cb-tabs" role="tablist" aria-label="File type">
            <For each={tabs()}>
              {(t) => {
                const n = () =>
                  t === 'Unmatched'
                    ? unrecognized().length
                    : SLOTS.filter((s) => s.group === t && loaded[s.id]?.summary).length;
                return (
                  <button
                    role="tab"
                    aria-selected={current() === t}
                    classList={{ 'cb-tab--on': current() === t }}
                    onClick={() => setTab(t)}
                  >
                    {t} <span class="cb-load__n">{n()}</span>
                    <StatusIcon status={t === 'Unmatched' ? 'warn' : tabStatus(t)} />
                  </button>
                );
              }}
            </For>
          </div>
          <table class="cb-ftab">
            <thead>
              <tr>
                <th class="cb-ftab__icon">
                  <span class="cb-sr">Status</span>
                </th>
                <th>Data · file</th>
                <th class="cb-ftab__shape">Shape</th>
                <th class="cb-ftab__act">
                  <span class="cb-sr">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={current() !== 'Unmatched'}
                fallback={<For each={unrecognized()}>{(f) => <UnmatchedRow file={f} />}</For>}
              >
                <For each={SLOTS.filter((s) => s.group === current())}>
                  {(s) => <Row slot={s} />}
                </For>
              </Show>
            </tbody>
          </table>
          <p class="cb-muted cb-load__hint">
            ⓘ Select a row to preview it. Unmatched files can be assigned a type by hand.
          </p>
          <ConfigSummary />
        </section>
        <Preview item={picked()} />
      </div>

      <div class="cb-load__foot">
        <StatusIcon status={nLoaded() ? 'pass' : 'none'} />
        <span>
          {nLoaded()} {nLoaded() === 1 ? 'file' : 'files'} loaded
        </span>
        <Show when={missingRequired().length}>
          <span class="cb-error">· {missingRequired().length} required missing</span>
        </Show>
        <Show when={setupItems().length}>
          <span class="cb-warn">
            · {setupItems().length} setup {setupItems().length === 1 ? 'item needs' : 'items need'}{' '}
            attention
          </span>
        </Show>
        <Show when={unrecognized().length}>
          <button class="cb-linkbtn cb-load__unmatched" onClick={() => setTab('Unmatched')}>
            {unrecognized().length} {unrecognized().length === 1 ? 'file' : 'files'} unmatched:
            assign types
          </button>
        </Show>
        <span class="cb-spacer" />
        <button class="btn-primary" onClick={() => goToStep('setup')}>
          Continue to Experimental setup →
        </button>
      </div>
    </div>
  );
}
