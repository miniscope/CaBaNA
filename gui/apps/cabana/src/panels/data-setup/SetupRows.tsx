// The body of the Data setup page: the experimental summary, then the Neural data and Behavior
// data cards with one row per data type. A loaded row shows its file, a description line, its
// status in words and one Actions menu; an empty row has Load file. Files no data type matched
// are in OtherFiles.tsx.

import { For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Pill } from '../../components/Pill.tsx';
import { qcShown } from '../../lib/analysis-data.ts';
import { arena } from '../../lib/arena.ts';
import { openEntry, setAppliedNote } from '../../lib/data-setup-view.ts';
import { sectionsFor } from '../../lib/file-sections.ts';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { missingFileOf } from '../../lib/open-project.ts';
import { pickFile } from '../../lib/pick-file.ts';
import {
  chooseFilePath,
  forgetSlot,
  projectsOn,
  useFileForSlot,
} from '../../lib/project-session.ts';
import {
  ACTIVITY_SLOTS,
  cardActions,
  cardStatus,
  rowDescription,
  type RowFacts,
} from '../../lib/setup-rows.ts';
import { alignmentText, arenaText, durationText, rateText } from '../../lib/setup-summary.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  deconvolved,
  derivedCameraFps,
  experiment,
  experimentId,
  levelOf,
  loaded,
  override,
  removeFile,
  samplingRate,
  sessionDuration,
  traceMatrix,
} from '../../lib/store.ts';
import { behaviorCategories } from '../BehaviorQc.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { RoleInfo, RoleTag } from './AnalysisRole.tsx';
import { noteOf } from './FileList.tsx';
import { qcCounts } from './FileQc.tsx';

const slot = (id: SlotId) => SLOTS.find((s) => s.id === id)!;
const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;
const NEURAL: SlotId[] = ['neural_timestamps', ...ACTIVITY_SLOTS, 'footprints'];
const BEHAVIOR: SlotId[] = [
  'behavior_timestamps',
  'behavior_annotations',
  'zone_annotations',
  'position',
  'head_orientation',
  'time_markers',
  'frame_labels',
];

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

/**
 * Replace the file of one data type with a chosen file. With the engine on a file is chosen by its
 * path, so the project can keep it (and find it again); otherwise by the browser's chooser.
 */
function replace(id: SlotId): void {
  if (!projectsOn()) return pickFile((f) => void addFiles([f], id));
  chooseFilePath('Choose the file for this data type')
    .then(async (path) => {
      if (path) await useFileForSlot(id, path);
    })
    .catch((e) =>
      setAppliedNote(`The file could not be used: ${e instanceof Error ? e.message : e}`),
    );
}

function remove(id: SlotId): void {
  const name = loaded[id]?.name ?? 'this file';
  if (window.confirm(`Remove ${name} from this session? The original file is not changed.`)) {
    removeFile(id);
    void forgetSlot(id);
  }
}

const rowMenu = (id: SlotId, canView: boolean): MenuItem[] => [
  ...(canView
    ? [{ kind: 'action', label: 'View data', onSelect: () => openEntry(id) } as MenuItem]
    : []),
  { kind: 'action', label: 'Replace file', onSelect: () => replace(id) },
  { kind: 'separator' },
  { kind: 'action', label: 'Remove file', danger: true, onSelect: () => remove(id) },
];

/** One data type. `sub` is a row inside the Neural activity group. */
function SlotRow(props: { id: SlotId; sub?: boolean }): JSX.Element {
  const s = () => slot(props.id);
  const f = () => facts(props.id);
  const st = () => (gone() ? { text: 'Missing', tone: 'fail' as const } : cardStatus(f()));
  const present = () => f().loaded || !!f().error;
  // A file the open project lists that is not at its recorded path any more.
  const gone = () => (present() ? undefined : missingFileOf(props.id));
  const description = () =>
    gone()
      ? `Missing: ${gone()!.name}, last seen at ${gone()!.last_seen_path ?? gone()!.path}`
      : present()
        ? rowDescription(s().label, f().level, f().loaded ? loaded[props.id]!.summary : undefined)
        : rowDescription(s().label, f().level, undefined, s().format);
  return (
    <div class="cb-sp-row" classList={{ 'cb-sp-row--sub': props.sub }}>
      <div class="cb-sp-row__main">
        <div class="cb-sp-row__file" title={loaded[props.id]?.name}>
          <span class="cb-sp-mono" classList={{ 'cb-sp-mono--empty': !present() && !gone() }}>
            {present() ? loaded[props.id]!.name : (gone()?.name ?? s().label)}
          </span>
          <Show when={props.sub && f().loaded}>
            <RoleTag slot={props.id} />
          </Show>
        </div>
        <div class="cb-sp-row__desc" title={description()}>
          {description()}
        </div>
      </div>
      <span class={`cb-sp-row__status cb-ds-tone--${st().tone}`} title={st().detail}>
        {st().text}
      </span>
      <span class="cb-sp-row__act">
        <Show
          when={present()}
          fallback={
            <button type="button" class="btn-secondary btn-small" onClick={() => replace(props.id)}>
              {gone() ? 'Locate file' : 'Load file'}
            </button>
          }
        >
          <ActionsMenu items={rowMenu(props.id, cardActions(f()).view)} />
        </Show>
      </span>
    </div>
  );
}

