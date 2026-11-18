// The Checks row of Data visualization, and where each review opens. Every review opens the same
// file pop-up Data setup uses, at the file's QC step: corrections are made in one place.

import { For, Show, type JSX } from 'solid-js';
import { kernelChecks } from '../lib/decon-state.ts';
import { analysisSlot } from '../lib/analysis-data.ts';
import { openEntry } from '../lib/data-setup-view.ts';
import type { SlotId } from '../lib/slots.ts';
import {
  annotationResults,
  deconvolved,
  footprints,
  loaded,
  rejected,
  traceMatrix,
} from '../lib/store.ts';
import {
  behaviorParts,
  cellsParts,
  inputsParts,
  neuralParts,
  partsText,
  positionParts,
  type ChipId,
  type Part,
} from '../lib/viz-checks.ts';
import { changesOpen, changesSummary, setChangesOpen } from './ChangesDrawer.tsx';
import { flaggedOf } from './BehaviorQcAnnotations.tsx';
import { posOk, segments, timing } from './BehaviorQc.tsx';
import { pickTest } from './data-setup/FileQc.tsx';
import { Popover } from './Popover.tsx';
import { cellChecks, flaggedCells, overlapPairs } from './NeuralQcShared.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;
const fails = (c: { status: string }[]) => c.filter((x) => x.status === 'fail').length;

/** Open a file's pop-up at its QC step, on one of its tests when given. */
function openQc(slot: SlotId, test?: string): void {
  if (test) pickTest(slot, test);
  openEntry(slot, 'qc');
}

/** The file that holds the behavior annotations, else the zone annotations. */
const behaviorSlot = (): SlotId | undefined =>
  (['behavior_annotations', 'zone_annotations'] as SlotId[]).find(isLoaded);

/** What each review button and chip opens. Unavailable when the file it needs is not loaded. */
export const REVIEW: Record<ChipId | 'footprints' | 'arena', () => (() => void) | undefined> = {
  inputs: () => () => openEntry('sync'),
  cells: () => {
    const s = analysisSlot();
    if (s) return () => openQc(s, 'cells');
    return isLoaded('footprints') ? () => openQc('footprints') : undefined;
  },
  footprints: () => (isLoaded('footprints') ? () => openQc('footprints') : REVIEW.cells()),
  neural: () => {
    const s = analysisSlot();
    return s ? () => openQc(s, s === 'neural_deconvolved' ? 'decon' : 'cells') : undefined;
  },
  position: () => (isLoaded('position') ? () => openQc('position') : undefined),
  arena: () => (isLoaded('position') ? () => openEntry('position', 'arena') : undefined),
  behavior: () => {
    const s = behaviorSlot();
    return s ? () => openQc(s) : undefined;
  },
};

/** Each chip's counts, from the checks the QC tests already ran. */
export const PARTS: Record<ChipId, () => Part[]> = {
  inputs: () => inputsParts(timing()),
  cells: () =>
    traceMatrix() || footprints()
      ? cellsParts({
          flagged: flaggedCells().length,
          pairs: overlapPairs().length,
          rejected: rejected().size,
          failed: fails(cellChecks()),
        })
      : cellsParts(undefined),
  neural: () =>
    deconvolved()
      ? neuralParts(kernelChecks())
      : [{ text: traceMatrix() ? 'no deconvolved events' : 'not loaded', tone: 'muted' }],
  position: () => {
    const p = posOk();
    return positionParts(
      p && {
        failed: fails(p.checks),
        jumps: segments().filter((s) => s.kind === 'jump').length,
        gaps: segments().filter((s) => s.kind === 'lost').length,
      },
    );
  },
  behavior: () => {
    const files = annotationResults();
    return behaviorParts(
      files.length
        ? {
            failed: files.reduce((n, a) => n + (a.error ? 1 : fails(a.checks)), 0),
            epochs: files.reduce((n, a) => n + flaggedOf(a.id).length, 0),
            unpaired: files.reduce((n, a) => n + a.pairs.length, 0),
          }
        : undefined,
    );
  },
};

/** Counts in words, each colored by its tone. */
export function Parts(props: { parts: Part[] }): JSX.Element {
  return (
    <For each={props.parts}>
      {(p, i) => (
        <>
          <Show when={i() > 0}>{' · '}</Show>
          <span class={`cb-vtone--${p.tone}`}>{p.text}</span>
        </>
      )}
    </For>
  );
}

