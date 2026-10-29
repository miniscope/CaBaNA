// Status of every sidebar item and the Next button's target (plan D-42, D-43). Pure functions of a
// snapshot, so the rules can be tested without the app; `readiness-snapshot.ts` fills the snapshot
// from the stores.
//
// "Needs input" is something the user can fix (load a file, finish a setup card). A missing
// framework feature or a stopped Python engine is separate ("Framework update required",
// "Python engine not running"): the user cannot fix it from the page, so Next never goes there.

export type ItemId =
  | 'load'
  | 'setup'
  | 'viz'
  | 'qc'
  | 'prep'
  | 'place'
  | 'auroc'
  | 'peth'
  | 'decoding'
  | 'population'
  | 'results';
export type AnalysisItem = 'place' | 'auroc' | 'peth' | 'decoding' | 'population';
export const ANALYSIS_ITEMS: AnalysisItem[] = ['place', 'auroc', 'peth', 'decoding', 'population'];

export type StatusKind =
  | 'not_started'
  | 'optional'
  | 'needs_input'
  | 'framework_update'
  | 'ready'
  | 'in_progress'
  | 'viewed'
  | 'running'
  | 'complete'
  | 'outdated'
  | 'failed';

/** Something the user can supply, with the sidebar item that fixes it. */
export interface Need {
  text: string;
  link?: { label: string; item: ItemId };
}
/** A framework feature that is missing. `code` is the contract id, shown only in technical details. */
export interface FrameworkNeed {
  text: string;
  code: string;
}

export interface Status {
  kind: StatusKind;
  /** The words shown next to the icon. */
  text: string;
  input: Need[];
  framework: FrameworkNeed[];
  engineOff: boolean;
  /** 0..1 while running, only when it can be measured. */
  progress?: number;
}

/** Plain-language text for each framework feature the bridge can report. */
export const FEATURES: Record<string, FrameworkNeed> = {
  session_metadata: { text: 'Session metadata in config files is not supported yet.', code: 'F0a' },
  session_markers: { text: 'Time marker files are not supported yet.', code: 'F0b' },
  peth_markers: { text: 'PETH aligned to time markers is not supported yet.', code: 'F0b' },
  frame_labels: { text: 'Frame-label files are not supported yet.', code: 'F0c' },
  decoding_fold_gap: {
    text: 'Decoding needs a fold-local test window and a gap between folds.',
    code: 'F1',
  },
  decoding_fold_local_window: {
    text: 'The Bayesian decoder needs a fold-local test window.',
    code: 'F1',
  },
  decoding_overall_test: { text: 'The overall decoding test is not available yet.', code: 'F2' },
  overlap_policy: {
    text: 'Behavior decoding needs a policy for overlapping behaviors.',
    code: 'F3',
  },
  bayes_input_check: { text: 'The Bayesian decoder input check is not available.', code: 'F4' },
  bin_eligibility: {
    text: 'Minimum occupancy per bin from training data is not available.',
    code: 'F5',
  },
  preview_flag: { text: 'Quick previews cannot be marked as preliminary yet.', code: 'F7' },
  cli_rejects_recipes: { text: 'The command line does not reject recipe files yet.', code: 'F8' },
  peth_gui_extensions: {
    text: 'PETH offset alignment and same-direction latency are not available yet.',
    code: 'F9',
  },
};
export const featureNeed = (name: string): FrameworkNeed =>
  FEATURES[name] ?? { text: `Feature ${name} is missing.`, code: name };

export interface RunState {
  running: boolean;
  /** 0..1 only when the run reports measurable progress. */
  progress?: number;
  /** Latest run of this analysis, if any. */
  latest?: {
    status: 'ok' | 'partial' | 'cancelled' | 'failed' | 'queued' | 'running';
    matches: boolean;
  };
  /** Input problems reported for the current settings (for example a label with too few bins). */
  issues: string[];
  /** Framework features the pipeline needs that are missing. */
  framework?: FrameworkNeed[];
}

export interface Snapshot {
  neural: boolean;
  /** Timestamps or a sampling rate are present. */
  timing: boolean;
  deconvolved: boolean;
  position: boolean;
  spatialComplete: boolean;
  /** Labels usable by analyses (not blocked), by kind. */
  labels: { epochs: number; behaviors: number; zones: number; alignable: number };
  /** Stimuli whose label is not loaded. */
  missingStimulusLabels: string[];
  bridge: 'ready' | 'offline' | 'connecting';
  /** Framework features the bridge reports (name -> present). Empty until the bridge answers. */
  capabilities: Record<string, boolean>;
  /** Analyses that already compute through the bridge; others use the browser engine. */
  frameworkEngine: Partial<Record<AnalysisItem, boolean>>;
  /** Target of the population page: how many states it would compare. */
  populationStates: number;
  decodingTarget: 'position' | 'behaviors';
  runs: Partial<Record<AnalysisItem, RunState>>;
  /** Pages the user has opened. */
  visited: Partial<Record<ItemId, boolean>>;
  /** Required setup cards are complete (or, with no position file, the page was visited). */
  setupComplete: boolean;
  hasRuns: boolean;
}

