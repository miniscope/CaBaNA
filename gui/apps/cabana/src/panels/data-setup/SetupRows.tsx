// The body of the Data setup page: the experimental setup line, the Neural data and Behavioral
// data columns with one row per data type, and the cross-data checks line. Each row shows its
// file, level and status in words; View opens the file in the pop-up (EntryView.tsx).
// Explanations are in the i markers, not on the page.

import { For, Show, type JSX } from 'solid-js';
import { configReport } from '../../lib/config-import.ts';
import { qcShown } from '../../lib/analysis-data.ts';
import { arena } from '../../lib/arena.ts';
import { openEntry, setConfigOpen } from '../../lib/data-setup-view.ts';
import { sectionsFor } from '../../lib/file-sections.ts';
import {
  ACTIVITY_SLOTS,
  LEVEL_WORD,
  rowActions,
  rowMuted,
  rowStatus,
  type RowFacts,
} from '../../lib/setup-rows.ts';
import { SLOTS, type Slot, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  configFiles,
  deconvolved,
  experiment,
  experimentId,
  levelOf,
  loaded,
  traceMatrix,
  unrecognized,
} from '../../lib/store.ts';
import { behaviorCategories } from '../BehaviorQc.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { REFERENCE_USE, RoleInfo, roleOf, RoleTag } from './AnalysisRole.tsx';
import { setAsYaml } from './ConfigView.tsx';
import { qcCounts } from './FileQc.tsx';
import { accepted, noteOf } from './FileList.tsx';

const slot = (id: SlotId) => SLOTS.find((s) => s.id === id)!;
const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

function facts(id: SlotId): RowFacts {
  const ok = isLoaded(id);
  return {
    level: levelOf(id),
    loaded: ok,
    error: loaded[id]?.error,
    note: ok ? noteOf(id) : undefined,
    qc: ok && sectionsFor(id).includes('qc') && qcShown(id) ? qcCounts(id) : undefined,
  };
}

/** The row's help: what the file holds, its level, its file type, and its role if it has one. */
function SlotHelp(props: { slot: Slot }): JSX.Element {
  const role = () => roleOf(props.slot.id);
  return (
    <InfoTip label={`About ${props.slot.label}`}>
      <strong>
        {props.slot.label} · {LEVEL_WORD[levelOf(props.slot.id)].toLowerCase()}
      </strong>
      <p>{props.slot.format}</p>
      <Show when={role()}>
        <p>
          {role() === 'analysis'
            ? 'Analysis data: the file every analysis reads.'
            : REFERENCE_USE[props.slot.id]}
        </p>
      </Show>
      <p class="cb-muted">
        File type {accepted(props.slot)}; found by a name like {props.slot.file}.
      </p>
    </InfoTip>
  );
}

/** Replace the file, or load one: a file picker for this data type. */
function Pick(props: { id: SlotId; label: string }): JSX.Element {
  return (
    <label class="btn-secondary btn-small cb-file cb-ds-row__pick">
      {props.label}
      <input
        type="file"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void addFiles([f], props.id);
        }}
      />
    </label>
  );
}

/** One data type. `sub` is a row inside the Neural activity group. */
function SlotRow(props: { id: SlotId; sub?: boolean }): JSX.Element {
  const s = () => slot(props.id);
  const f = () => facts(props.id);
  const st = () => rowStatus(f());
  const acts = () => rowActions(f());
  const file = () => loaded[props.id]?.name ?? configFiles()[props.id] ?? s().file;
  return (
    <div
      class="cb-ds-row"
      classList={{
        'cb-ds-row--sub': props.sub,
        'cb-ds-row--req': props.sub && f().level === 'required',
        'cb-ds-row--off': rowMuted(f()),
      }}
    >
      <div class="cb-ds-row__name">
        <span class="cb-ds-row__title">{s().label}</span>
        <SlotHelp slot={s()} />
        <RoleTag slot={props.id} />
      </div>
      <span
        class="cb-ds-row__level"
        classList={{ 'cb-ds-row__level--req': f().level === 'required' }}
      >
        {LEVEL_WORD[f().level]}
      </span>
      <span class={`cb-ds-row__status cb-ds-tone--${st().tone}`} title={st().detail}>
        {st().text}
      </span>
      <span class="cb-ds-row__acts">
        <Show when={acts().view}>
          <button type="button" class="btn-secondary btn-small" onClick={() => openEntry(props.id)}>
            View
          </button>
        </Show>
        <Pick id={props.id} label={acts().pick} />
      </span>
      <span class="cb-ds-row__file" classList={{ 'cb-muted': !f().loaded }} title={file()}>
        {file()}
      </span>
    </div>
  );
}

/** Raw, denoised and deconvolved: one group, in processing order. */
function ActivityGroup(): JSX.Element {
  const m = () => traceMatrix() ?? deconvolved();
  const n = () => ACTIVITY_SLOTS.filter(isLoaded).length;
  return (
    <section class="cb-ds-act" aria-label="Neural activity">
      <div class="cb-ds-act__head">
        <strong>Neural activity</strong>
        <RoleInfo />
        <Show when={m()}>
          <span class="cb-ds-mono cb-muted">
            {m()!.cells} cells × {m()!.frames.toLocaleString()} frames
          </span>
        </Show>
        <span class="cb-spacer" />
        <span class="cb-muted">{n()} of 3 types loaded</span>
      </div>
      <For each={ACTIVITY_SLOTS}>{(id) => <SlotRow id={id} sub />}</For>
    </section>
  );
}

