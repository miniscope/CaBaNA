// App state shared by every panel: which files are loaded, the parsed data,
// the QC parameters and the user's review answers. Panels read from here and
// never hold this state themselves, so any layout can show any panel.

import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { matchSlot, SLOTS, type Level, type SlotId } from './slots.ts';
import { PARADIGMS } from './experiments.ts';
import {
  readFootprints,
  readMatrix,
  readTable,
  type Footprints,
  type Matrix,
  type Table,
} from './parse.ts';
import {
  alignmentChecks,
  cellQc,
  footprintCentroids,
  footprintChecks,
  normalizeFootprints,
  positionQc,
} from './qc.ts';
import { NEIGHBOR_PX, cellChecks, eventFractions, scoreCells } from './cells.ts';
import { annotationQc, dropShortBouts, mergeBouts, readEpochs, type Epoch } from './behavior.ts';
import { timingReport } from './framework.ts';
import { column } from './parse.ts';

export interface LoadedInfo {
  name: string;
  size: number;
  summary: string;
  warning?: string;
  error?: string;
}

const [loaded, setLoaded] = createStore<Partial<Record<SlotId, LoadedInfo>>>({});
const [unrecognized, setUnrecognized] = createSignal<File[]>([]);
const [version, setVersion] = createSignal(0);
const [maxSpeed, setMaxSpeed] = createSignal(60);

/** How much error each QC may have before it fails, as a percent (minPve: the least explained variance). */
export const DEFAULT_TOL = {
  lostPct: 5,
  jumpPct: 0.02,
  poorCellPct: 50,
  overlapPct: 50,
  riseLowPct: 50,
  annotPct: 5,
  minBoutS: 0.25,
  mergeGapS: 0.5,
  minPve: 50,
};
const [tol, setTol] = createStore({ ...DEFAULT_TOL });

/** Sections where the user chose to continue without fixing the problems. */
export type Section = 'position' | 'annotations' | 'cells' | 'decon';
const [proceed, setProceed] = createStore<Record<Section, boolean>>({
  position: false,
  annotations: false,
  cells: false,
  decon: false,
});
const data: Partial<Record<SlotId, Matrix | Table | Footprints>> = {};
const [cell, setCell] = createSignal(0);
/** A second cell to highlight on the footprint map, set when a user picks an overlapping pair. */
const [overlapPartner, setOverlapPartner] = createSignal(-1);

export function selectCell(c: number, partner = -1): void {
  setCell(c);
  setOverlapPartner(partner);
}

export {
  cell,
  overlapPartner,
  loaded,
  unrecognized,
  maxSpeed,
  setMaxSpeed,
  tol,
  setTol,
  proceed,
  setProceed,
};

const matrix = (id: SlotId) => (version(), data[id] as Matrix | undefined);
const table = (id: SlotId) => (version(), data[id] as Table | undefined);

async function load(slot: SlotId, file: File): Promise<void> {
  const base = { name: file.name, size: file.size };
  try {
    if (slot.startsWith('neural_') && slot !== 'neural_timestamps') {
      const { matrix: m, note } = await readMatrix(file);
      data[slot] = m;
      setLoaded(slot, {
        ...base,
        summary: `${m.cells} cells x ${m.frames.toLocaleString()} frames`,
        warning: note,
      });
    } else if (slot === 'footprints') {
      const f = await readFootprints(file);
      data[slot] = f;
      setLoaded(slot, { ...base, summary: `${f.cells} cells, ${f.height} x ${f.width} px` });
    } else if (slot === 'config') {
      const text = await file.text();
      configHooks.forEach((f) => f(text));
      setLoaded(slot, { ...base, summary: 'Loaded' });
    } else {
      const t = await readTable(file);
      data[slot] = t;
      setLoaded(slot, { ...base, summary: `${t.rows.length.toLocaleString()} rows` });
    }
  } catch (e) {
    delete data[slot];
    setLoaded(slot, { ...base, summary: '', error: e instanceof Error ? e.message : String(e) });
  }
  setVersion((v) => v + 1);
}

