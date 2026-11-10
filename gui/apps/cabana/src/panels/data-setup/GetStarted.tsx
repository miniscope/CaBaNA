// What the Data setup page shows before anything is loaded, and for a file no data type matched.

import { createResource, For, Show, type JSX } from 'solid-js';
import { openEntry } from '../../lib/data-setup-view.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import { addFiles, assignFile, levelOf, loaded } from '../../lib/store.ts';
import { ExamplePicker, fileList } from '../LoadPanel.tsx';
import { accepted, slotLabel } from './FileList.tsx';

export function GetStarted(): JSX.Element {
  const required = () => SLOTS.filter((s) => levelOf(s.id) === 'required');
  const recommended = () =>
    SLOTS.filter((s) => levelOf(s.id) === 'recommended' && s.id !== 'config');
  return (
    <div class="cb-ds-start">
      <div class="cb-ds-head">
        <h3>Load a recording</h3>
      </div>
      <p class="cb-muted cb-ds-meta">
        Files are matched to a data type by name. Anything CaBaNA doesn't recognize is listed under
        Unassigned files, where you can give it a type.
      </p>
      <div class="cb-ds-drop">
        <p>Drop a folder or files anywhere on this page</p>
        <div class="cb-controls">
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
          <label class="btn-secondary btn-small cb-file">
            Select files
            <input type="file" hidden multiple onChange={(e) => void addFiles(fileList(e))} />
          </label>
          <ExamplePicker />
        </div>
      </div>
      <div class="cb-ds-start__cols">
        <div>
          <h4>Needed to start</h4>
          <For each={required()}>
            {(s) => (
              <p>
                {slotLabel(s)} <code class="cb-muted">{accepted(s)}</code>
              </p>
            )}
          </For>
          <h4>Recommended</h4>
          <p class="cb-muted">
            {recommended()
              .map((s) => slotLabel(s))
              .join(', ')}
            . Each analysis says which files it uses.
          </p>
        </div>
        <div>
          <h4>Repeating an earlier experiment?</h4>
          <p class="cb-muted">
            Load its experiment config first, then the new recording. Settings fill in as files
            arrive.
          </p>
          <button class="btn-secondary btn-small" onClick={() => openEntry('config')}>
            Open Experiment config
          </button>
        </div>
      </div>
    </div>
  );
}

/** First lines of a text file, as a table preview. */
async function firstRows(f: File): Promise<string[][]> {
  if (!/\.(csv|tsv|txt)$/i.test(f.name)) return [];
  const text = await f.slice(0, 4000).text();
  const sep = f.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 6)
    .map((l) => l.split(sep));
}

export function Unassigned(props: { file: File }): JSX.Element {
  const [rows] = createResource(() => props.file, firstRows);
  const assign = (slot: SlotId) => {
    void assignFile(props.file, slot);
    openEntry(slot);
  };
  return (
    <div class="cb-ds-start">
      <div class="cb-ds-head">
        <h3>Unassigned file</h3>
      </div>
      <p class="cb-muted cb-ds-meta">
        <code>{props.file.name}</code>
      </p>
      <p class="cb-note">
        CaBaNA didn't recognize this file's data type, so it isn't used. Choose a type below to
        include it, or leave it unassigned and it will be ignored.
      </p>
      <label class="cb-setup-field cb-ds-start__pick">
        Data type
        <select onChange={(e) => e.currentTarget.value && assign(e.currentTarget.value as SlotId)}>
          <option value="">Leave unassigned</option>
          <For each={SLOTS}>
            {(s) => (
              <option value={s.id}>
                {slotLabel(s)}
                {loaded[s.id]?.summary ? ' (replaces the loaded file)' : ''}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show when={rows()?.length}>
        <h4>First rows</h4>
        <table class="cb-ftab cb-ds-table__t">
          <tbody>
            <For each={rows()}>
              {(r) => (
                <tr>
                  <For each={r}>{(v) => <td>{v}</td>}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
