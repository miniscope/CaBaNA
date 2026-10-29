import { describe, expect, it } from 'vitest';
import {
  analysisStatus,
  itemStatus,
  nextItem,
  nextStep,
  STATUS_TEXT,
  statusDetail,
  TONE,
  type AnalysisItem,
  type Snapshot,
} from '../lib/readiness.ts';
import { PARADIGMS } from '../lib/experiments.ts';

const base = (over: Partial<Snapshot> = {}): Snapshot => ({
  neural: true,
  timing: true,
  deconvolved: true,
  position: true,
  spatialComplete: true,
  labels: { epochs: 3, behaviors: 3, zones: 0, alignable: 3 },
  missingStimulusLabels: [],
  bridge: 'ready',
  capabilities: {},
  frameworkEngine: { decoding: true, population: true },
  populationStates: 3,
  decodingTarget: 'position',
  runs: {},
  visited: {},
  setupComplete: false,
  hasRuns: false,
  ...over,
});
const texts = (s: { input: { text: string }[] }) => s.input.map((i) => i.text);
const done = { setup: true, viz: true, qc: true, prep: true } as const;

describe('item status', () => {
  it('empty app: Load is the only work; everything else is reachable but needs input', () => {
    const empty = base({
      neural: false,
      timing: false,
      position: false,
      labels: { epochs: 0, behaviors: 0, zones: 0, alignable: 0 },
    });
    expect(itemStatus(empty, 'load').kind).toBe('not_started');
    expect(itemStatus(empty, 'setup')).toMatchObject({ kind: 'needs_input' });
    expect(itemStatus(empty, 'setup').input[0].link?.item).toBe('load');
    expect(texts(itemStatus(empty, 'place'))[0]).toMatch(/Load neural data/);
    expect(itemStatus(empty, 'results')).toMatchObject({
      kind: 'optional',
      text: 'No results yet',
    });
  });
  it('optional pages are never "Not started"', () => {
    for (const id of ['viz', 'qc', 'prep'] as const) {
      expect(itemStatus(base(), id)).toMatchObject({ kind: 'optional', text: 'Optional' });
      expect(itemStatus(base({ visited: { [id]: true } }), id)).toMatchObject({
        kind: 'viewed',
        text: 'Viewed',
      });
    }
  });
  it('setup: not started, in progress once visited, complete when required cards are done', () => {
    expect(itemStatus(base(), 'setup').kind).toBe('not_started');
    expect(itemStatus(base({ visited: { setup: true } }), 'setup')).toMatchObject({
      kind: 'in_progress',
      text: 'In progress',
    });
    expect(itemStatus(base({ setupComplete: true }), 'setup').kind).toBe('complete');
  });
  it('place cells need position and finished spatial setup', () => {
    expect(texts(analysisStatus(base({ position: false }), 'place'))).toContain(
      'Load a position file.',
    );
    const s = analysisStatus(base({ spatialComplete: false }), 'place');
    expect(s.kind).toBe('needs_input');
    expect(s.input[0].link?.item).toBe('setup');
    expect(analysisStatus(base(), 'place').kind).toBe('ready');
  });
  it('spatial setup blocks only analyses that use position', () => {
    const s = base({ spatialComplete: false, capabilities: { decoding_fold_gap: true } });
    expect(analysisStatus(s, 'auroc').kind).toBe('ready');
    expect(analysisStatus(s, 'population').kind).toBe('ready');
    const beh = analysisStatus({ ...s, decodingTarget: 'behaviors' }, 'decoding');
    expect(texts(beh).join(' ')).not.toMatch(/Spatial/);
  });
  it('a stimulus with a missing label blocks PETH only', () => {
    const s = base({ missingStimulusLabels: ['tone'] });
    expect(texts(analysisStatus(s, 'peth'))).toContain(
      "Missing label 'tone' referenced by a stimulus.",
    );
    expect(analysisStatus(s, 'place').kind).toBe('ready');
    expect(analysisStatus(s, 'auroc').kind).toBe('ready');
  });
  it('a missing framework feature is "Framework update required", not user input', () => {
    const s = analysisStatus(base(), 'decoding');
    expect(s).toMatchObject({ kind: 'framework_update', text: 'Framework update required' });
    expect(s.input).toEqual([]);
    expect(s.framework[0].code).toBe('F1');
    expect(s.framework[0].text).not.toMatch(/\bF1\b/);
    const ok = base({ capabilities: { decoding_fold_gap: true, overlap_policy: true } });
    expect(analysisStatus(ok, 'decoding').kind).toBe('ready');
    const beh = analysisStatus(
      { ...ok, decodingTarget: 'behaviors', capabilities: { decoding_fold_gap: true } },
      'decoding',
    );
    expect(beh.framework.map((f) => f.code)).toEqual(['F3']);
  });
  it('a stopped Python engine blocks framework analyses only', () => {
    const s = base({ bridge: 'offline' });
    expect(analysisStatus(s, 'population')).toMatchObject({
      kind: 'framework_update',
      text: 'Python engine not running',
      engineOff: true,
    });
    expect(analysisStatus(s, 'peth').kind).toBe('ready');
    expect(analysisStatus(base({ bridge: 'connecting' }), 'population').text).toMatch(/Connecting/);
  });
  it('user input comes before engine problems', () => {
    const s = analysisStatus(base({ bridge: 'offline', populationStates: 1 }), 'population');
    expect(s.kind).toBe('needs_input');
    expect(s.engineOff).toBe(true);
  });
  it('saved results stay Complete with the engine stopped', () => {
    const s = base({
      bridge: 'offline',
      runs: { population: { running: false, issues: [], latest: { status: 'ok', matches: true } } },
    });
    expect(analysisStatus(s, 'population').kind).toBe('complete');
  });
  it('running shows a percent only when progress is measurable', () => {
    const run = (r: NonNullable<Snapshot['runs']['population']>) =>
      analysisStatus(base({ runs: { population: r } }), 'population');
    expect(run({ running: true, progress: 0.4, issues: [] })).toMatchObject({
      kind: 'running',
      text: 'Running 40%',
    });
    expect(run({ running: true, issues: [] }).text).toBe('Running');
  });
  it('complete, outdated and failed come from the latest run', () => {
    const run = (r: NonNullable<Snapshot['runs']['population']>) =>
      analysisStatus(base({ runs: { population: r } }), 'population');
    expect(run({ running: false, issues: [], latest: { status: 'ok', matches: true } }).kind).toBe(
      'complete',
    );
    expect(run({ running: false, issues: [], latest: { status: 'ok', matches: false } }).kind).toBe(
      'outdated',
    );
    expect(
      run({ running: false, issues: [], latest: { status: 'failed', matches: true } }).kind,
    ).toBe('failed');
    expect(run({ running: false, issues: ['Too few usable bins'] }).kind).toBe('needs_input');
  });
});

