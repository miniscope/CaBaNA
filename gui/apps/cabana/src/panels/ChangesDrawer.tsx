// The Changes drawer of Data visualization: everything in this session that alters the data the
// analyses read (Applied), and a log of every apply and undo (History). It reads the existing
// stores and calls their existing undo actions; nothing here computes or changes data itself.

import { createMemo, createRoot, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { history, lastApplied, type LogEvent } from '../lib/changes-log.ts';
import { buildChanges, changeCounts, type ChangeEntry } from '../lib/changes.ts';
import { openPrepPopup, prepPopupFor } from '../lib/qc-popup-view.ts';
import { choiceOf, jumpRows, setChoice } from '../lib/position-corrections.ts';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { STEPS, type StepId } from '../lib/prep-deps.ts';
import { fs, gapSummary } from '../lib/prep-view.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { analysesNeedingRerun } from '../lib/rerun-needed.ts';
import { openExplorer } from '../lib/results-nav.ts';
import { goToAnalysis } from '../lib/results-overview.ts';
import { SLOTS, type SlotId } from '../lib/slots.ts';
import { upstreamItems } from '../lib/upstream.ts';
import { BOX_TITLE, forBox, type VizBox } from '../lib/viz-pills.ts';
import {
  annotationLog,
  loaded,
  alignmentResults,
  rejected,
  restoreCell,
  timingResults,
  undoAnnotationEdits,
} from '../lib/store.ts';
import { segments } from './BehaviorQc.tsx';
import { footprintCheckList } from './NeuralQcShared.tsx';

export const [changesOpen, setChangesOpen] = createSignal(false);
/** The box whose changes the drawer lists; all of them when none. */
export const [changesBox, setChangesBox] = createSignal<VizBox | undefined>();

/** Open the drawer for one box's data, or for all of it. */
export function openChanges(box?: VizBox): void {
  setChangesBox(box);
  setChangesOpen(true);
}

/** Small underlined tabs. */
function UTabs<T extends string>(props: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}): JSX.Element {
  return (
    <div class="cb-utabs" role="tablist" aria-label={props.label}>
      <For each={props.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === t.id}
            classList={{ 'cb-utabs--on': props.value === t.id }}
            onClick={() => props.onPick(t.id)}
          >
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** Position jumps whose frames are left out, in session order. */
const leftOut = createRoot(() =>
  createMemo(() => segments().filter((s) => s.kind === 'jump' && choiceOf(s) === 'interpolate')),
);

/** The Applied list, from the stores as they are now. */
export const changes = createRoot(() =>
  createMemo(() =>
    buildChanges({
      rejected: [...rejected()],
      jumps: leftOut().map((s) => ({ first: s.first, start: s.start, frames: jumpRows(s).length })),
      annotationFixes: annotationLog(),
      prep: { ...prep },
      defaults: DEFAULT_PREP,
      loaded: isLoaded,
      filledFrames:
        prep.fillGapS !== DEFAULT_PREP.fillGapS && isLoaded('position')
          ? gapSummary().filled.frames
          : undefined,
    }),
  ),
);

/** The Applied list for the box the drawer was opened from, or all of it. */
const shownChanges = () => (changesBox() ? forBox(changes(), changesBox()!) : changes());
const shownHistory = () =>
  changesBox()
    ? history().filter((e) => e.refs.some((r) => forBox([{ ref: r }], changesBox()!).length))
    : history();

/** Analyses whose newest saved result no longer matches the current data and settings. */
export const needRerun = () =>
  ANALYSES.filter(
    (a) => statusOfItem(a.id).kind === 'outdated' || analysesNeedingRerun().includes(a.id),
  );

export const when = (ms: number | undefined) =>
  ms === undefined
    ? ''
    : new Date(ms).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });

function act(e: ChangeEntry): void {
  const a = e.action;
  if (!a) return;
  if ('undo' in a) {
    if (a.undo === 'cell') restoreCell(a.cell);
    else if (a.undo === 'jump') {
      const s = leftOut()[a.index];
      if (s) setChoice(s, undefined);
    } else undoAnnotationEdits();
    return;
  }
  setChangesOpen(false);
  if (a.edit === 'analysis') return goToAnalysis(a.analysis);
  const popup = prepPopupFor(a.step);
  if (popup) openPrepPopup(popup);
}

