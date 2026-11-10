// Which sections each data type has on the Data setup page. Every loaded file opens on its
// Overview; QC, Preprocess and Arena and zones appear only for the data types they apply to.
// Add a new data type here and in slots.ts.

import type { SlotId } from './slots.ts';

export type SectionId = 'overview' | 'arena' | 'qc' | 'prep';

export const SECTION_TITLE: Record<SectionId, string> = {
  overview: 'Overview',
  arena: 'Arena and zones',
  qc: 'QC',
  prep: 'Preprocess',
};

/** Sections per data type, in stepper order. A data type left out has only an Overview. */
const SECTIONS: Partial<Record<SlotId, SectionId[]>> = {
  neural_deconvolved: ['overview', 'qc', 'prep'],
  neural_denoised: ['overview', 'qc', 'prep'],
  neural_raw: ['overview', 'qc'],
  footprints: ['overview', 'qc'],
  position: ['overview', 'arena', 'qc', 'prep'],
  zone_annotations: ['overview', 'qc', 'prep'],
  behavior_annotations: ['overview', 'qc', 'prep'],
};

export const sectionsFor = (slot: SlotId): SectionId[] => SECTIONS[slot] ?? ['overview'];
