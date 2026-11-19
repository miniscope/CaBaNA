// What a project keeps on disk and how it reads back: processing.yaml (QC decisions and
// preprocessing settings), analysis.yaml (one section per analysis) and the words that go into the
// change history. Pure data in, data out; project-state.ts connects it to the stores.
// experiment.yaml is the session config the framework reads (session-config.ts).

import { Document, isMap, isNode, isScalar, visit } from 'yaml';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
const numberRecord = (v: unknown): Record<string, number> =>
  isObj(v)
    ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) as Record<
        string,
        number
      >)
    : {};

/** Preprocessing settings in the store's own names, as the Preprocess page keeps them. */
export interface PrepValues {
  eventSigmaS: number;
  traceSigmaS: number;
  maxGapS: number;
  fillGapS: number;
  posMethod: 'median' | 'gaussian';
  posWindowS: number;
  speedWindowS: number;
  minSpeed: number;
  labelPadS: number;
}

/** Everything QC and Preprocess decide for this session. */
export interface ProcessingState {
  /** 0-based cell indices, as the stores keep them. The file writes them 1-based, as the app shows them. */
  rejectedCells: number[];
  /** Camera frame numbers of position jumps left out, and of jumps looked at and kept. */
  excludeFrames: number[];
  keptFrames: number[];
  annotationFixes: { merge: boolean; drop: boolean };
  /** QC categories marked reviewed, and sections continued without fixing. */
  reviewed: string[];
  continued: string[];
  limits: { tol: Record<string, number>; maxSpeed: number };
  prep: PrepValues;
  decon: { indicator: string; tauRise: number; tauDecay: number };
}

export const PROCESSING_HEADER =
  'QC decisions and preprocessing for this session only. Never copied to another project.';
/** Marks a file whose cells are numbered from 1; files without it (older) number them from 0. */
const CELL_NUMBERING = 'from 1';

/** Short notes written after a value in processing.yaml. */
export const PROCESSING_COMMENTS: Record<string, string> = {
  cell_numbering: 'rejected cells are numbered as in the app',
  rejected_cells: 'left out of every analysis',
  annotation_fixes: 'merge or remove',
  event_smoothing_s: 'default 0 (off)',
  bout_padding_s: 'default 0 (off)',
};
export const ANALYSIS_HEADER = 'Settings of all five analyses. Each run keeps its own copy.';

/** The five analyses in analysis.yaml: file section name and the label used in summaries. */
export const ANALYSIS_SECTIONS = [
  { id: 'place_cells', label: 'Place cells' },
  { id: 'auroc', label: 'auROC' },
  { id: 'peth', label: 'PETH' },
  { id: 'population', label: 'Population' },
  { id: 'decoding', label: 'Decoding' },
] as const;
export type AnalysisSections = Record<string, Obj>;

/** processing.yaml as an object, in the viewer's shape (`qc:` then `preprocess:`). */
export function processingToData(s: ProcessingState): Obj {
  return {
    qc: {
      cell_numbering: CELL_NUMBERING,
      rejected_cells: [...s.rejectedCells].sort((a, b) => a - b).map((c) => c + 1),
      position_jumps: {
        ...(s.excludeFrames.length && { exclude_frames: s.excludeFrames }),
        ...(s.keptFrames.length && { kept_frames: s.keptFrames }),
      },
      annotation_fixes: [
        ...(s.annotationFixes.merge ? ['merge'] : []),
        ...(s.annotationFixes.drop ? ['remove'] : []),
      ],
      reviewed: s.reviewed,
      continued_without_fixing: s.continued,
      limits: { ...s.limits.tol, max_speed_cm_s: s.limits.maxSpeed },
    },
    preprocess: {
      event_smoothing_s: s.prep.eventSigmaS,
      trace_smoothing_s: s.prep.traceSigmaS,
      fill_gaps_up_to_s: s.prep.fillGapS,
      position_smoothing: { method: s.prep.posMethod, window_s: s.prep.posWindowS },
      position_onto_neural_frames: { gap_limit_s: s.prep.maxGapS },
      speed_window_s: s.prep.speedWindowS,
      min_speed_cm_s: s.prep.minSpeed,
      bout_padding_s: s.prep.labelPadS,
      deconvolution: {
        indicator: s.decon.indicator,
        tau_rise_s: s.decon.tauRise,
        tau_decay_s: s.decon.tauDecay,
      },
    },
  };
}