/** Add files from a folder, a drop, or a single slot. Unmatched files wait for the user to assign them. */
export async function addFiles(files: File[], slot?: SlotId): Promise<void> {
  const folder = (files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split(
    '/',
  )[0];
  if (folder) setSessionName(folder);
  // A config is read first, so the file names it gives decide where the other files go.
  const config = slot ? undefined : files.find((f) => matchSlot(f.name) === 'config');
  if (config) await load('config', config);
  const named = new Map(Object.entries(configFiles()).map(([id, n]) => [n, id as SlotId]));
  const rest: File[] = [];
  await Promise.all(
    files.map((f) => {
      if (f === config) return;
      const id = slot ?? named.get(f.name) ?? matchSlot(f.name);
      if (id) return load(id, f);
      rest.push(f);
    }),
  );
  setUnrecognized((u) => [...u, ...rest]);
}

export async function assignFile(file: File, slot: SlotId): Promise<void> {
  setUnrecognized((u) => u.filter((f) => f !== file));
  await load(slot, file);
}

const [rejected, setRejected] = createSignal<ReadonlySet<number>>(new Set());
const [pending, setPending] = createSignal<ReadonlySet<number>>(new Set());
export { rejected, pending };

/** Cells the user marked to reject. Nothing is removed yet: QC leaves them out and later steps skip them. */
export function rejectCells(cells: number[]): void {
  setRejected((r) => new Set<number>([...r, ...cells]));
  setPending(new Set<number>());
}
export function restoreCell(c: number): void {
  setRejected((r) => new Set<number>([...r].filter((x) => x !== c)));
}
export function togglePending(c: number): void {
  setPending((p) => new Set<number>(p.has(c) ? [...p].filter((x) => x !== c) : [...p, c]));
}
export const setPendingTo = (cells: number[]) => setPending(new Set(cells));

/** The file name a loaded config.yaml gives for each slot. */
export const [configFiles, setConfigFiles] = createSignal<Partial<Record<SlotId, string>>>({});

const configHooks: ((text: string) => void)[] = [];
/** Run `f` with the text of a config.yaml when one is loaded. */
export const onConfig = (f: (text: string) => void) => configHooks.push(f);
const clearHooks: (() => void)[] = [];
/** Run `f` whenever the loaded data is cleared, so other parts of the app can forget what belonged to it. */
export const onClear = (f: () => void) => clearHooks.push(f);

export function clearAll(): void {
  setSessionName(undefined);
  setConfigFiles({});
  setOverride({ neuralFps: undefined, cameraFps: undefined, durationS: undefined });
  clearHooks.forEach((f) => f());
  setAnnotationEdits({});
  setAnnotationLog([]);
  setExampleMedia(undefined);
  setRejected(new Set<number>());
  setPending(new Set<number>());
  setAnnotationFixed({ merge: false, drop: false });
  for (const k of ['position', 'annotations', 'cells', 'decon'] as const) setProceed(k, false);
  for (const s of SLOTS) {
    delete data[s.id];
    setLoaded(s.id, undefined as unknown as LoadedInfo);
  }
  setUnrecognized([]);
  setVersion((v) => v + 1);
}

export const EXAMPLES = [
  {
    id: 'simulated_3chamber',
    label: 'Three-chamber social (clean)',
    note: 'Arena 60 x 30 cm: three chambers, two dividers, and two half-disc enclosures of 9 cm radius that the animal cannot enter. No picture is included, so use the blank arena in Experimental Setup.',
  },
  {
    id: 'simulated_open_field',
    label: 'Open field (poor tracking)',
    note: 'Arena 40 x 40 cm. The animal is 8 cm from nose to tail base. A picture and a video are included.',
  },
  {
    id: 'simulated_social_interaction',
    label: 'Social interaction (annotation errors)',
    note: 'Arena 50 x 50 cm. The animal is 8 cm from nose to tail base. A picture and a video are included.',
  },
  {
    id: 'simulated_fear_conditioning',
    label: 'Fear conditioning (files missing)',
    note: 'Chamber 25 x 25 cm. There is no position file or picture.',
  },
];

/** The picture and video that come with the loaded example, for Experimental Setup. */
export const [exampleMedia, setExampleMedia] = createSignal<
  { id: string; frame?: File; video?: File } | undefined
>();

const EXAMPLE_FILES = [
  'neural_timestamps.csv',
  'neural_deconvolved.npy',
  'neural_denoised.npy',
  'neural_raw.npy',
  'footprints.npy',
  'behavior_timestamps.csv',
  'position.csv',
  'headOrientation.csv',
  'zone_annotations.csv',
  'investigation_annotations.csv',
  'social_annotations.csv',
  'behavior_annotations.csv',
  'config.yaml',
];

/** Replace the loaded data with an example dataset. Files a dataset doesn't have are skipped. */
export async function loadExample(id: string): Promise<void> {
  const base = `${import.meta.env.BASE_URL}example_data/${id}/`;
  const got = await Promise.all(
    EXAMPLE_FILES.map(async (n) => {
      const res = await fetch(base + n);
      // A missing file comes back as the app's own page, not an error.
      return res.ok && !res.headers.get('content-type')?.includes('text/html')
        ? new File([await res.blob()], n)
        : undefined;
    }),
  );
  clearAll();
  setSessionName(EXAMPLES.find((x) => x.id === id)?.label);
  await addFiles(got.filter((f): f is File => !!f));
  const media = await Promise.all(
    ['arena_frame.png', 'arena_video.mp4'].map(async (n) => {
      const res = await fetch(base + n);
      return res.ok && !res.headers.get('content-type')?.includes('text/html')
        ? new File([await res.blob()], n, { type: n.endsWith('png') ? 'image/png' : 'video/mp4' })
        : undefined;
    }),
  );
  setExampleMedia({ id, frame: media[0], video: media[1] });
}

const [experimentId, setExperiment] = createSignal('custom');
export { experimentId, setExperiment };
export const experiment = () => PARADIGMS.find((e) => e.id === experimentId())!;

const LAYOUT_KEY = 'cabana-layout';
const readLayout = (): 'steps' | 'sidebar' => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'steps' ? 'steps' : 'sidebar';
  } catch {
    return 'sidebar';
  }
};
/** How the steps are laid out: a row of steps, or a sidebar. The panels are the same in both. */
export const [layout, setLayoutSignal] = createSignal<'steps' | 'sidebar'>(readLayout());
export function setLayout(l: 'steps' | 'sidebar'): void {
  setLayoutSignal(l);
  try {
    localStorage.setItem(LAYOUT_KEY, l);
  } catch {
    // The choice just is not remembered.
  }
}