export const ITEM_LABEL: Record<ItemId, string> = {
  load: 'Load data',
  setup: 'Experimental setup',
  viz: 'Data visualization',
  qc: 'Data QC',
  prep: 'Preprocess',
  place: 'Place cells',
  auroc: 'auROC',
  peth: 'PETH',
  decoding: 'Decoding',
  population: 'Population activity',
  results: 'Results',
};

const LOAD = { label: 'Load data', item: 'load' as const };
const SETUP = { label: 'Experimental setup', item: 'setup' as const };

export const STATUS_TEXT: Record<StatusKind, string> = {
  not_started: 'Not started',
  optional: 'Optional',
  needs_input: 'Needs input',
  framework_update: 'Framework update required',
  ready: 'Ready',
  in_progress: 'In progress',
  viewed: 'Viewed',
  running: 'Running',
  complete: 'Complete',
  outdated: 'Outdated',
  failed: 'Failed',
};
/** Icon names for the sidebar; the text is always shown with it (never color alone). */
export const STATUS_ICON: Record<StatusKind, string> = {
  not_started: 'circle',
  optional: 'dash',
  needs_input: 'alert',
  framework_update: 'wrench',
  ready: 'play',
  in_progress: 'circle',
  viewed: 'circle',
  running: 'spinner',
  complete: 'check',
  outdated: 'refresh',
  failed: 'x',
};

/** The five states the sidebar shows; every kind above maps to one, so the icons mean the same on every page. */
export type Tone = 'complete' | 'in_progress' | 'needs_input' | 'not_started' | 'outdated';
export const TONE: Record<StatusKind, Tone> = {
  complete: 'complete',
  in_progress: 'in_progress',
  running: 'in_progress',
  needs_input: 'needs_input',
  failed: 'needs_input',
  framework_update: 'needs_input',
  outdated: 'outdated',
  not_started: 'not_started',
  optional: 'not_started',
  viewed: 'not_started',
  ready: 'not_started',
};
export const TONE_TEXT: Record<Tone, { name: string; meaning: string }> = {
  complete: {
    name: 'Complete',
    meaning: 'All required steps are finished and outputs are up to date.',
  },
  in_progress: { name: 'In progress', meaning: 'Some steps are complete, but more work remains.' },
  needs_input: { name: 'Needs input', meaning: 'Required data or settings are missing.' },
  not_started: {
    name: 'Not started',
    meaning: 'No work has been completed yet (or this step is optional).',
  },
  outdated: {
    name: 'Outdated',
    meaning: 'Results need to be rerun because inputs or settings have changed.',
  },
};

/** One sentence on why an item has its status: the first thing missing, else what the status means. */
export function statusDetail(s: Status): string {
  const first =
    s.input[0]?.text ??
    s.framework[0]?.text ??
    (s.engineOff ? 'The Python engine is not running.' : '');
  const more = s.input.length + s.framework.length - 1;
  if (first) return more > 0 ? `${first} (+${more} more)` : first;
  if (s.kind === 'failed') return 'The last run failed.';
  if (s.kind === 'ready') return 'Ready to run; no run yet.';
  if (s.kind === 'running') return `${s.text}.`;
  if (s.kind === 'viewed') return 'Opened; nothing is required here.';
  if (s.kind === 'optional') return 'Optional; nothing is required here.';
  return TONE_TEXT[TONE[s.kind]].meaning;
}

const status = (kind: StatusKind, over: Partial<Status> = {}): Status => ({
  kind,
  text: STATUS_TEXT[kind],
  input: [],
  framework: [],
  engineOff: false,
  ...over,
});

/** What an analysis still needs, split into what the user can fix and what only an update can. */
export function analysisNeeds(
  s: Snapshot,
  id: AnalysisItem,
): Pick<Status, 'input' | 'framework' | 'engineOff'> {
  const input: Need[] = [];
  const need = (text: string, link?: Need['link']) => input.push({ text, link });
  if (!s.neural) need('Load neural data.', LOAD);
  switch (id) {
    case 'place':
      if (!s.position) need('Load a position file.', LOAD);
      else if (!s.spatialComplete)
        need('Finish the Spatial setup (arena outline and scale).', SETUP);
      break;
    case 'auroc':
      if (s.labels.behaviors < 1)
        need('Load behavior annotations with at least one usable label.', LOAD);
      break;
    case 'peth':
      if (s.labels.alignable < 1)
        need('Load a label to align to (behavior epochs or time markers).', LOAD);
      for (const l of s.missingStimulusLabels)
        need(`Missing label '${l}' referenced by a stimulus.`, LOAD);
      break;
    case 'decoding':
      if (!s.deconvolved) need('Decoding needs deconvolved events.', LOAD);
      if (s.decodingTarget === 'position') {
        if (!s.position) need('Load a position file.', LOAD);
        else if (!s.spatialComplete)
          need('Finish the Spatial setup (arena outline and scale).', SETUP);
      } else if (s.labels.behaviors < 2)
        need('Behavior decoding needs at least 2 usable labels.', LOAD);
      break;
    case 'population':
      if (s.populationStates < 2) need('Choose a target with at least 2 states.');
      break;
  }
  const run = s.runs[id];
  for (const issue of run?.issues ?? []) need(issue);

  const engine = !!s.frameworkEngine[id];
  const framework: FrameworkNeed[] = [];
  const add = (f: FrameworkNeed) => framework.some((x) => x.text === f.text) || framework.push(f);
  // Features are only known once the bridge has answered.
  if (engine && s.bridge === 'ready') {
    if (id === 'decoding') {
      if (!s.capabilities.decoding_fold_gap) add(featureNeed('decoding_fold_gap'));
      if (s.decodingTarget === 'behaviors' && !s.capabilities.overlap_policy)
        add(featureNeed('overlap_policy'));
    }
    (run?.framework ?? []).forEach(add);
  }
  return { input, framework, engineOff: engine && s.bridge !== 'ready' };
}

