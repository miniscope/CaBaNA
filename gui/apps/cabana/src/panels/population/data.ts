// What the Population setup reads from the loaded data: kept cells, time bins per label and the
// inputs each method needs. Counts are a preview for display; the framework does the real work.

import { createEffect, createMemo, createSignal } from 'solid-js';
import { behaviorFrames } from '../../lib/auroc.ts';
import { arena } from '../../lib/arena.ts';
import { populationContext } from '../../lib/analysis-registry.ts';
import { populationSettings, setPopulationSettings } from '../../lib/population-settings.ts';
import { positionIssue } from '../../lib/prepared.ts';
import {
  annotationResults,
  deconvolved,
  frameTimes,
  labelRegistry,
  rejected,
  samplingRate,
} from '../../lib/store.ts';
import { populationProblems } from '../../lib/spec/population.ts';
import {
  labelReason,
  labelRow,
  framesPerBlock,
  binsOf,
  methodReadiness,
  type LabelRow,
} from './logic.ts';
import { POPULATION_METHODS } from '../../lib/population-settings.ts';

const SLOT = { behaviors: 'behavior_annotations', zones: 'zone_annotations' } as const;

/** Cells in the recording, kept cells after QC rejection, and the neural frame rate. */
export const neuralSummary = createMemo(() => {
  const m = deconvolved();
  const fs = samplingRate();
  if (!m) return undefined;
  const kept = m.cells - [...rejected()].filter((c) => c < m.cells).length;
  return { total: m.cells, kept, frames: m.frames, fs };
});

/** Labels the user switched off, per target. The settings hold the resulting list. */
const [off, setOff] = createSignal<Record<string, string[]>>({});
export const isOff = (name: string) => (off()[populationSettings.target] ?? []).includes(name);
export function toggleLabel(name: string): void {
  const t = populationSettings.target;
  const now = off()[t] ?? [];
  setOff({ ...off(), [t]: now.includes(name) ? now.filter((n) => n !== name) : [...now, name] });
}

/** Label rows of the chosen target; empty for position bins. */
export const labelRows = createMemo<LabelRow[]>(() => {
  const target = populationSettings.target;
  if (target === 'position') return [];
  const t = frameTimes();
  const fs = samplingRate();
  const ann = annotationResults().find((r) => r.id === SLOT[target]);
  if (!t || !fs || !ann || ann.error) return [];
  const names = [...new Set(ann.epochs.map((e) => e.label))];
  const registry = labelRegistry().filter((e) => e.slot === SLOT[target]);
  const blocks = populationSettings.stabilityBlocks;
  return names.map((name) => {
    const mask = behaviorFrames(ann.epochs, [name], t);
    return labelRow(name, registry, framesPerBlock(mask, blocks), fs, populationSettings.binS);
  });
});

export const reasonOf = (row: LabelRow) => labelReason(row, populationSettings);
/** Labels that will run: usable and not switched off. */
export const selectedLabels = createMemo(() =>
  labelRows()
    .filter((r) => !reasonOf(r) && !isOff(r.name))
    .map((r) => r.name),
);

/**
 * Keeps `populationSettings.labels` equal to the labels that will run. An empty list means every
 * label, used only when all of them are usable and none is switched off.
 */
export function syncLabels(): void {
  createEffect(() => {
    const rows = labelRows();
    if (!rows.length) return;
    const chosen = selectedLabels();
    const next = chosen.length === rows.length ? [] : chosen;
    if (JSON.stringify(next) !== JSON.stringify(populationSettings.labels))
      setPopulationSettings('labels', next);
  });
}

/** States that will be compared; undefined for position bins (the bins come from the arena). */
export const stateCount = createMemo(() =>
  populationSettings.target === 'position' ? undefined : selectedLabels().length,
);

const totalBins = createMemo(() => {
  const n = neuralSummary();
  return n?.fs ? binsOf(n.frames, n.fs, populationSettings.binS) : 0;
});

export const readiness = createMemo(() => {
  const n = neuralSummary();
  const ctx = {
    rows: labelRows(),
    selected: selectedLabels(),
    nCells: n?.kept ?? 0,
    totalBins: totalBins(),
    hasArena: !!arena.box,
    hasPosition: !positionIssue(true),
  };
  return Object.fromEntries(
    POPULATION_METHODS.map((m) => [m.id, methodReadiness(m.id, populationSettings, ctx)]),
  ) as Record<(typeof POPULATION_METHODS)[number]['id'], ReturnType<typeof methodReadiness>>;
});

/** Problems that apply to the whole run, from the pipeline builder. */
export const runProblems = createMemo(() =>
  populationProblems(populationSettings, populationContext()),
);

/** Switches off the labels of `target` that a saved selection does not contain (empty = all on). */
export function setOffLabels(target: string, saved: string[], all: Record<string, string[]>): void {
  setOff({
    ...off(),
    [target]: saved.length ? (all[target] ?? []).filter((l) => !saved.includes(l)) : [],
  });
}