/** Raw, denoised and deconvolved: one group, in processing order. */
function ActivityGroup(): JSX.Element {
  const m = () => traceMatrix() ?? deconvolved();
  const n = () => ACTIVITY_SLOTS.filter(isLoaded).length;
  return (
    <section aria-label="Neural activity">
      <div class="cb-sp-group">
        <strong>Neural activity</strong>
        <RoleInfo />
        <span class="cb-muted">
          {n()} of 3 types
          <Show when={m()}>
            {' '}
            · {m()!.cells} cells × {m()!.frames.toLocaleString('en-US')} frames
          </Show>
        </span>
      </div>
      <For each={ACTIVITY_SLOTS}>{(id) => <SlotRow id={id} sub />}</For>
    </section>
  );
}

function Card(props: { title: string; ids: SlotId[]; children: JSX.Element }): JSX.Element {
  return (
    <section class="cb-sp-card" aria-label={props.title}>
      <header class="cb-sp-card__head">
        <h3>{props.title}</h3>
        <span class="cb-muted">
          {props.ids.filter(isLoaded).length} of {props.ids.length} loaded
        </span>
      </header>
      <div class="cb-sp-card__rows">{props.children}</div>
    </section>
  );
}

/** Experiment, arena, rates, duration, cells and the timestamp alignment, from what is loaded. */
export function SummaryCard(): JSX.Element {
  const timing = () => behaviorCategories().find((c) => c.id === 'timing')?.checks ?? [];
  const alignment = () => alignmentText(timing().map((c) => c.status));
  const cells = () => (traceMatrix() ?? deconvolved())?.cells;
  const zones = () => arena.zones.filter((z) => z.kind === 'zone').length;
  const items = (): [string, JSX.Element][] => [
    ['Experiment', experimentId() === 'custom' ? 'Not set' : experiment().label],
    ['Arena', arenaText(arena.shape, arena.width, arena.height, zones())],
    ['Miniscope', rateText(samplingRate())],
    ['Camera', rateText(override.cameraFps ?? derivedCameraFps())],
    ['Duration', durationText(sessionDuration())],
    ['Cells', cells() === undefined ? 'Not known' : cells()!.toLocaleString('en-US')],
    [
      'Timestamp alignment',
      <Show when={timing().length} fallback={<span class="cb-muted">{alignment().text}</span>}>
        <button
          type="button"
          class="cb-sp-sum__link"
          title="Open the alignment checks"
          onClick={() => openEntry('sync')}
        >
          <Pill tone={alignment().tone === 'ok' ? 'ok' : 'flag'}>{alignment().text}</Pill>
        </button>
      </Show>,
    ],
  ];
  return (
    <section class="cb-sp-sum" aria-label="Experimental summary">
      <header class="cb-sp-card__head">
        <h3>Experimental summary</h3>
        <InfoTip label="About the experimental summary">
          What CaBaNA knows about this session from the files and the experimental setup. Values
          that are not known yet come from loading the timestamp and neural files, or from the
          experimental setup.
        </InfoTip>
        <span class="cb-spacer" />
        <button type="button" class="btn-secondary btn-small" onClick={() => openEntry('config')}>
          Edit experiment details
        </button>
      </header>
      <dl class="cb-sp-sum__items">
        <For each={items()}>
          {([k, v]) => (
            <div>
              <dt class="sc">{k}</dt>
              <dd>{v}</dd>
            </div>
          )}
        </For>
      </dl>
    </section>
  );
}

/** The Neural data and Behavior data cards, side by side. */
export function DataCards(): JSX.Element {
  return (
    <div class="cb-sp-cards">
      <Card title="Neural data" ids={NEURAL}>
        <SlotRow id="neural_timestamps" />
        <ActivityGroup />
        <SlotRow id="footprints" />
      </Card>
      <Card title="Behavior data" ids={BEHAVIOR}>
        <For each={BEHAVIOR}>{(id) => <SlotRow id={id} />}</For>
      </Card>
    </div>
  );
}