const progressText = (p?: number) =>
  p === undefined ? 'Running' : `Running ${Math.round(p * 100)}%`;

export function analysisStatus(s: Snapshot, id: AnalysisItem): Status {
  const run = s.runs[id];
  if (run?.running)
    return status('running', { text: progressText(run.progress), progress: run.progress });
  const needs = analysisNeeds(s, id);
  if (needs.input.length) return status('needs_input', needs);
  if (run?.latest) {
    if (run.latest.status === 'failed') return status('failed', needs);
    return status(run.latest.matches ? 'complete' : 'outdated', needs);
  }
  if (needs.engineOff || needs.framework.length) {
    const text = needs.engineOff
      ? s.bridge === 'connecting'
        ? 'Connecting to Python engine'
        : 'Python engine not running'
      : 'Framework update required';
    return status('framework_update', { ...needs, text });
  }
  return status('ready');
}

/** Pages that only inspect the data: never required, so never "Not started". */
const OPTIONAL: ItemId[] = ['viz', 'qc', 'prep'];

export function itemStatus(s: Snapshot, id: ItemId): Status {
  switch (id) {
    case 'load':
      return s.neural ? status('complete') : status('not_started');
    case 'setup':
      if (!s.neural || !s.timing)
        return status('needs_input', {
          input: [
            {
              text: !s.neural ? 'Load neural data first.' : 'Add timestamps or a sampling rate.',
              link: LOAD,
            },
          ],
        });
      if (s.setupComplete) return status('complete');
      return s.visited.setup ? status('in_progress') : status('not_started');
    case 'viz':
    case 'qc':
    case 'prep':
      if (!s.neural)
        return status('needs_input', { input: [{ text: 'Load neural data first.', link: LOAD }] });
      // Looking at an optional page is not work, so it never counts as Complete.
      return s.visited[id] ? status('viewed') : status('optional');
    case 'results':
      return s.hasRuns
        ? status('complete', { text: 'Results available' })
        : status('optional', { text: 'No results yet' });
    default:
      return analysisStatus(s, id);
  }
}

/** Order of the sidebar items (the order Next walks through). */
export const ORDER: ItemId[] = [
  'load',
  'setup',
  'viz',
  'qc',
  'prep',
  'place',
  'auroc',
  'peth',
  'decoding',
  'population',
  'results',
];
const NEXT_SKIPS: ItemId[] = ['viz', 'qc'];
export const isOptional = (id: ItemId) => OPTIONAL.includes(id);

export interface NextStep {
  item: ItemId;
  /** Set when Next stays on the current page because the page itself supplies what is missing. */
  blocked?: string;
}

/**
 * Next goes to the first later item that is not Complete and whose prerequisites are met. Data
 * visualization and Data QC are reachable but never offered. Analyses are limited to those
 * recommended for the paradigm. When an item needs something an earlier step provides, Next goes
 * to that step; when the current page provides it, Next stays and says what is missing; framework
 * problems are skipped because the user cannot fix them.
 */
export function nextStep(
  s: Snapshot,
  current: ItemId,
  recommended: AnalysisItem[] = ANALYSIS_ITEMS,
): NextStep {
  const here = ORDER.indexOf(current);
  for (const id of ORDER.slice(here + 1)) {
    if (NEXT_SKIPS.includes(id)) continue;
    if (ANALYSIS_ITEMS.includes(id as AnalysisItem) && !recommended.includes(id as AnalysisItem))
      continue;
    if (id === 'results') return { item: 'results' };
    const st = itemStatus(s, id);
    if (['complete', 'viewed', 'running', 'framework_update'].includes(st.kind)) continue;
    if (st.kind === 'needs_input') {
      const provider = st.input.find(
        (n) => n.link && ORDER.indexOf(n.link.item) < ORDER.indexOf(id),
      )?.link?.item;
      if (provider === current) return { item: current, blocked: st.input[0].text };
      if (provider && itemStatus(s, provider).kind !== 'complete') return { item: provider };
      continue;
    }
    return { item: id };
  }
  return { item: current === 'results' ? current : 'results' };
}

export const nextItem = (s: Snapshot, current: ItemId, recommended?: AnalysisItem[]): ItemId =>
  nextStep(s, current, recommended).item;