/** Rejected cells as 0-based indices; only a file marked `from 1` is shifted. */
const rejectedFrom = (qc: Obj): number[] => {
  const shift = qc.cell_numbering === CELL_NUMBERING ? 1 : 0;
  return nums(qc.rejected_cells)
    .map((c) => c - shift)
    .filter((c) => c >= 0);
};

/** The state a processing.yaml holds; anything missing keeps the value in `base` (the defaults). */
export function processingFromData(raw: unknown, base: ProcessingState): ProcessingState {
  const data = isObj(raw) ? raw : {};
  const qc = isObj(data.qc) ? data.qc : {};
  const pre = isObj(data.preprocess) ? data.preprocess : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const jumps = isObj(qc.position_jumps) ? qc.position_jumps : {};
  const fixes = Array.isArray(qc.annotation_fixes) ? qc.annotation_fixes : [];
  const limits = numberRecord(qc.limits);
  const { max_speed_cm_s: maxSpeed, ...tolLimits } = limits;
  const smoothing = isObj(pre.position_smoothing) ? pre.position_smoothing : {};
  const onto = isObj(pre.position_onto_neural_frames) ? pre.position_onto_neural_frames : {};
  const decon = isObj(pre.deconvolution) ? pre.deconvolution : {};
  const p = base.prep;
  return {
    rejectedCells: 'rejected_cells' in qc ? rejectedFrom(qc) : base.rejectedCells,
    excludeFrames: nums(jumps.exclude_frames),
    keptFrames: nums(jumps.kept_frames),
    annotationFixes: { merge: fixes.includes('merge'), drop: fixes.includes('remove') },
    reviewed: Array.isArray(qc.reviewed) ? qc.reviewed.filter((x) => typeof x === 'string') : [],
    continued: Array.isArray(qc.continued_without_fixing)
      ? qc.continued_without_fixing.filter((x) => typeof x === 'string')
      : [],
    limits: {
      tol: { ...base.limits.tol, ...tolLimits },
      maxSpeed: maxSpeed ?? base.limits.maxSpeed,
    },
    prep: {
      eventSigmaS: num(pre.event_smoothing_s, p.eventSigmaS),
      traceSigmaS: num(pre.trace_smoothing_s, p.traceSigmaS),
      fillGapS: num(pre.fill_gaps_up_to_s, p.fillGapS),
      posMethod:
        smoothing.method === 'gaussian'
          ? 'gaussian'
          : smoothing.method === 'median'
            ? 'median'
            : p.posMethod,
      posWindowS: num(smoothing.window_s, p.posWindowS),
      maxGapS: num(onto.gap_limit_s, p.maxGapS),
      speedWindowS: num(pre.speed_window_s, p.speedWindowS),
      minSpeed: num(pre.min_speed_cm_s, p.minSpeed),
      labelPadS: num(pre.bout_padding_s, p.labelPadS),
    },
    decon: {
      indicator: typeof decon.indicator === 'string' ? decon.indicator : base.decon.indicator,
      tauRise: num(decon.tau_rise_s, base.decon.tauRise),
      tauDecay: num(decon.tau_decay_s, base.decon.tauDecay),
    },
  };
}

/** analysis.yaml as an object: one section per analysis, `{}` for one never set up. */
export function analysisToData(sections: AnalysisSections): Obj {
  return Object.fromEntries(ANALYSIS_SECTIONS.map((s) => [s.id, sections[s.id] ?? {}]));
}

/** The sections a analysis.yaml holds; a missing or malformed one is left out. */
export function analysisFromData(raw: unknown): AnalysisSections {
  const data = isObj(raw) ? raw : {};
  return Object.fromEntries(
    ANALYSIS_SECTIONS.filter((s) => isObj(data[s.id]) && Object.keys(data[s.id] as Obj).length).map(
      (s) => [s.id, data[s.id] as Obj],
    ),
  );
}

/** YAML text with a header comment; lists without nested maps are written on one line. */
export function yamlText(data: Obj, header: string, comments: Record<string, string> = {}): string {
  const doc = new Document(data);
  visit(doc, {
    Seq(_, node) {
      if (!node.items.some(isMap)) node.flow = true;
    },
    Pair(_, pair) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      // Notes go after scalars and one-line lists only.
      if (comments[key] && isNode(pair.value) && !(isMap(pair.value) && !pair.value.flow))
        pair.value.comment = ` ${comments[key]}`;
    },
  });
  doc.commentBefore = ` ${header}`;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

// ---- Words for the change history

