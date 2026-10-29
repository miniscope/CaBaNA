// The Experimental Setup cards: each one's priority and its status (Empty, Incomplete or Complete),
// worked out from the real settings, whether typed or read from a config file. Defaults and
// placeholders do not count as entered. Status says how much of what a section needs is present;
// the priority (Required, Recommended) is separate.

import { createSignal } from 'solid-js';
import { arena, pxPerCm } from './arena.ts';
import {
  derivedCameraFps,
  derivedDuration,
  derivedNeuralFps,
  experimentId,
  labelRegistry,
  override,
  sessionName,
  source,
} from './store.ts';

export type CardId = 'experiment' | 'session' | 'spatial' | 'tracking' | 'stimuli' | 'neural';
export type Status = 'Empty' | 'Incomplete' | 'Complete';

export const CARDS: { id: CardId; title: string; priority: 'Required' | 'Recommended' }[] = [
  { id: 'experiment', title: 'Experiment & subjects', priority: 'Recommended' },
  { id: 'session', title: 'Session structure', priority: 'Recommended' },
  { id: 'spatial', title: 'Spatial setup', priority: 'Required' },
  { id: 'tracking', title: 'Tracking & coordinates', priority: 'Recommended' },
  { id: 'stimuli', title: 'Stimuli & cues', priority: 'Recommended' },
  { id: 'neural', title: 'Neural acquisition', priority: 'Recommended' },
];

/** The card shown below the cards. Shared so a warning elsewhere can open its section. */
export const [setupCard, setSetupCard] = createSignal<CardId>('experiment');

/** Everything the rules read, as plain values. */
export interface SetupSnapshot {
  paradigmChosen: boolean;
  sessionName: string;
  sessionDate: string;
  subjectId: string;
  species: string;
  brainRegion: string;
  group: string;
  notes: string;
  /** Values from the timestamp files or typed over them; undefined when not available. */
  durationS?: number;
  neuralFps?: number;
  cameraFps?: number;
  clockOffsetS: number;
  clockScale: number;
  /** Picture pixels per cm, once the arena outline or the scale line is drawn. */
  pxPerCm?: number;
  arenaDrawn: boolean;
  zones: number;
  bodyLine: boolean;
  bodyPart: string;
  likelihoodMin?: number;
  positionTool: string;
  positionUnit: 'cm' | 'px';
  yDown: boolean;
  pxPerCmEntered: number;
  headOffset: number;
  annotationTool: string;
  annotationUnit: string;
  stimuli: { name: string; label?: string; durationS?: number }[];
  /** Names of the labels loaded from annotation, marker and frame-label files. */
  loadedLabels?: string[];
  device: string;
  extractionTool: string;
  deconTool: string;
}

const filled = (s: string | undefined) => !!s?.trim();
const positive = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v > 0;

/**
 * The rules, one per card. A card is Complete when everything it needs is present and valid,
 * Empty when nothing in it has been entered, and Incomplete in between.
 * - Experiment & subjects: needs subject ID, species and brain region. Session name, date, group,
 *   notes, the paradigm and the indicator are optional.
 * - Session structure: needs a duration, a miniscope frame rate and a camera frame rate, from the
 *   timestamp files or typed, all above 0, and a clock scale above 0. The clock offset is optional.
 * - Spatial setup: needs the arena outline or the scale line drawn, so pixels convert to cm.
 *   Zones, the body line and the bin size are optional. The default shape and 40 cm size do not count.
 * - Tracking & coordinates: needs the body part tracked, a pixels-per-cm above 0 when positions are
 *   in pixels, and a likelihood threshold between 0 and 1 when one is given. The default units,
 *   tools and annotation units do not count; the tool choices only change export advice.
 * - Stimuli & cues: needs at least one stimulus, every stimulus named with a loaded label chosen,
 *   any length 0 or more. An experiment with no stimuli stays Empty, which is fine for a recommended card.
 * - Neural acquisition: needs the miniscope. The extraction and deconvolution tools are optional.
 */
