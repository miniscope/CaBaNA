import { createSignal, For, Show, type JSX } from 'solid-js';
import { GROUPS, SLOTS, type Slot } from '../lib/slots.ts';
import { ConfigReport } from './ConfigReport.tsx';
import { Preview } from './Preview.tsx';
import { Req } from './parts.tsx';
import {
  EXAMPLES,
  levelOf,
  goToStep,
  addFiles,
  assignFile,
  clearAll,
  loaded,
  loadExample,
  unrecognized,
} from '../lib/store.ts';

const LEVEL_LABEL = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
  unused: 'Not needed',
};

function fileList(e: Event): File[] {
  return Array.from((e.currentTarget as HTMLInputElement).files ?? []);
}

function Row(props: { slot: Slot }): JSX.Element {
  const info = () => loaded[props.slot.id];
  const state = () => (info()?.error ? 'error' : info()?.summary ? 'ok' : 'empty');
  return (
    <div class={`cb-row cb-row--${state()}`}>
      <span class="cb-row__icon" aria-hidden="true">
        {state() === 'ok' ? '✓' : state() === 'error' ? '!' : '○'}
      </span>
      <div class="cb-row__main">
        <div class="cb-row__title">
          {props.slot.label}
          {levelOf(props.slot.id) === 'required' && <Req />}
          <span class={`cb-tag cb-tag--${levelOf(props.slot.id)}`}>
            {LEVEL_LABEL[levelOf(props.slot.id)]}
          </span>
        </div>
        <div class="cb-row__sub">
          <Show when={state() === 'empty'}>
            <code>{props.slot.file}</code> {props.slot.format}
          </Show>
          <Show when={state() === 'ok'}>
            <code>{info()!.name}</code>
            <Show when={info()!.warning}>
              <span class="cb-warn"> {info()!.warning}</span>
            </Show>
          </Show>
          <Show when={state() === 'error'}>
            <code>{info()!.name}</code> <span class="cb-error">{info()!.error}</span>
          </Show>
        </div>
      </div>
      <div class="cb-row__right">
        {state() === 'ok' ? info()!.summary : state() === 'empty' ? 'Not added yet' : ''}
      </div>
      <Show when={props.slot.id === 'config'}>
        <button class="btn-secondary btn-small" onClick={() => goToStep('setup')}>
          Create
        </button>
      </Show>
      <label class="btn-secondary btn-small cb-file">
        {state() === 'empty' ? 'Add' : 'Replace'}
        <input type="file" hidden onChange={(e) => void addFiles(fileList(e), props.slot.id)} />
      </label>
    </div>
  );
}

const UploadIcon = (): JSX.Element => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </svg>
);

export function LoadPanel(): JSX.Element {
  const [example, setExample] = createSignal(EXAMPLES[0].id);
  const [source, setSource] = createSignal<'upload' | 'example'>('upload');
  return (
    <div class="cb-panel cb-panel--wide">
      <h2>Load your data</h2>
      <p class="cb-lead">
        Load a whole folder, or choose each file below. Files are matched to the list by name, and
        anything unmatched can be assigned by hand.
      </p>
      <div class="cb-controls">
        <div class="cb-seg cb-seg--lg" role="tablist">
          <For
            each={
              [
                ['upload', 'Upload'],
                ['example', 'Example data'],
              ] as const
            }
          >
            {([id, label]) => (
              <button
                role="tab"
                aria-selected={source() === id}
                classList={{ 'cb-seg__on': source() === id }}
                onClick={() => setSource(id)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <span class="cb-spacer" />
        <button class="btn-secondary btn-small" onClick={clearAll}>
          Clear
        </button>
      </div>
      <Show when={source() === 'upload'}>
        <div
          class="cb-dropzone cb-dropzone--static"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(Array.from(e.dataTransfer?.files ?? []));
          }}
        >
          <UploadIcon />
          <span class="cb-dropzone__main">
            Select individual files or a folder that contains all your files
          </span>
          <div class="cb-controls">
            <label class="btn-primary btn-small cb-file">
              Select files
              <input type="file" hidden multiple onChange={(e) => void addFiles(fileList(e))} />
            </label>
            <label class="btn-primary btn-small cb-file">
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
          </div>
        </div>
      </Show>
      <Show when={source() === 'example'}>
        <div class="cb-dropzone cb-dropzone--static">
          <div class="cb-controls">
            <select
              value={example()}
              onChange={(e) => setExample(e.currentTarget.value)}
              aria-label="Example dataset"
            >
              <For each={EXAMPLES}>{(x) => <option value={x.id}>{x.label}</option>}</For>
            </select>
            <button class="btn-primary btn-small" onClick={() => void loadExample(example())}>
              Load example
            </button>
          </div>
          <div class="cb-muted">{EXAMPLES.find((x) => x.id === example())?.note}</div>
        </div>
      </Show>

      <Show when={unrecognized().length}>
        <div class="cb-unmatched">
          <strong>Files CaBaNA did not recognize</strong>
          <p class="cb-muted">
            These files were in what you selected, but their names don't match any data type CaBaNA
            reads. If one of them holds data you want to use, pick its type from the list. Leave the
            rest alone: files left unassigned are ignored and nothing is lost.
          </p>
          <For each={unrecognized()}>
            {(f) => (
              <div class="cb-unmatched__row">
                <code>{f.name}</code>
                <select
                  onChange={(e) => {
                    if (e.currentTarget.value)
                      void assignFile(f, e.currentTarget.value as Slot['id']);
                  }}
                >
                  <option value="">Assign to…</option>
                  <For each={SLOTS}>{(s) => <option value={s.id}>{s.label}</option>}</For>
                </select>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="cb-load-grid">
        <div>
          <For each={GROUPS}>
            {(g) => (
              <section class="cb-group">
                <h3>{g}</h3>
                <For each={SLOTS.filter((s) => s.group === g)}>{(s) => <Row slot={s} />}</For>
                <Show when={g === 'Settings'}>
                  <ConfigReport />
                </Show>
              </section>
            )}
          </For>
        </div>
        <div class="cb-load-grid__preview">
          <Preview />
        </div>
      </div>
    </div>
  );
}
