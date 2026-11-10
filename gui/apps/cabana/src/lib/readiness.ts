// Status of every sidebar item and the Next button's target (plan D-42, D-43). Pure functions of a
// snapshot, so the rules can be tested without the app; `readiness-snapshot.ts` fills the snapshot
// from the stores.
//
// "Needs input" is something the user can fix (load a file, finish a setup card). A missing
// framework feature or a stopped Python engine is separate ("Framework update required",
// "Python engine not running"): the user cannot fix it from the page, so Next never goes there.

export type ItemId =
  | 'data'
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
  | 'running'
  | 'complete'
  | 'outdated'
  | 'failed';

/** Something the user can supply, with the sidebar item that fixes it. */
export interface Need {
  text: string;
  /** `entry` opens that entry of the Data setup page (for example Experiment config). */
  link?: { label: string; item: ItemId; entry?: 'config' };
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
export const FEATURES: Record<string, Pick<FrameworkNeed, 'text'>> = {
  session_metadata: { text: 'Session metadata in config files is not supported yet.' },
  session_markers: { text: 'Time marker files are not supported yet.' },
  peth_markers: { text: 'PETH aligned to time markers is not supported yet.' },
  frame_labels: { text: 'Frame-label files are not supported yet.' },
  decoding_fold_gap: {
    text: 'Decoding needs a training/test separation around each test block.',
  },
  decoding_fold_local_window: {
    text: 'The Bayesian decoder needs a test window that stays inside the test block.',
  },
  decoding_overall_test: { text: 'The overall decoding test is not available yet.' },
  overlap_policy: {
    text: 'Behavior decoding needs a policy for overlapping behaviors.',
  },
  bayes_input_check: { text: 'The Bayesian decoder input check is not available.' },
  bin_eligibility: {
    text: 'Minimum occupancy per bin from training data is not available.',
  },
  preview_flag: { text: 'Quick previews cannot be marked as preliminary yet.' },
  cli_rejects_recipes: { text: 'The command line does not reject recipe files yet.' },
  peth_gui_extensions: {
    text: 'PETH offset alignment and same-direction latency are not available yet.',
  },
};
/** The need for a missing feature; `code` is the capability name the bridge reports. */
export const featureNeed = (name: string): FrameworkNeed => ({
  text: FEATURES[name]?.text ?? `Feature ${name} is missing.`,
  code: `Framework capability: ${name}`,
});

export interface RunState {
  running: boolean;
  /** 0..1 only when the run reports measurable progress. */
  progress?: number;
  /** The newest run with results; freshness is judged on it alone. */
  result?: { matches: boolean };
  /** A newer run that produced no usable result. It is noted, and never makes the status Complete. */
  lastAttempt?: 'failed' | 'partial' | 'cancelled';
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
  /** Which neural file is the analysis data; every analysis here reads deconvolved events. */
  analysisKind?: 'deconvolved' | 'denoised' | 'raw';
  position: boolean;
  spatialComplete: boolean;
  /** Why spatial analyses are unavailable, when they are. */
  spatialIssue?: string;
  /** The population page's target; only position needs Spatial setup. */
  populationTarget?: 'behaviors' | 'zones' | 'position';
  /** Labels usable by analyses (not blocked), by kind; `alignable`: what PETH can align to. */
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
  /** The setup cards the loaded data requires are complete. */
  setupComplete: boolean;
  /** Some setup card has content. */
  setupStarted: boolean;
  /** The loaded data makes a setup card required (a position file needs the arena). */
  setupRequired: boolean;
  hasRuns: boolean;
}

export const ITEM_LABEL: Record<ItemId, string> = {
  data: 'Data setup',
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

// Loading and the experiment's setup are both on Data setup.
const LOAD = { label: 'Data setup', item: 'data' as const };
const SETUP = { label: 'Data setup', item: 'data' as const };
const spatialNeed = (s: Snapshot) =>
  s.spatialIssue ?? 'Finish the Spatial setup (arena outline and scale).';

export const STATUS_TEXT: Record<StatusKind, string> = {
  not_started: 'Not started',
  optional: 'Optional',
  needs_input: 'Needs input',
  framework_update: 'Framework update required',
  ready: 'Ready',
  in_progress: 'In progress',
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
  // No analysis reads traces yet, so a trace chosen as the analysis data blocks them all.
  if (s.analysisKind && s.analysisKind !== 'deconvolved')
    need(
      `This analysis uses deconvolved events. Analysis data is set to ${s.analysisKind} traces.`,
      { label: 'Experiment config', item: 'data', entry: 'config' },
    );
  switch (id) {
    case 'place':
      if (!s.position) need('Load a position file.', LOAD);
      else if (!s.spatialComplete) need(spatialNeed(s), SETUP);
      break;
    case 'auroc':
      if (s.labels.behaviors < 1)
        need('Load behavior annotations with at least one usable label.', LOAD);
      break;
    case 'peth':
      if (s.labels.alignable < 1)
        need(
          'Load behavior annotations to align to. PETH does not align to zones or time markers yet.',
          LOAD,
        );
      for (const l of s.missingStimulusLabels)
        need(`Missing label '${l}' referenced by a stimulus.`, LOAD);
      break;
    case 'decoding':
      if (!s.deconvolved) need('Decoding needs deconvolved events.', LOAD);
      if (s.decodingTarget === 'position') {
        if (!s.position) need('Load a position file.', LOAD);
        else if (!s.spatialComplete) need(spatialNeed(s), SETUP);
      } else if (s.labels.behaviors < 2)
        need('Behavior decoding needs at least 2 usable labels.', LOAD);
      break;
    case 'population':
      if (s.populationTarget === 'position' && s.position && !s.spatialComplete)
        need(spatialNeed(s), SETUP);
      else if (s.populationStates < 2) need('Choose a target with at least 2 states.');
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

const ATTEMPT_TEXT: Record<NonNullable<RunState['lastAttempt']>, string> = {
  failed: 'failed',
  partial: 'only partly succeeded',
  cancelled: 'cancelled',
};

const progressText = (p?: number) =>
  p === undefined ? 'Running' : `Running ${Math.round(p * 100)}%`;

export function analysisStatus(s: Snapshot, id: AnalysisItem): Status {
  const run = s.runs[id];
  if (run?.running)
    return status('running', { text: progressText(run.progress), progress: run.progress });
  const needs = analysisNeeds(s, id);
  if (needs.input.length) return status('needs_input', needs);
  if (run?.result) {
    const kind = run.result.matches ? 'complete' : 'outdated';
    const note = run.lastAttempt && ` · last attempt ${ATTEMPT_TEXT[run.lastAttempt]}`;
    return status(kind, { ...needs, ...(note && { text: STATUS_TEXT[kind] + note }) });
  }
  if (run?.lastAttempt === 'failed' || run?.lastAttempt === 'partial')
    return status('failed', {
      ...needs,
      text: run.lastAttempt === 'partial' ? 'Failed: partial result only' : 'Failed',
    });
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
    case 'data': {
      // Loading and the experiment config together: complete once data is loaded and the setup
      // it needs is done.
      if (!s.neural) return status('not_started');
      const setup = itemStatus(s, 'setup');
      return setup.kind === 'complete' || setup.kind === 'optional'
        ? status('complete')
        : status('in_progress', { input: setup.input });
    }
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
      if (s.setupComplete && s.setupStarted) return status('complete');
      if (s.setupStarted) return status('in_progress');
      return s.setupRequired ? status('not_started') : status('optional');
    case 'viz':
    case 'qc':
    case 'prep':
      if (!s.neural)
        return status('needs_input', { input: [{ text: 'Load neural data first.', link: LOAD }] });
      // Looking at an optional page is not work, so opening it changes nothing.
      return status('optional');
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
  'data',
  'viz',
  'place',
  'auroc',
  'peth',
  'decoding',
  'population',
  'results',
];
const NEXT_SKIPS: ItemId[] = ['viz'];
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
    if (['complete', 'optional', 'running', 'framework_update'].includes(st.kind)) continue;
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
