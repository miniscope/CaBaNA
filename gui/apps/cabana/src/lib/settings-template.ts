// Settings carried from one dataset to another, only when the user applies them. Each dataset's
// settings are kept in this browser under its session name; applying copies the chosen groups.
// Geometry, clock alignment and label selections belong to one recording and are never copied.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { arena, setArena } from './arena.ts';
import { aurocSettings, setAurocSettings } from './auroc-run.ts';
import {
  indicatorId,
  setIndicator,
  setTauDecay,
  setTauRise,
  tauDecay,
  tauRise,
} from './decon-state.ts';
import {
  behaviorDecoding,
  decodeTarget,
  positionDecoding,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
} from './decoding-settings.ts';
import { pethSettings, setPethSettings } from './peth-run.ts';
import { placeSettings, setPlaceSettings } from './place-run.ts';
import { populationSettings, setPopulationSettings } from './population-settings.ts';
import { prep, setPrep } from './preprocess.ts';
import {
  experimentId,
  loaded,
  maxSpeed,
  sessionName,
  setExperiment,
  setMaxSpeed,
  setSource,
  setTol,
  source,
  tol,
} from './store.ts';

export type GroupId = 'setup' | 'prep' | 'qc' | 'analyses';

/** What each group copies, and what it leaves alone, in the words shown to the user. */
export const TEMPLATE_GROUPS: { id: GroupId; label: string; copies: string; skips?: string }[] = [
  {
    id: 'setup',
    label: 'Experimental setup',
    copies:
      'experiment type, tools, position units and y direction, body part, species, brain region, device, annotation units',
    skips: 'clock offset and scale, session date, subject, group, notes, stimuli',
  },
  {
    id: 'prep',
    label: 'Preprocess',
    copies:
      'every preprocessing setting, and the indicator and time constants of the deconvolution check',
  },
  { id: 'qc', label: 'QC limits', copies: 'pass/fail limits and the jump threshold' },
  {
    id: 'analyses',
    label: 'Analysis settings',
    copies:
      'place cells, auROC, PETH, population and decoding settings; spatial bin size and minimum occupancy',
    skips: 'behavior and label selections, which depend on the data',
  },
];

const SETUP_FIELDS = [
  'device',
  'bodyPart',
  'species',
  'brainRegion',
  'positionTool',
  'positionUnit',
  'yDown',
  'annotationTool',
  'annotationUnit',
  'extractionTool',
  'deconTool',
] as const;

// Store values are proxies, which structuredClone refuses; the settings are plain JSON.
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const omit = <T extends object>(o: T, keys: string[]) =>
  Object.fromEntries(Object.entries(copy(o)).filter(([k]) => !keys.includes(k)));

/** The current settings, by group. */
export function captureSettings(): Record<GroupId, Record<string, unknown>> {
  return {
    setup: {
      experiment: experimentId(),
      ...Object.fromEntries(SETUP_FIELDS.map((k) => [k, source[k]])),
    },
    prep: {
      prep: copy(prep),
      decon: { indicator: indicatorId(), tauRise: tauRise(), tauDecay: tauDecay() },
    },
    qc: { tol: copy(tol), maxSpeed: maxSpeed() },
    analyses: {
      place: copy(placeSettings),
      auroc: omit(aurocSettings, ['unselected', 'pairA', 'pairB']),
      peth: omit(pethSettings, ['unselected']),
      population: omit(populationSettings, ['labels']),
      positionDecoding: copy(positionDecoding),
      behaviorDecoding: omit(behaviorDecoding, ['labels']),
      decodeTarget: decodeTarget.type,
      binCm: arena.binCm,
      minOccupancy: arena.minOccupancy,
    },
  };
}

type Captured = ReturnType<typeof captureSettings>;
// Settings saved by an older GUI may lack fields; the stores keep their current value for those.
type Saved = { [G in GroupId]?: Partial<Captured[G]> & Record<string, unknown> };

/** Copy the chosen groups of `saved` into the current settings. */
export function applySettings(saved: Saved, groups: GroupId[]): void {
  const g = (id: GroupId) => (groups.includes(id) ? saved[id] : undefined);
  const setup = g('setup');
  if (setup) {
    if (typeof setup.experiment === 'string') setExperiment(setup.experiment);
    for (const k of SETUP_FIELDS) if (k in setup) setSource(k, setup[k] as never);
  }
  const p = g('prep') as {
    prep?: object;
    decon?: { indicator: string; tauRise: number; tauDecay: number };
  };
  if (p?.prep) setPrep(copy(p.prep));
  if (p?.decon) {
    setIndicator(p.decon.indicator);
    setTauRise(p.decon.tauRise);
    setTauDecay(p.decon.tauDecay);
  }
  const q = g('qc') as { tol?: object; maxSpeed?: number };
  if (q?.tol) setTol(copy(q.tol));
  if (typeof q?.maxSpeed === 'number') setMaxSpeed(q.maxSpeed);
  const a = g('analyses') as Record<string, never> | undefined;
  if (a) {
    if (a.place) setPlaceSettings(copy(a.place));
    if (a.auroc) setAurocSettings(copy(a.auroc));
    if (a.peth) setPethSettings(copy(a.peth));
    if (a.population) setPopulationSettings(copy(a.population));
    if (a.positionDecoding) setPositionDecoding(reconcile(copy(a.positionDecoding)));
    if (a.behaviorDecoding) setBehaviorDecoding(copy(a.behaviorDecoding));
    if (a.decodeTarget) setDecodeTarget('type', a.decodeTarget);
    if (a.binCm !== undefined) setArena('binCm', a.binCm);
    if (a.minOccupancy !== undefined) setArena('minOccupancy', a.minOccupancy);
  }
}

// ---- Saved per dataset, in this browser

const KEY = 'cabana.settings-by-dataset';
const KEEP = 8;

export interface SavedDataset {
  name: string;
  savedAt: string;
  settings: Saved;
}

function readAll(): SavedDataset[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const [saved, setSaved] = createSignal<SavedDataset[]>(readAll());

/** Datasets whose settings can be applied: the most recent first, without the one loaded now. */
export const savedDatasets = () => saved().filter((d) => d.name !== sessionName());

function save(name: string, settings: Captured): void {
  const list = [
    { name, savedAt: new Date().toISOString(), settings },
    ...saved().filter((d) => d.name !== name),
  ].slice(0, KEEP);
  setSaved(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // not remembered in this browser; applying from it is then unavailable
  }
}

// Keep the loaded dataset's settings as they change. Nothing is saved until a dataset is loaded.
createRoot(() =>
  createEffect(
    on(
      () => JSON.stringify(captureSettings()),
      (text) => {
        const name = sessionName();
        if (name && Object.values(loaded).some(Boolean)) save(name, JSON.parse(text));
      },
      { defer: true },
    ),
  ),
);
