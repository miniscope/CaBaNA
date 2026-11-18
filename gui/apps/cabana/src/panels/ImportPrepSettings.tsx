// Import preprocessing settings: pick a project or saved session, tick the settings of the open
// pop-up to take, and they go into that pop-up's draft. QC decisions are never copied.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import type { PrepKey } from '../lib/prep-deps.ts';
import { chosenValues, importRows, prepText } from '../lib/prep-import.ts';
import { prepSources } from '../lib/prep-sources.ts';
import type { PrepValues } from '../lib/qc-draft.ts';

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function ImportPrepSettings(props: {
  /** The settings of the pop-up this opened from. */
  keys: readonly PrepKey[];
  /** What the pop-up's draft shows for a setting now. */
  now: (key: PrepKey) => PrepValues[PrepKey];
  onImport: (values: Partial<PrepValues>) => void;
  onClose: () => void;
}): JSX.Element {
  const [sources] = createResource(prepSources);
  const [picked, setPicked] = createSignal<string>();
  const source = () => (sources() ?? []).find((s) => s.id === picked()) ?? sources()?.[0];
  const rows = () => importRows(props.keys, source()?.values, props.now);
  // Settings that differ are ticked at first; the user's own ticks replace that.
  const [ticks, setTicks] = createSignal<Partial<Record<PrepKey, boolean>>>({});
  const isTicked = (r: { key: PrepKey; differs: boolean }) => ticks()[r.key] ?? r.differs;
  const ticked = () =>
    new Set(
      rows()
        .filter(isTicked)
        .map((r) => r.key),
    );
  const count = () => rows().filter((r) => isTicked(r) && r.from !== undefined).length;
  const choose = (id: string) => {
    setPicked(id);
    setTicks({});
  };
  const run = () => {
    props.onImport(chosenValues(rows(), ticked()));
    props.onClose();
  };
  return (
    <Modal
      label="Import preprocessing settings"
      title="Import preprocessing settings"
      head={<span class="cb-muted">into this window</span>}
      width={760}
      height={520}
      onClose={props.onClose}
      actions={
        <button type="button" class="btn-primary btn-small" disabled={!count()} onClick={run}>
          Import {count()} {count() === 1 ? 'setting' : 'settings'}
        </button>
      }
    >
      <div class="cb-imp">
        <Show
          when={sources()?.length}
          fallback={
            <p class="cb-muted">
              {sources.loading
                ? 'Reading the other projects…'
                : 'No other project or saved session has preprocessing settings yet.'}
            </p>
          }
        >
          <label class="cb-imp__from">
            From
            <select value={source()?.id} onChange={(e) => choose(e.currentTarget.value)}>
              <For each={sources()}>{(s) => <option value={s.id}>{s.label}</option>}</For>
            </select>
            <Show when={source()}>
              {(s) => <span class="cb-muted">saved {when(s().savedAt)}</span>}
            </Show>
          </label>
          <table class="cb-imp__table">
            <thead>
              <tr>
                <th />
                <th>Setting</th>
                <th>That project</th>
                <th>Here now</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Import ${r.label}`}
                        disabled={r.from === undefined}
                        checked={isTicked(r) && r.from !== undefined}
                        onChange={(e) => setTicks({ ...ticks(), [r.key]: e.currentTarget.checked })}
                      />
                    </td>
                    <td>{r.label}</td>
                    <td classList={{ 'cb-imp__diff': r.differs }}>{prepText(r.key, r.from)}</td>
                    <td class="cb-muted">{prepText(r.key, r.now)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
        <div class="cb-imp__never">
          <b>Not imported: QC decisions.</b> Rejected cells, position jump choices and annotation
          fixes belong to one recording and are never copied.
        </div>
        <p class="cb-muted">
          Imported settings go into this window and take effect on Actions, Apply changes, like any
          other change.
        </p>
      </div>
    </Modal>
  );
}