/**
 * Revert entries of the Applied list with the same actions as Undo (corrections) and restoring the
 * defaults of a step's settings (what Reset does on Preprocess). Jumps go last to first, since
 * undoing one renumbers the ones after it.
 */
export function revertEntries(entries: ChangeEntry[]): void {
  const undo = (kind: string) =>
    entries.filter((e) => e.action && 'undo' in e.action && e.action.undo === kind);
  for (const e of undo('cell')) act(e);
  for (const e of undo('jump').sort((a, b) => jumpIndex(b) - jumpIndex(a))) act(e);
  for (const e of undo('annotations')) act(e);
  for (const e of entries) {
    if (!e.ref.startsWith('prep:')) continue;
    for (const k of STEPS[e.ref.slice(5) as StepId].keys) setPrep(k, DEFAULT_PREP[k]);
  }
}
const jumpIndex = (e: ChangeEntry) =>
  e.action && 'undo' in e.action && e.action.undo === 'jump' ? e.action.index : -1;

const KIND = { correction: 'Correction', prep: 'Preprocessing' } as const;

function Entry(props: { e: ChangeEntry }): JSX.Element {
  const isUndo = () => !!props.e.action && 'undo' in props.e.action;
  return (
    <li class="cb-chg">
      <span class={`cb-chg__kind cb-chg__kind--${props.e.group}`}>{KIND[props.e.group]}</span>
      <div class="cb-chg__text">
        <span>
          <b>{props.e.what}</b> · <span class="cb-muted">{props.e.detail}</span>
        </span>
        <span class="cb-chg__meta">
          {[props.e.touches, when(lastApplied(props.e.ref))].filter(Boolean).join(' · ')}
        </span>
      </div>
      <Show when={props.e.action}>
        <button
          type="button"
          class="btn-secondary btn-small"
          disabled={!!props.e.blocked}
          title={props.e.blocked ?? (isUndo() ? 'Undo this correction' : 'Open its settings')}
          onClick={() => act(props.e)}
        >
          {isUndo() ? 'Undo' : 'Edit'}
        </button>
      </Show>
    </li>
  );
}

function Group(props: { title: string; entries: ChangeEntry[]; empty: string }): JSX.Element {
  return (
    <section class="cb-chg__group">
      <div class="sc">{props.title}</div>
      <Show when={props.entries.length} fallback={<p class="cb-muted">{props.empty}</p>}>
        <ul class="cb-chg__list">
          <For each={props.entries}>{(e) => <Entry e={e} />}</For>
        </ul>
      </Show>
    </section>
  );
}

function Applied(): JSX.Element {
  const files = () =>
    SLOTS.filter((s) => s.id !== 'config' && isLoaded(s.id)).map((s) => loaded[s.id]!.name);
  const of = (g: ChangeEntry['group']) => shownChanges().filter((e) => e.group === g);
  return (
    <>
      <div class="cb-chg__orig">
        <b>Original files unchanged.</b>{' '}
        <span class="cb-muted">
          {files().length
            ? `${files().join(', ')} ${files().length === 1 ? 'is' : 'are'} only read. `
            : ''}
          Corrections and settings are applied to the data in this window.
        </span>
      </div>
      <Show when={needRerun().length}>
        <div class="cb-chg__rerun">
          <div class="cb-chg__rerun-head">
            <span class="cb-chg__kind cb-chg__kind--flag">
              {needRerun().length} {needRerun().length === 1 ? 'result needs' : 'results need'} a
              rerun
            </span>
            <span class="cb-spacer" />
            <For each={needRerun()}>
              {(a) => (
                <button
                  type="button"
                  class="btn-secondary btn-small"
                  onClick={() => {
                    setChangesOpen(false);
                    openExplorer(a.id);
                  }}
                >
                  View {a.label} results
                </button>
              )}
            </For>
          </div>
          <p class="cb-muted">
            {needRerun()
              .map((a) => a.label)
              .join(' · ')}
            : the newest saved result used other data or settings. Older results stay saved with the
            settings they used.
          </p>
        </div>
      </Show>
      <Group
        title="Corrections"
        entries={of('correction')}
        empty="No corrections: no cells rejected, no position frames left out, no annotation fixes."
      />
      <Group
        title="Preprocessing"
        entries={of('prep')}
        empty="All preprocessing settings are at their defaults."
      />
    </>
  );
}

