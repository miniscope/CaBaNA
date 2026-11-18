// The Changes drawer of Data visualization: everything in this session that alters the data the
// analyses read (Applied), and a log of every apply and undo (History). It reads the existing
// stores and calls their existing undo actions; nothing here computes or changes data itself.

import { createMemo, createRoot, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { history, lastApplied, type LogEvent } from '../lib/changes-log.ts';
import { buildChanges, changeCounts, type ChangeEntry } from '../lib/changes.ts';
import { openEntry } from '../lib/data-setup-view.ts';
import { choiceOf, jumpRows, setChoice } from '../lib/position-corrections.ts';
import { DEFAULT_PREP, prep } from '../lib/preprocess.ts';
import { gapSummary, setPrepStep } from '../lib/prep-view.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { goToAnalysis } from '../lib/results-overview.ts';
import { SLOTS, type SlotId } from '../lib/slots.ts';
import {
  annotationLog,
  goToStep,
  loaded,
  rejected,
  restoreCell,
  undoAnnotationEdits,
} from '../lib/store.ts';
import { segments } from './BehaviorQc.tsx';
import { UTabs } from './VizMenus.tsx';

export const [changesOpen, setChangesOpen] = createSignal(false);

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

/** Analyses whose newest saved result no longer matches the current data and settings. */
export const needRerun = () => ANALYSES.filter((a) => statusOfItem(a.id).kind === 'outdated');

const when = (ms: number | undefined) =>
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
  setPrepStep(a.step);
  openEntry(a.slot, 'prep');
}

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
  const of = (g: ChangeEntry['group']) => changes().filter((e) => e.group === g);
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
      <Show when={needRerun().length}>
        <div class="cb-chg__rerun">
          <div class="cb-chg__rerun-head">
            <span class="cb-chg__kind cb-chg__kind--flag">
              {needRerun().length} {needRerun().length === 1 ? 'result needs' : 'results need'} a
              rerun
            </span>
            <span class="cb-spacer" />
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => {
                setChangesOpen(false);
                goToStep('results');
              }}
            >
              Open Results
            </button>
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
      when={history().length}
      fallback={<p class="cb-muted">Nothing applied or undone in this window yet.</p>}
    >
      <ul class="cb-chg__list">
        <For each={[...history()].reverse()}>
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

type Tab = 'applied' | 'history';

export function ChangesDrawer(): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('applied');
  return (
    <Show when={changesOpen()}>
      <Modal
        label="Changes"
        title="Changes"
        side
        head={<span class="cb-muted">Applied in this session</span>}
        onClose={() => setChangesOpen(false)}
      >
        <UTabs
          label="Changes"
          tabs={[
            { id: 'applied', label: `Applied ${changes().length}` },
            { id: 'history', label: `History ${history().length}` },
          ]}
          value={tab()}
          onPick={setTab}
        />
        <Show when={tab() === 'applied'} fallback={<History />}>
          <Applied />
        </Show>
      </Modal>
    </Show>
  );
}

/** The chip's counts: entries applied, and results that need a rerun. */
export function changesSummary(): { applied: number; reruns: number } {
  const c = changeCounts(changes());
  return { applied: c.corrections + c.prep, reruns: needRerun().length };
}
