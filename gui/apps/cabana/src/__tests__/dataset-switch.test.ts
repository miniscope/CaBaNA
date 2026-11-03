// Loading another dataset puts every dataset-specific value back to its default.

import { describe, expect, it } from 'vitest';
import { arena, setArena } from '../lib/arena.ts';
import { aurocSettings, DEFAULT_AUROC_SETTINGS, setAurocSettings } from '../lib/auroc-run.ts';
import { setIndicator, tauDecay } from '../lib/decon-state.ts';
import {
  behaviorDecoding,
  decodeTarget,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
  positionDecoding,
  DEFAULT_POSITION_DECODING,
} from '../lib/decoding-settings.ts';
import { DEFAULT_PETH_SETTINGS, pethSettings, setPethSettings } from '../lib/peth-run.ts';
import { DEFAULT_PLACE_SETTINGS, placeSettings, setPlaceSettings } from '../lib/place-run.ts';
import {
  DEFAULT_POPULATION,
  populationSettings,
  setPopulationSettings,
} from '../lib/population-settings.ts';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { posRange, reviewed, setPosRange, setReviewed } from '../lib/qc-view.ts';
import { buildSnapshot, markVisited } from '../lib/readiness-snapshot.ts';
import {
  addFiles,
  cell,
  DEFAULT_TOL,
  experimentId,
  maxSpeed,
  selectCell,
  sessionName,
  setExperiment,
  setMaxSpeed,
  setSource,
  setTol,
  source,
  tol,
} from '../lib/store.ts';
import { hoverT, setHoverT } from '../lib/viz.ts';

/** A session folder, as the folder picker gives it. */
function folder(name: string): File[] {
  const f = (file: string, text: string) => {
    const x = new File([text], file);
    Object.defineProperty(x, 'webkitRelativePath', { value: `${name}/${file}` });
    return x;
  };
  return [
    f('position.csv', 'frame,x,y\n0,1,1\n1,2,2\n'),
    f('behavior_timestamps.csv', 'frame number,time stamp\n0,0\n1,33\n'),
  ];
}

/** Change every dataset-specific value away from its default. */
function editEverything(): void {
  setExperiment('open_field');
  setSource({
    clockOffsetS: 0.35,
    clockScale: 1.0004,
    positionUnit: 'px',
    yDown: true,
    bodyPart: 'Head',
    subjectId: 'M1',
  });
  setMaxSpeed(80);
  setTol('lostPct', 9);
  selectCell(7);
  setPrep('posWindowS', 0.9);
  setIndicator('gcamp8m');
  setReviewed('timing', true);
  setPosRange([1, 2]);
  setHoverT(3);
  setArena({ binCm: 4, minOccupancy: 0.2, box: { x: 1, y: 2, w: 3, h: 4 } });
  setPlaceSettings('nShuffles', 321);
  setAurocSettings({ nShuffles: 222, unselected: ['groom'], pairA: 'sniff' });
  setPethSettings({ align: 'offset', unselected: ['rear'] });
  setPopulationSettings({ binS: 2, labels: ['a', 'b'] });
  setPositionDecoding('folds', 9);
  setBehaviorDecoding({ C: 3, labels: ['x'] });
  setDecodeTarget('type', 'behaviors');
  markVisited('setup');
}

describe('switching datasets', () => {
  it('resets every dataset-specific value when another folder is loaded', async () => {
    await addFiles(folder('A'));
    expect(sessionName()).toBe('A');
    editEverything();

    await addFiles(folder('B'));
    expect(sessionName()).toBe('B');
    expect(experimentId()).toBe('custom');
    expect(source.clockOffsetS).toBe(0);
    expect(source.clockScale).toBe(1);
    expect(source.positionUnit).toBe('cm');
    expect(source.yDown).toBe(false);
    expect(source.bodyPart).toBe('');
    expect(source.subjectId).toBe('');
    expect(maxSpeed()).toBe(60);
    expect({ ...tol }).toEqual(DEFAULT_TOL);
    expect(cell()).toBe(0);
    expect({ ...prep }).toEqual(DEFAULT_PREP);
    expect(tauDecay()).toBe(0.6);
    expect({ ...reviewed }).toEqual({});
    expect(posRange()).toBeUndefined();
    expect(hoverT()).toBeUndefined();
    expect(arena.box).toBeUndefined();
    expect(arena.binCm).toBeUndefined();
    expect({ ...placeSettings }).toEqual(DEFAULT_PLACE_SETTINGS);
    expect(aurocSettings.nShuffles).toBe(DEFAULT_AUROC_SETTINGS.nShuffles);
    expect(aurocSettings.unselected).toEqual([]);
    expect(pethSettings.align).toBe(DEFAULT_PETH_SETTINGS.align);
    expect(populationSettings.binS).toBe(DEFAULT_POPULATION.binS);
    expect(populationSettings.labels).toEqual([]);
    expect(positionDecoding.folds).toBe(DEFAULT_POSITION_DECODING.folds);
    expect(behaviorDecoding.labels).toEqual([]);
    expect(decodeTarget.type).toBe('position');
    expect(buildSnapshot().visited).toEqual({});
  });

});
