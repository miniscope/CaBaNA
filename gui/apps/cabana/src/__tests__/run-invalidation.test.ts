// A saved result needs a rerun when something it read changed: its settings, the Preprocess
// values it used, the input files, the clock alignment, the position calibration, the arena,
// rejected cells, or the labels it reads. Display settings and labels it does not read leave it
// alone.

import { beforeAll, describe, expect, it } from 'vitest';
import { setArena } from '../lib/arena.ts';
import { registerAnalyses } from '../lib/analysis-registry.ts';
import { aurocSettings, aurocUses, setAurocSettings } from '../lib/auroc-run.ts';
import { describeChanges, PLACE_LABELS } from '../lib/engine.ts';
import { pethChanges, pethSettingChanges } from '../lib/peth-view.ts';
import {
  pethSettings,
  pethUses,
  setPethOutcome,
  setPethSettings,
  type PethOutcome,
} from '../lib/peth-run.ts';
import { PLACE_USES } from '../lib/place-run.ts';
import { prep } from '../lib/preprocess.ts';
import { depChanges, runDeps, type Uses } from '../lib/run-deps.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { compareToRecord, settingsOf } from '../lib/runs.ts';
import { settingsHash } from '../lib/settings-hash.ts';
import {
  addFiles,
  editAnnotations,
  rejectCells,
  setColorBy,
  setRole,
  setSource,
  undoAnnotationEdits,
} from '../lib/store.ts';

const timestamps = (n: number, ms: number) =>
  'Frame Number,Time Stamp (ms),Buffer Index\n' +
  Array.from({ length: n }, (_, i) => `${i},${i * ms},0`).join('\n');
const position = (dx: number) =>
  'frame,x,y\n' +
  Array.from({ length: 100 }, (_, i) => `${i},${5 + dx + i * 0.2},${10}`).join('\n');
// groom has two bouts 0.1 s apart, so merging short gaps changes its bouts and not rear's.
const ANNOTATIONS = 'label,start_s,stop_s\ngroom,1,1.5\ngroom,1.6,2\nrear,3,3.5\n';

beforeAll(async () => {
  await addFiles([
    new File([timestamps(100, 50)], 'neural_timestamps.csv'),
    new File([timestamps(100, 50)], 'behavior_timestamps.csv'),
    new File([position(0)], 'position.csv'),
    new File([ANNOTATIONS], 'behavior_annotations.csv'),
  ]);
  setArena({ width: 40, height: 20 });
});

/** What changed after `edit`, for a run that uses `u`; the edit is undone afterwards. */
function changesAfter(u: () => Uses, edit: () => void, undo: () => void): string[] {
  const before = runDeps(u());
  edit();
  const out = depChanges(before, runDeps(u()));
  undo();
  return out;
}

describe('place cells', () => {
  const u = () => PLACE_USES;
  it('needs a rerun after a change to what it reads', async () => {
    expect(
      changesAfter(
        u,
        () => setSource('clockOffsetS', 0.2),
        () => setSource('clockOffsetS', 0),
      ),
    ).toEqual(['clock alignment']);
    expect(
      changesAfter(
        u,
        () => setArena('binCm', 5),
        () => setArena('binCm', undefined),
      ),
    ).toEqual(['arena or excluded regions']);
    expect(
      changesAfter(
        u,
        () => setSource('yDown', true),
        () => setSource('yDown', false),
      ),
    ).toEqual(['position calibration']);
    expect(
      changesAfter(
        u,
        () => rejectCells([2]),
        () => undefined,
      ),
    ).toEqual(['rejected cells']);
    const before = runDeps(u());
    await addFiles([new File([position(1)], 'position.csv')]);
    expect(depChanges(before, runDeps(u()))).toEqual(['input files']);
  });
  it('ignores labels it does not read and display settings', () => {
    expect(
      changesAfter(
        u,
        () => setRole('groom', 'controlled'),
        () => setRole('groom', 'measured'),
      ),
    ).toEqual([]);
    expect(changesAfter(u, () => editAnnotations('merge'), undoAnnotationEdits)).toEqual([]);
    expect(
      changesAfter(
        u,
        () => setColorBy('quality'),
        () => setColorBy('cell'),
      ),
    ).toEqual([]);
  });
});