/** The name of the session: the folder that was loaded, or the example. */
export const [sessionName, setSessionName] = createSignal<string | undefined>();

/** The step shown in the guided layout. */
export const [stepId, goToStep] = createSignal('load');

/** How much a file is needed for the chosen experiment. */
export const levelOf = (id: SlotId): Level =>
  experiment().levels[id] ?? SLOTS.find((s) => s.id === id)!.level;

export const missingRequired = () =>
  SLOTS.filter((s) => levelOf(s.id) === 'required' && !loaded[s.id]?.summary);

/** How the data was collected. Units change the QC; the rest tell the user how to export their files. */
export const [source, setSource] = createStore({
  sessionDate: '',
  subjectId: '',
  species: '',
  brainRegion: '',
  group: '',
  notes: '',
  device: '',
  bodyPart: '',
  likelihoodMin: undefined as number | undefined,
  /** What the animal was shown or given: one row per stimulus. */
  stimuli: [] as { name: string; kind: string; durationS?: number; note: string }[],
  positionTool: 'other',
  positionUnit: 'cm' as 'cm' | 'px',
  /** Position in cm with y growing downward, as in camera images: y is flipped to the arena's y-up frame. */
  yDown: false,
  pxPerCm: 10,
  /** Seconds the behavior video ran before the miniscope started: t_neural = scale * (t_video - offset). */
  clockOffsetS: 0,
  /** Ratio of the neural clock's rate to the camera clock's, for clocks that drift apart. Usually 1. */
  clockScale: 1,
  annotationTool: 'other',
  annotationUnit: 'seconds' as 'seconds' | 'milliseconds' | 'camera frames' | 'miniscope frames',
  extractionTool: 'other',
  deconTool: 'other',
});

/** Record that the arena settings were provided without a config file. */
export function markConfigProvided(summary: string): void {
  setLoaded('config', { name: 'entered in Experimental Setup', size: 0, summary });
}

