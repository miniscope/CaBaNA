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
import { flaggedOf } from './BehaviorQcAnnotations.tsx';
import { posOk, segments, timing } from './BehaviorQc.tsx';
import { pickTest } from './data-setup/FileQc.tsx';
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
export function ChecksRow(props: { onInputs?: (anchor: HTMLElement) => void }): JSX.Element {
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
    </div>
  );
}
