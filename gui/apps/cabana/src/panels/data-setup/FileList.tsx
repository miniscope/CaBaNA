// The Data setup page's list: one row per data type, grouped as Config, Neural and Behavioral,
// then files no data type matched. Each row shows the loaded file's name and shape, or its level
// when nothing is loaded. The mark on the left is the same as on the analysis pages: a tick once
// opened, ! when the file has an error or a note.

import { For, Show, type JSX } from 'solid-js';
import { configReport } from '../../lib/config-import.ts';
import { entry, openEntry, reviewed, type EntryId } from '../../lib/data-setup-view.ts';
import { SLOTS, type Slot, type SlotId } from '../../lib/slots.ts';
import { levelOf, loaded, unrecognized } from '../../lib/store.ts';
import { fileMismatch } from '../ConfigReport.tsx';

export const LEVEL: Record<string, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
  unused: 'Not needed',
};

/** The name a data type has on this page; the config file is the experiment's config. */
export const slotLabel = (s: Slot) => (s.id === 'config' ? 'Experiment config' : s.label);

const GROUPS: { title: string; slots: Slot[] }[] = [
  { title: 'Config', slots: SLOTS.filter((s) => s.group === 'Configuration') },
  { title: 'Neural', slots: SLOTS.filter((s) => s.group === 'Neural') },
  { title: 'Behavioral', slots: SLOTS.filter((s) => s.group === 'Behavioral') },
];

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** Why a loaded file needs a look: an error, a note from loading, or a name the config disagrees with. */
export function noteOf(id: SlotId): string | undefined {
  const info = loaded[id];
  if (!info) return undefined;
  const m = fileMismatch(id);
  return info.error ?? (m ? `Config names ${m}` : info.warning);
}

function Mark(props: { id: EntryId; loaded: boolean; attention: boolean }): JSX.Element {
  return (
    <span
      class="cb-gs-mark"
      classList={{
        'cb-gs-mark--warn': props.attention,
        'cb-gs-mark--ok': !props.attention && props.loaded && reviewed(props.id),
        'cb-ds-mark--empty': !props.loaded,
      }}
      aria-hidden="true"
    >
      {props.attention ? '!' : props.loaded && reviewed(props.id) ? '✓' : ''}
    </span>
  );
}

function Row(props: { slot: Slot }): JSX.Element {
  const id = () => props.slot.id;
  const info = () => loaded[id()];
  const shape = () =>
    id() === 'config' && configReport()
      ? `${configReport()!.read.length} settings`
      : (info()?.summary ?? '');
  return (
    <button
      type="button"
      class="cb-gs-item cb-ds-item"
      classList={{ 'cb-gs-item--on': entry() === id() }}
      aria-current={entry() === id() ? 'page' : undefined}
      onClick={() => openEntry(id())}
    >
      <Mark id={id()} loaded={isLoaded(id())} attention={!!noteOf(id())} />
      <span class="cb-gs-item__text">
        <span class="cb-ds-item__head">
          <span class="cb-gs-item__title">{slotLabel(props.slot)}</span>
          <Show when={!isLoaded(id())}>
            <span class="cb-ds-item__level">{LEVEL[levelOf(id())]}</span>
          </Show>
        </span>
        <Show
          when={isLoaded(id())}
          fallback={
            <span class="cb-gs-item__sum">{info()?.error ? info()!.name : 'Not loaded'}</span>
          }
        >
          <span class="cb-gs-item__sum cb-ds-item__file" title={info()!.name}>
            {info()!.name}
          </span>
          <span class="cb-gs-item__sum" title={shape()}>
            {shape()}
          </span>
        </Show>
      </span>
    </button>
  );
}

export function FileList(): JSX.Element {
  return (
    <nav class="cb-gs-list cb-ds-list" aria-label="Data files">
      <For each={GROUPS}>
        {(g) => (
          <>
            <h4 class="cb-ds-grp">{g.title}</h4>
            <For each={g.slots}>{(s) => <Row slot={s} />}</For>
          </>
        )}
      </For>
      <Show when={unrecognized().length}>
        <h4 class="cb-ds-grp">Unassigned files</h4>
        <For each={unrecognized()}>
          {(f) => {
            const id = `file:${f.name}` as const;
            return (
              <button
                type="button"
                class="cb-gs-item cb-ds-item"
                classList={{ 'cb-gs-item--on': entry() === id }}
                onClick={() => openEntry(id)}
              >
                <Mark id={id} loaded attention />
                <span class="cb-gs-item__text">
                  <span class="cb-gs-item__title cb-ds-item__file">{f.name}</span>
                  <span class="cb-gs-item__sum">No data type · not used</span>
                </span>
              </button>
            );
          }}
        </For>
      </Show>
      <p class="cb-muted cb-gs-list__note">
        A file is marked reviewed once opened. None has to be reviewed before continuing.
      </p>
    </nav>
  );
}