const CHIPS: { id: ChipId; name: string; what: string }[] = [
  { id: 'inputs', name: 'Inputs', what: 'timing and alignment checks' },
  { id: 'cells', name: 'Cells', what: 'cell checks' },
  { id: 'neural', name: 'Neural', what: 'neural data checks' },
  { id: 'position', name: 'Position', what: 'position checks' },
  { id: 'behavior', name: 'Behavior', what: 'behavior annotation checks' },
];

/**
 * One chip per kind of check, with its counts. A chip opens its review; `onInputs` replaces the
 * Inputs chip's action (an anchored list of the input checks).
 */
export function ChecksRow(props: {
  onInputs?: (anchor: HTMLElement) => void;
  inputsOpen?: boolean;
}): JSX.Element {
  return (
    <div class="cb-vchips" role="group" aria-label="Checks">
      <span class="sc cb-vchips__label">Checks</span>
      <For each={CHIPS}>
        {(c) => {
          const open = () => REVIEW[c.id]();
          return (
            <button
              type="button"
              class="cb-vchip"
              disabled={!open()}
              aria-haspopup={c.id === 'inputs' && props.onInputs ? 'dialog' : undefined}
              aria-expanded={c.id === 'inputs' && props.onInputs ? !!props.inputsOpen : undefined}
              title={open() ? `Review the ${c.what}` : `No file to review for the ${c.what}`}
              aria-label={`${c.name}: ${partsText(PARTS[c.id]())}`}
              onClick={(e) =>
                c.id === 'inputs' && props.onInputs ? props.onInputs(e.currentTarget) : open()?.()
              }
            >
              <span class="sc cb-vchip__k">{c.name}</span>
              <Parts parts={PARTS[c.id]()} />
            </button>
          );
        }}
      </For>
      <ChangesChip />
    </div>
  );
}

/** Opens the Changes drawer: corrections and settings applied, and results that need a rerun. */
function ChangesChip(): JSX.Element {
  const parts = (): Part[] => {
    const s = changesSummary();
    return [
      {
        text: s.applied ? `${s.applied} applied` : 'none applied',
        tone: s.applied ? 'ok' : 'muted',
      },
      ...(s.reruns
        ? [{ text: `${s.reruns} need${s.reruns === 1 ? 's' : ''} rerun`, tone: 'flag' as const }]
        : []),
    ];
  };
  return (
    <button
      type="button"
      class="cb-vchip cb-vchip--end"
      aria-haspopup="dialog"
      aria-expanded={changesOpen()}
      title="Corrections and preprocessing applied in this session, and their history"
      aria-label={`Changes: ${partsText(parts())}`}
      onClick={() => setChangesOpen(!changesOpen())}
    >
      <span class="sc cb-vchip__k">Changes</span>
      <Parts parts={parts()} />
    </button>
  );
}

const WORD = { pass: 'Passed', warn: 'Warning', fail: 'Failed' } as const;

/**
 * The timing and alignment checks as rows, anchored under the Inputs chip: status in words, the
 * check, and its numbers against the limit. Rows with a problem open the timestamp alignment
 * pop-up, where the plots and the fix are.
 */
export function InputsPop(props: { anchor: HTMLElement; onClose: () => void }): JSX.Element {
  const review = () => {
    props.onClose();
    openEntry('sync');
  };
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} width={540} label="Input checks">
      <div class="cb-pop__head cb-inchk__head">
        <strong>Input checks</strong>
        <span class="cb-muted">Run when files load. Nothing here changes data.</span>
        <span class="cb-spacer" />
        <button type="button" class="btn-secondary btn-small" onClick={() => props.onClose()}>
          Close
        </button>
      </div>
      <Show
        when={timing().length}
        fallback={
          <p class="cb-muted">
            The timing and alignment checks run once the miniscope or behavior camera timestamps
            load.
          </p>
        }
      >
        <ul class="cb-inchk">
          <For each={timing()}>
            {(c) => (
              <li>
                <span class={`cb-qres cb-qres--${c.status}`}>{WORD[c.status]}</span>
                <div class="cb-inchk__text">
                  <b>{c.title}</b>
                  <span class="cb-muted">
                    {[c.value, c.limit].filter(Boolean).join(' · ') || c.detail}
                  </span>
                </div>
                <Show when={c.status !== 'pass'}>
                  <button type="button" class="btn-secondary btn-small" onClick={review}>
                    Review
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="cb-inchk__foot">
        <span class="cb-muted">
          Dropped frames, frame-time jitter and clock alignment, from the timestamp files.
        </span>
        <button type="button" class="cb-link" onClick={review}>
          Timestamp alignment
        </button>
      </div>
    </Popover>
  );
}