function Column(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="cb-ds-col" aria-label={props.title}>
      <h3 class="sc">{props.title}</h3>
      <div class="cb-ds-col__rows">{props.children}</div>
    </section>
  );
}

/** Open the arena editor: on the position file when it is loaded, else the typed arena size. */
function editArena(): void {
  if (isLoaded('position')) return openEntry('position', 'arena');
  setAsYaml(false);
  setConfigOpen('spatial');
  openEntry('config');
}

function SetupLine(): JSX.Element {
  const info = () => loaded.config;
  const entered = () => !!info()?.summary && !info()!.size;
  const st = () =>
    entered()
      ? { text: 'Entered here', tone: 'ok' as const, detail: undefined }
      : rowStatus({
          level: levelOf('config'),
          loaded: !!info()?.summary,
          error: info()?.error,
          note: info()?.summary ? noteOf('config') : undefined,
        });
  const zones = () => arena.zones.filter((z) => z.kind === 'zone').length;
  const summary = () =>
    [
      arena.shape === 'circle'
        ? `arena ${arena.width} cm across`
        : `arena ${arena.width} × ${arena.height} cm`,
      `${zones()} ${zones() === 1 ? 'zone' : 'zones'}`,
      experimentId() === 'custom' ? '' : experiment().label,
      configReport() ? `${configReport()!.read.length} settings from the file` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div class="cb-ds-setup">
      <span class="sc">Experimental setup</span>
      <InfoTip label="About the experimental setup">
        Arena size and zones, frame rates, units and the experiment type, kept in config.yaml. View
        shows the config as YAML; Edit setup shows its fields; Edit arena opens the arena editor (on
        the position file when one is loaded).
      </InfoTip>
      <span class="cb-ds-mono">{info()?.size ? info()!.name : 'config.yaml'}</span>
      <span class="cb-muted cb-ds-setup__sum" title={summary()}>
        {summary()}
      </span>
      <span class="cb-spacer" />
      <span class={`cb-ds-tone--${st().tone}`} title={st().detail}>
        {st().text}
      </span>
      <button
        type="button"
        class="btn-secondary btn-small"
        onClick={() => {
          setAsYaml(true);
          openEntry('config');
        }}
      >
        View
      </button>
      <button type="button" class="btn-secondary btn-small" onClick={editArena}>
        Edit arena
      </button>
      <button
        type="button"
        class="btn-secondary btn-small"
        onClick={() => {
          setAsYaml(false);
          openEntry('config');
        }}
      >
        Edit setup
      </button>
    </div>
  );
}

/** Timestamp alignment, the one check across files, and files no data type matched. */
function ChecksLine(): JSX.Element {
  const timing = () => behaviorCategories().find((c) => c.id === 'timing')?.checks;
  const n = (s: string) => timing()?.filter((c) => c.status === s).length ?? 0;
  const parts = () =>
    (
      [
        ['ok', n('pass'), 'passed'],
        ['warn', n('warn'), 'flagged'],
        ['fail', n('fail'), 'failed'],
      ] as const
    ).filter(([, k]) => k);
  return (
    <div class="cb-ds-checks">
      <span class="sc">Cross-data checks</span>
      <span>Timestamp alignment</span>
      <Show
        when={timing()?.length}
        fallback={<span class="cb-muted">Runs once timestamp files load</span>}
      >
        <For each={parts()}>
          {([tone, k, word]) => (
            <span class="cb-ds-check">
              <i class={`cb-ds-dot cb-ds-dot--${tone}`} aria-hidden="true" />
              {k} {word}
            </span>
          )}
        </For>
      </Show>
      <button type="button" class="btn-secondary btn-small" onClick={() => openEntry('sync')}>
        Details
      </button>
      <Show when={unrecognized().length}>
        <span class="cb-ds-checks__sep" />
        <span class="cb-warn">
          {unrecognized().length} {unrecognized().length === 1 ? 'file has' : 'files have'} no data
          type:
        </span>
        <For each={unrecognized()}>
          {(f) => (
            <button
              type="button"
              class="cb-linkbtn cb-ds-mono"
              onClick={() => openEntry(`file:${f.name}`)}
            >
              {f.name}
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}

export function SetupRows(): JSX.Element {
  const behavioral = SLOTS.filter((s) => s.group === 'Behavioral').map((s) => s.id);
  return (
    <div class="cb-ds-rows">
      <SetupLine />
      <div class="cb-ds-cols">
        <Column title="Neural data">
          <SlotRow id="neural_timestamps" />
          <ActivityGroup />
          <SlotRow id="footprints" />
        </Column>
        <Column title="Behavioral data">
          <For each={behavioral}>{(id) => <SlotRow id={id} />}</For>
        </Column>
      </div>
      <ChecksLine />
    </div>
  );
}