export function statusOf(id: CardId, s: SetupSnapshot): Status {
  const grade = (entered: boolean, complete: boolean): Status =>
    complete ? 'Complete' : entered ? 'Incomplete' : 'Empty';
  switch (id) {
    case 'experiment': {
      const need = [s.subjectId, s.species, s.brainRegion].every(filled);
      const any =
        s.paradigmChosen ||
        [
          s.sessionName,
          s.sessionDate,
          s.subjectId,
          s.species,
          s.brainRegion,
          s.group,
          s.notes,
        ].some(filled);
      return grade(any, need);
    }
    case 'session': {
      const rates = [s.durationS, s.neuralFps, s.cameraFps];
      const any = rates.some((v) => v !== undefined) || s.clockOffsetS !== 0 || s.clockScale !== 1;
      return grade(any, rates.every(positive) && positive(s.clockScale));
    }
    case 'spatial': {
      const any = s.arenaDrawn || s.zones > 0 || s.bodyLine;
      return grade(any, positive(s.pxPerCm));
    }
    case 'tracking': {
      const any =
        filled(s.bodyPart) ||
        s.likelihoodMin !== undefined ||
        s.positionTool !== 'other' ||
        s.positionUnit !== 'cm' ||
        s.yDown ||
        s.headOffset !== 0 ||
        s.annotationTool !== 'other' ||
        s.annotationUnit !== 'seconds';
      const likelihoodOk =
        s.likelihoodMin === undefined || (s.likelihoodMin >= 0 && s.likelihoodMin <= 1);
      const scaleOk = s.positionUnit !== 'px' || positive(s.pxPerCmEntered);
      return grade(any, filled(s.bodyPart) && likelihoodOk && scaleOk);
    }
    case 'stimuli': {
      const named = s.stimuli.every((x) => filled(x.name));
      const lengthsOk = s.stimuli.every((x) => x.durationS === undefined || x.durationS >= 0);
      const labeled = stimulusLabelIssues(s).length === 0;
      return grade(s.stimuli.length > 0, s.stimuli.length > 0 && named && lengthsOk && labeled);
    }
    case 'neural': {
      const any = filled(s.device) || s.extractionTool !== 'other' || s.deconTool !== 'other';
      return grade(any, filled(s.device));
    }
  }
}

/**
 * Stimuli whose label is empty or not loaded, in words. A missing label does not block unrelated
 * analyses: only one that would use the stimulus (such as PETH aligned to it) needs it.
 */
export function stimulusLabelIssues(s: Pick<SetupSnapshot, 'stimuli' | 'loadedLabels'>) {
  const loadedLabels = s.loadedLabels ?? [];
  return s.stimuli.flatMap((x, index) => {
    const label = x.label?.trim();
    if (!label) return [{ index, name: x.name, label: '', message: 'Choose a label' }];
    if (!loadedLabels.includes(label))
      return [{ index, name: x.name, label, message: `Missing label ${label}` }];
    return [];
  });
}

/** The settings as they are now. */
export function setupSnapshot(): SetupSnapshot {
  return {
    paradigmChosen: experimentId() !== 'custom',
    sessionName: sessionName() ?? '',
    sessionDate: source.sessionDate,
    subjectId: source.subjectId,
    species: source.species,
    brainRegion: source.brainRegion,
    group: source.group,
    notes: source.notes,
    durationS: override.durationS ?? derivedDuration(),
    neuralFps: override.neuralFps ?? derivedNeuralFps(),
    cameraFps: override.cameraFps ?? derivedCameraFps(),
    clockOffsetS: source.clockOffsetS,
    clockScale: source.clockScale,
    pxPerCm: pxPerCm(),
    arenaDrawn: !!arena.box || !!arena.line,
    zones: arena.zones.length,
    bodyLine: !!arena.bodyLine,
    bodyPart: source.bodyPart,
    likelihoodMin: source.likelihoodMin,
    positionTool: source.positionTool,
    positionUnit: source.positionUnit,
    yDown: source.yDown,
    pxPerCmEntered: source.pxPerCm,
    headOffset: arena.headOffset,
    annotationTool: source.annotationTool,
    annotationUnit: source.annotationUnit,
    stimuli: source.stimuli.map((x) => ({ name: x.name, label: x.label, durationS: x.durationS })),
    loadedLabels: labelRegistry().map((e) => e.name),
    device: source.device,
    extractionTool: source.extractionTool,
    deconTool: source.deconTool,
  };
}