describe('auROC', () => {
  const u = () => aurocUses(aurocSettings);
  it('needs a rerun after a change to a label it tests or to the clock', () => {
    expect(
      changesAfter(
        u,
        () => setRole('groom', 'controlled'),
        () => setRole('groom', 'measured'),
      ),
    ).toEqual(['labels or their corrections']);
    expect(changesAfter(u, () => editAnnotations('merge'), undoAnnotationEdits)).toEqual([
      'labels or their corrections',
    ]);
    expect(
      changesAfter(
        u,
        () => setSource('clockOffsetS', 0.2),
        () => setSource('clockOffsetS', 0),
      ),
    ).toEqual(['clock alignment']);
  });
  it('ignores position without a speed filter, and labels left out of the run', () => {
    expect(
      changesAfter(
        u,
        () => setSource('yDown', true),
        () => setSource('yDown', false),
      ),
    ).toEqual([]);
    expect(
      changesAfter(
        u,
        () => setArena('binCm', 5),
        () => setArena('binCm', undefined),
      ),
    ).toEqual([]);
    setAurocSettings('unselected', ['rear']);
    expect(
      changesAfter(
        u,
        () => setRole('rear', 'controlled'),
        () => setRole('rear', 'measured'),
      ),
    ).toEqual([]);
    setAurocSettings('unselected', []);
  });
  it('reads position once its speed filter is on', () => {
    setAurocSettings('speedFilter', true);
    expect(
      changesAfter(
        u,
        () => setSource('yDown', true),
        () => setSource('yDown', false),
      ),
    ).toEqual(['position calibration']);
    setAurocSettings('speedFilter', false);
  });
});

describe('PETH', () => {
  const outcome = () =>
    ({
      settings: JSON.parse(JSON.stringify(pethSettings)),
      prep: { ...prep },
      deps: runDeps(pethUses(pethSettings)),
    }) as unknown as PethOutcome;
  it('treats the Wilcoxon display switch as display only', () => {
    setPethOutcome(outcome());
    setPethSettings('wilcoxon', !pethSettings.wilcoxon);
    expect(pethSettingChanges()).toEqual([]);
    setPethSettings('alpha', 0.01);
    expect(pethSettingChanges()).toEqual(['analysis settings']);
  });
  it('needs a rerun after a change to the bouts it aligns to', () => {
    setPethOutcome(outcome());
    editAnnotations('merge');
    expect(pethChanges()).toEqual(['labels or their corrections']);
    undoAnnotationEdits();
    expect(pethChanges()).toEqual([]);
    expect(
      changesAfter(
        () => pethUses(pethSettings),
        () => setSource('yDown', true),
        () => setSource('yDown', false),
      ),
    ).toEqual([]);
  });
});

describe('framework runs', () => {
  it('compare every dependency through the saved hash, and ignore display settings', async () => {
    registerAnalyses();
    const settings = (await settingsOf('place'))!;
    const rec = {
      scope: 'full',
      gui: { settings, settings_sha256: await settingsHash(settings) },
    } as unknown as RunRecord;
    expect((await compareToRecord('place', rec))?.matches).toBe(true);

    setColorBy('quality'); // footprint coloring is display only
    expect((await compareToRecord('place', rec))?.matches).toBe(true);
    setColorBy('cell');

    setSource('clockOffsetS', 0.2);
    const changed = await compareToRecord('place', rec);
    expect(changed?.matches).toBe(false);
    expect(describeChanges(changed!.diff, PLACE_LABELS)).toEqual(['clock alignment']);
    setSource('clockOffsetS', 0);

    setRole('groom', 'controlled'); // place cells read no labels
    expect((await compareToRecord('place', rec))?.matches).toBe(true);
    setRole('groom', 'measured');
  });
});