/** The trace used for per-cell checks: raw if there is one, since noise is only measurable there. */
export const traceMatrix = () => matrix('neural_raw') ?? matrix('neural_denoised');
export const footprints = () => (version(), data.footprints as Footprints | undefined);
export const deconvolved = () => matrix('neural_deconvolved');
export const rawTrace = () => matrix('neural_raw');
export const denoisedTrace = () => matrix('neural_denoised');

/** Values the user typed over the ones calculated from the timestamp files. */
export const [override, setOverride] = createStore<{
  neuralFps?: number;
  cameraFps?: number;
  durationS?: number;
}>({});

/** Frames per second of the miniscope, from its timestamps. */
export const derivedNeuralFps = createMemo(() => {
  const ts = table('neural_timestamps');
  if (!ts) return undefined;
  const ms = column(ts, 'time stamp');
  return (1000 * (ms.length - 1)) / (ms[ms.length - 1] - ms[0]);
});
export const samplingRate = () => override.neuralFps ?? derivedNeuralFps();

export const frameTimes = createMemo(() => {
  const ts = table('neural_timestamps');
  return ts ? column(ts, 'time stamp').map((v) => v / 1000) : undefined;
});

/**
 * Behavior camera frame times in seconds on the neural clock, with the clock offset and scale
 * from Experimental Setup: the framework's `scale * (t - offset_s)`.
 */
export const cameraClock = createMemo(() => {
  const ts = table('behavior_timestamps');
  if (!ts) return undefined;
  try {
    const { clockOffsetS: off, clockScale: k } = source;
    return column(ts, 'time stamp').map((v) => k * (v / 1000 - off));
  } catch {
    return undefined;
  }
});

/** Time in seconds of each row of the position file, on the neural clock. */
export const cameraTimes = createMemo(() => {
  const pos = table('position');
  const ts = table('behavior_timestamps');
  const t = cameraClock();
  if (!pos || !ts || !t) return undefined;
  try {
    const at = new Map(column(ts, 'frame number').map((f, i) => [f, t[i]]));
    return column(pos, 'frame').map((f) => at.get(f) ?? NaN);
  } catch {
    return undefined;
  }
});