const PREP_LABEL: [keyof PrepValues, string, string][] = [
  ['eventSigmaS', 'Event smoothing', 's'],
  ['traceSigmaS', 'Trace smoothing', 's'],
  ['fillGapS', 'Fill tracking gaps up to', 's'],
  ['posWindowS', 'Position smoothing window', 's'],
  ['maxGapS', 'Gap limit onto neural frames', 's'],
  ['speedWindowS', 'Speed window', 's'],
  ['minSpeed', 'Minimum speed', 'cm/s'],
  ['labelPadS', 'Bout padding', 's'],
];

const shown = (v: number, unit: string, zeroIsOff: boolean) =>
  zeroIsOff && v === 0 ? 'off' : `${v.toFixed(2)} ${unit}`;

const cellText = (cells: number[]) => {
  const ids = [...cells].sort((a, b) => a - b).map((c) => c + 1);
  return ids.length === 1 ? `Cell ${ids[0]}` : `Cells ${ids.join(', ')}`;
};
const frames = (n: number) => `${n} ${n === 1 ? 'frame' : 'frames'}`;

/** What changed in processing.yaml, one line per change, in the words of the history. */
export function describeProcessing(before: ProcessingState, after: ProcessingState): string[] {
  const out: string[] = [];
  const added = after.rejectedCells.filter((c) => !before.rejectedCells.includes(c));
  const removed = before.rejectedCells.filter((c) => !after.rejectedCells.includes(c));
  if (added.length) out.push(`${cellText(added)} rejected`);
  if (removed.length) out.push(`${cellText(removed)} restored`);
  const excl = after.excludeFrames.length - before.excludeFrames.length;
  if (excl)
    out.push(
      `Position jumps left out: ${frames(after.excludeFrames.length)} (was ${before.excludeFrames.length})`,
    );
  const kept = after.keptFrames.length - before.keptFrames.length;
  if (kept)
    out.push(
      `Position jumps kept as real: ${frames(after.keptFrames.length)} (was ${before.keptFrames.length})`,
    );
  for (const k of ['merge', 'drop'] as const)
    if (before.annotationFixes[k] !== after.annotationFixes[k])
      out.push(
        `Annotation fix ${k === 'merge' ? 'merge bouts' : 'remove short bouts'} ${after.annotationFixes[k] ? 'applied' : 'undone'}`,
      );
  for (const [key, label, unit] of PREP_LABEL) {
    const a = before.prep[key] as number;
    const b = after.prep[key] as number;
    if (a !== b) {
      const off = key === 'eventSigmaS' || key === 'traceSigmaS' || key === 'labelPadS';
      out.push(`${label} ${shown(b, unit, off)} (was ${shown(a, unit, off)})`);
    }
  }
  if (before.prep.posMethod !== after.prep.posMethod)
    out.push(`Position smoothing ${after.prep.posMethod} (was ${before.prep.posMethod})`);
  if (
    before.decon.indicator !== after.decon.indicator ||
    before.decon.tauRise !== after.decon.tauRise ||
    before.decon.tauDecay !== after.decon.tauDecay
  )
    out.push('Deconvolution check settings changed');
  if (JSON.stringify(before.limits) !== JSON.stringify(after.limits)) out.push('QC limits changed');
  if (before.reviewed.join() !== after.reviewed.join()) out.push('Review marks changed');
  return out;
}

const keysChanged = (a: unknown, b: unknown): string[] => {
  const x = isObj(a) ? a : {};
  const y = isObj(b) ? b : {};
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(
    (k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]),
  );
};

/** "PETH settings changed: bin_s, window_s" per analysis section that differs. */
export function describeAnalysis(before: AnalysisSections, after: AnalysisSections): string[] {
  return ANALYSIS_SECTIONS.flatMap((s) => {
    const keys = keysChanged(before[s.id], after[s.id]);
    if (!keys.length) return [];
    const list =
      keys.length > 3
        ? `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`
        : keys.join(', ');
    return [`${s.label} settings changed: ${list}`];
  });
}

const GROUP_LABEL: Record<string, string> = {
  name: 'name',
  neural: 'neural files',
  behavior: 'behavior files',
  arena: 'arena',
  subjects: 'subject',
  metadata: 'experiment details',
};

/** The top-level groups of the session config that differ, in words. */
export function describeExperiment(before: unknown, after: unknown): string[] {
  const keys = keysChanged(before, after);
  if (!keys.length) return [];
  return [`Experimental setup changed: ${keys.map((k) => GROUP_LABEL[k] ?? k).join(', ')}`];
}

/** One line for the history from the lines a save carries. */
export const joinSummary = (lines: string[]): string =>
  lines.length <= 3
    ? lines.join('; ')
    : `${lines.slice(0, 3).join('; ')}; and ${lines.length - 3} more`;