describe('Next', () => {
  const ready = base({ visited: done, setupComplete: true });
  it('walks the steps in order and skips Complete ones', () => {
    expect(nextItem(ready, 'load')).toBe('place');
    expect(nextItem(base(), 'load')).toBe('setup');
    expect(nextItem(base({ visited: { setup: true }, setupComplete: true }), 'load')).toBe('prep');
  });
  it('never offers Data visualization or Data QC', () => {
    const s = base({ setupComplete: true });
    expect(nextItem(s, 'load')).toBe('prep');
    expect(nextItem(s, 'setup')).toBe('prep');
  });
  it('goes to the step that provides a missing prerequisite', () => {
    const s = base({ spatialComplete: false, visited: done, setupComplete: false });
    expect(nextItem(s, 'prep', ['place', 'auroc'])).toBe('setup');
  });
  it('stays on the page that supplies what is missing, and says what', () => {
    const s = base({ neural: false, timing: false });
    expect(nextStep(s, 'load')).toMatchObject({ item: 'load', blocked: 'Load neural data first.' });
  });
  it('skips analyses that need a framework update or the engine', () => {
    expect(nextItem(base({ ...ready, bridge: 'offline' }), 'prep', ['population', 'auroc'])).toBe(
      'auroc',
    );
  });
  it('ends at Results and stays there', () => {
    expect(nextItem(base(), 'population')).toBe('results');
    expect(nextItem(base(), 'results')).toBe('results');
  });
  it('limits analyses to the recommended ones', () => {
    expect(nextItem(ready, 'prep', ['auroc'])).toBe('auroc');
  });
  it('skips a Complete analysis and goes to the next recommended one', () => {
    const s = base({
      ...ready,
      runs: { population: { running: false, issues: [], latest: { status: 'ok', matches: true } } },
    });
    expect(nextItem(s, 'prep', ['population', 'auroc'])).toBe('auroc');
  });

  /** The path a user takes by pressing Next until Results, doing what each page asks. */
  function walk(paradigm: string, over: Partial<Snapshot> = {}): string[] {
    const recommended = PARADIGMS.find((p) => p.id === paradigm)!.recommended;
    let s = base({ capabilities: { decoding_fold_gap: true, overlap_policy: true }, ...over });
    const path: string[] = ['load'];
    for (let i = 0; i < 12 && path.at(-1) !== 'results'; i++) {
      const item = nextItem(s, path.at(-1) as never, recommended);
      path.push(item);
      s = {
        ...s,
        visited: { ...s.visited, [item]: true },
        setupComplete: s.setupComplete || item === 'setup',
        runs: ['place', 'auroc', 'peth', 'decoding', 'population'].includes(item)
          ? {
              ...s.runs,
              [item as AnalysisItem]: {
                running: false,
                issues: [],
                latest: { status: 'ok', matches: true },
              },
            }
          : s.runs,
      };
    }
    return path;
  }
  it('open field: Load, Setup, Preprocess, place cells, population, Results', () => {
    expect(walk('open_field')).toEqual(['load', 'setup', 'prep', 'place', 'population', 'results']);
  });
  it('social interaction: auROC, population, decoding', () => {
    expect(walk('social_interaction')).toEqual([
      'load',
      'setup',
      'prep',
      'auroc',
      'decoding',
      'population',
      'results',
    ]);
  });
});

describe('sidebar tones', () => {
  it('every kind maps to one of the five statuses, and viewing is never Complete', () => {
    expect(Object.keys(TONE).sort()).toEqual(Object.keys(STATUS_TEXT).sort());
    expect(TONE.viewed).toBe('not_started');
    expect(TONE.running).toBe('in_progress');
    expect(TONE.outdated).toBe('outdated');
  });
  it('the detail names what is missing', () => {
    expect(statusDetail(analysisStatus(base({ neural: false }), 'place'))).toMatch(
      /Load neural data/,
    );
  });
});