export const positionResult = createMemo(() => {
  const pos = table('position');
  const ts = table('behavior_timestamps');
  if (!pos || !ts) return undefined;
  try {
    return positionQc(pos, ts, maxSpeed(), tol, source.positionUnit === 'px' ? source.pxPerCm : 1);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

/** How regular the frame times are, for the miniscope and the behavior camera. */
export const timingResults = createMemo(() =>
  (
    [
      ['Miniscope', 'neural_timestamps'],
      ['Behavior camera', 'behavior_timestamps'],
    ] as const
  ).flatMap(([name, id]) => {
    const ts = table(id);
    if (!ts) return [];
    try {
      const t = column(ts, 'time stamp').map((v) => v / 1000);
      return [{ name, ...timingReport(t) }];
    } catch {
      return []; // the timestamps files are checked where they are loaded
    }
  }),
);

/** Whether the neural data, its timestamps and the behavior camera line up. */
export const alignmentResults = createMemo(() =>
  alignmentChecks(
    frameTimes(),
    (
      [
        ['Raw traces', 'neural_raw'],
        ['Denoised traces', 'neural_denoised'],
        ['Deconvolved events', 'neural_deconvolved'],
      ] as const
    ).flatMap(([name, id]) => {
      const m = matrix(id);
      return m ? [[name, m.frames] as [string, number]] : [];
    }),
    cameraClock(),
    source.clockOffsetS,
  ),
);

const centroids = createMemo(() => {
  const f = footprints();
  return f ? footprintCentroids(f, normalizeFootprints(f)) : undefined;
});

export const cellResult = createMemo(() => {
  const m = traceMatrix();
  return m ? cellQc(m, centroids(), NEIGHBOR_PX) : undefined;
});

export const cellScores = createMemo(() => {
  const q = cellResult();
  if (!q) return undefined;
  const ev = deconvolved();
  return scoreCells(
    q.snr,
    q.maxCorr,
    ev && ev.cells === q.snr.length ? eventFractions(ev) : undefined,
    rejected(),
  );
});

/** Summary checks for the Neural tab, from the per-cell scores and the footprints. */
export const neuralChecks = createMemo(() => {
  const sc = cellScores();
  const f = footprints();
  return [
    ...(sc ? cellChecks(sc, !!f, tol) : []),
    ...(f ? footprintChecks(f, traceMatrix()?.cells, tol, rejected()) : []),
  ];
});

/** Length of the session in seconds, from the miniscope timestamps (else the camera's). */
export const derivedDuration = createMemo(() => {
  const ts = table('neural_timestamps') ?? table('behavior_timestamps');
  if (!ts) return undefined;
  const ms = column(ts, 'time stamp');
  return (ms[ms.length - 1] - ms[0]) / 1000;
});
export const sessionDuration = () => override.durationS ?? derivedDuration();

/** Annotation files after the user merged bouts or removed short ones. Times are in seconds. */
const [annotationEdits, setAnnotationEdits] = createSignal<Partial<Record<SlotId, Epoch[]>>>({});
const [annotationLog, setAnnotationLog] = createSignal<string[]>([]);
export { annotationLog };
/** Which annotation fixes were applied, so the config can ask the loader to do the same. */
const [annotationFixed, setAnnotationFixed] = createSignal({ merge: false, drop: false });
export { annotationFixed };

export function editAnnotations(kind: 'merge' | 'drop'): void {
  const next = { ...annotationEdits() };
  let n = 0;
  for (const r of annotationResults()) {
    if (r.error) continue;
    const res =
      kind === 'merge'
        ? mergeBouts(r.epochs, tol.mergeGapS)
        : dropShortBouts(r.epochs, tol.minBoutS);
    next[r.id] = res.epochs;
    n += 'merged' in res ? res.merged : res.removed;
  }
  setAnnotationEdits(next);
  setAnnotationFixed((f) => ({ ...f, [kind]: true }));
  setAnnotationLog((l) => [
    ...l,
    kind === 'merge'
      ? `Merged ${n} pairs of bouts that were less than ${tol.mergeGapS} s apart.`
      : `Removed ${n} bouts shorter than ${tol.minBoutS} s.`,
  ]);
}

export function undoAnnotationEdits(): void {
  setAnnotationEdits({});
  setAnnotationLog([]);
  setAnnotationFixed({ merge: false, drop: false });
}

/** Camera (else miniscope) frames per second, from the timestamps. */
export const derivedCameraFps = () => {
  const ts = table('behavior_timestamps') ?? table('neural_timestamps');
  if (!ts) return undefined;
  const ms = column(ts, 'time stamp');
  return (1000 * (ms.length - 1)) / (ms[ms.length - 1] - ms[0]);
};
export const cameraFps = () => override.cameraFps ?? derivedCameraFps() ?? 30;

/** Annotation files, with their epochs checked against the session length. */
export const annotationResults = createMemo(() => {
  const out: {
    id: SlotId;
    name: string;
    epochs: Epoch[];
    checks: ReturnType<typeof annotationQc>;
    error?: string;
  }[] = [];
  for (const id of ['zone_annotations', 'behavior_annotations'] as const) {
    const t = table(id);
    if (!t) continue;
    try {
      const edited = annotationEdits()[id];
      const epochs = edited ?? readEpochs(t);
      const perSecond = {
        seconds: 1,
        milliseconds: 1000,
        'camera frames': cameraFps(),
        'miniscope frames': samplingRate() ?? 30,
      }[source.annotationUnit];
      if (!edited)
        for (const e of epochs) [e.start, e.stop] = [e.start / perSecond, e.stop / perSecond];
      const duration = sessionDuration() ?? Math.max(...epochs.map((e) => e.stop));
      out.push({
        id,
        name: loaded[id]?.name ?? id,
        epochs,
        checks: annotationQc(epochs, duration, tol),
      });
    } catch (e) {
      out.push({
        id,
        name: loaded[id]?.name ?? id,
        epochs: [],
        checks: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
});

/** What each fix would change right now. */
export const annotationFixCounts = createMemo(() => {
  let merge = 0;
  let drop = 0;
  for (const r of annotationResults()) {
    if (r.error) continue;
    merge += mergeBouts(r.epochs, tol.mergeGapS).merged;
    drop += dropShortBouts(r.epochs, tol.minBoutS).removed;
  }
  return { merge, drop };
});

/** How the footprint map is colored. */
export const [colorBy, setColorBy] = createSignal<'cell' | 'quality'>('cell');