const ACTION_WORD: Record<LogEvent['action'], string> = {
  apply: 'Applied',
  undo: 'Undone',
  change: 'Changed',
};

function History(): JSX.Element {
  return (
    <Show
      when={shownHistory().length}
      fallback={<p class="cb-muted">Nothing applied or undone in this window yet.</p>}
    >
      <ul class="cb-chg__list">
        <For each={[...shownHistory()].reverse()}>
          {(e) => (
            <li class="cb-chg">
              <span class={`cb-chg__kind cb-chg__kind--${e.group}`}>{ACTION_WORD[e.action]}</span>
              <div class="cb-chg__text">
                <span>{e.text}</span>
                <span class="cb-chg__meta">{when(e.at)}</span>
              </div>
            </li>
          )}
        </For>
      </ul>
      <p class="cb-muted cb-chg__foot">
        Kept for this window only; it starts again when the session is closed.
      </p>
    </Show>
  );
}

/** Findings no correction here can repair, from the existing QC results. */
export const upstream = createRoot(() =>
  createMemo(() => {
    const overlap = footprintCheckList().find((c) => c.id === 'fp-overlap');
    const long = isLoaded('position') ? gapSummary().long : undefined;
    return upstreamItems({
      timing: timingResults().map((r) => ({
        name: r.name,
        nDropped: r.nDropped,
        droppedFraction: r.droppedFraction,
        gaps: r.gapStart.length,
      })),
      alignment: alignmentResults(),
      longGaps: long && { ...long, fillLimitS: prep.fillGapS, fps: fs() },
      overlap: overlap && { status: overlap.status, pairs: overlap.pairs?.length ?? 0 },
    });
  }),
);

function Upstream(): JSX.Element {
  return (
    <>
      <p class="cb-muted cb-chg__intro">
        Problems in the files themselves, found by the checks. Corrections here cannot repair them;
        they are listed so they can be passed on to whoever exports, tracks or extracts the data.
      </p>
      <Show when={upstream().length} fallback={<p class="cb-muted">No upstream problems found.</p>}>
        <ul class="cb-chg__list">
          <For each={upstream()}>
            {(u) => (
              <li class="cb-chg">
                <span class="cb-chg__kind cb-chg__kind--flag">{u.source}</span>
                <div class="cb-chg__text">
                  <span>
                    <b>{u.what}</b> · <span class="cb-muted">{u.detail}</span>
                  </span>
                  <span class="cb-chg__meta">Fix: {u.fixWhere}</span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}

type Tab = 'applied' | 'history' | 'upstream';

export function ChangesDrawer(): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('applied');
  return (
    <Show when={changesOpen()}>
      <Modal
        label="Changes"
        title="Changes"
        side
        head={
          <span class="cb-muted">
            {changesBox() ? BOX_TITLE[changesBox()!] : 'Applied in this session'}
          </span>
        }
        onClose={() => setChangesOpen(false)}
      >
        <Show when={changesBox()}>
          <p class="cb-muted cb-chg__intro">
            Showing the changes to {BOX_TITLE[changesBox()!].toLowerCase()}.{' '}
            <button type="button" class="cb-link" onClick={() => setChangesBox()}>
              Show all changes
            </button>
          </p>
        </Show>
        <UTabs
          label="Changes"
          tabs={[
            { id: 'applied', label: `Applied ${shownChanges().length}` },
            { id: 'history', label: `History ${shownHistory().length}` },
            { id: 'upstream', label: `Upstream ${upstream().length}` },
          ]}
          value={tab()}
          onPick={setTab}
        />
        <Show when={tab() === 'applied'}>
          <Applied />
        </Show>
        <Show when={tab() === 'history'}>
          <History />
        </Show>
        <Show when={tab() === 'upstream'}>
          <Upstream />
        </Show>
      </Modal>
    </Show>
  );
}

/** Applied corrections and settings, and results that need a rerun: the toolbar's Change history count. */
export function changesSummary(): { applied: number; reruns: number } {
  const c = changeCounts(changes());
  return { applied: c.corrections + c.prep, reruns: needRerun().length };
}
