// Which neural file is the analysis data: the one file the analyses read, saved to config.yaml as
// `neural.file` and `neural.kind`. The other loaded neural files are reference data, written under
// `neural.alternatives`; CaBaNA uses them to check the analysis data but does not analyze them.

import { createSignal } from 'solid-js';
import type { SlotId } from './slots.ts';
import { loaded, onClear, sessionName } from './store.ts';

export type NeuralKind = 'deconvolved' | 'denoised' | 'raw';

/** The neural layers in the framework's words, in the order they are preferred. */
export const NEURAL_LAYERS: readonly { kind: NeuralKind; slot: SlotId; label: string }[] = [
  { kind: 'deconvolved', slot: 'neural_deconvolved', label: 'Deconvolved events' },
  { kind: 'denoised', slot: 'neural_denoised', label: 'Denoised traces' },
  { kind: 'raw', slot: 'neural_raw', label: 'Raw traces' },
];

const isLoaded = (slot: SlotId) => !!loaded[slot]?.summary && !!loaded[slot]!.size;

/** The neural layers that are loaded, in order. */
export const loadedLayers = () => NEURAL_LAYERS.filter((l) => isLoaded(l.slot));

const [chosen, setChosen] = createSignal<NeuralKind>();
onClear(() => setChosen(undefined));

/** The analysis data: the chosen layer when it is loaded, else the first loaded layer. */
export function analysisKind(): NeuralKind | undefined {
  const layers = loadedLayers();
  return (layers.find((l) => l.kind === chosen()) ?? layers[0])?.kind;
}

export const analysisSlot = (): SlotId | undefined =>
  NEURAL_LAYERS.find((l) => l.kind === analysisKind())?.slot;

/** Make a layer the analysis data. Kept even before that file loads, as a config asks. */
export function setAnalysisData(kind: NeuralKind): void {
  setChosen(kind);
}

/** A loaded neural layer that is not the analysis data. */
export const isReference = (slot: SlotId): boolean =>
  slot !== analysisSlot() && NEURAL_LAYERS.some((l) => l.slot === slot) && isLoaded(slot);

export const isNeuralKind = (k: unknown): k is NeuralKind =>
  NEURAL_LAYERS.some((l) => l.kind === k);

// QC of reference data is off at first. Turning it on only shows checks that already run; it is
// remembered per file and dataset (by the session name) in this browser.
const REF_QC_KEY = 'cabana.referenceQc';

function readRefQc(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(REF_QC_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
const [refQc, setRefQc] = createSignal(readRefQc());
const refKey = (slot: SlotId) => `${sessionName() ?? ''}|${slot}`;

/** Whether a file's QC section shows its checks: always for the analysis data. */
export const qcShown = (slot: SlotId): boolean => !isReference(slot) || !!refQc()[refKey(slot)];

export function setReferenceQc(slot: SlotId, on: boolean): void {
  const next = { ...refQc() };
  if (on) next[refKey(slot)] = true;
  else delete next[refKey(slot)];
  setRefQc(next);
  try {
    localStorage.setItem(REF_QC_KEY, JSON.stringify(next));
  } catch {
    // not remembered
  }
}
