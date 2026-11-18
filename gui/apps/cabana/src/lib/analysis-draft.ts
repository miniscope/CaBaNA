// Save, restore and reset of one analysis's settings, for the Configure settings window.
// The setting sections edit their store directly, so the window keeps a snapshot taken when it
// opened: Discard puts the snapshot back, Save keeps what is there. Reset to defaults leaves the
// choices that depend on the loaded data (behavior and label selections) alone.

import { reconcile } from 'solid-js/store';
import type { AnalysisItem } from './readiness.ts';
import { arena, setArena } from './arena.ts';
import { aurocSettings, DEFAULT_AUROC_SETTINGS, setAurocSettings } from './auroc-run.ts';
import {
  behaviorDecoding,
  decodeTarget,
  positionDecoding,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
} from './decoding-settings.ts';
import { DEFAULT_PETH_SETTINGS, pethSettings, setPethSettings } from './peth-run.ts';
import { DEFAULT_PLACE_SETTINGS, placeSettings, setPlaceSettings } from './place-run.ts';
import {
  DEFAULT_POPULATION,
  populationSettings,
  setPopulationSettings,
} from './population-settings.ts';

// Store values are proxies, which structuredClone refuses; the settings are plain JSON.
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Handle {
  read: () => object;
  write: (saved: never) => void;
  /** Back to the starting values, keeping the data-dependent choices. */
  reset: () => void;
}

const HANDLES: Record<AnalysisItem, Handle> = {
  place: {
    read: () => ({ place: placeSettings, binCm: arena.binCm, minOccupancy: arena.minOccupancy }),
    write: (s: { place: object; binCm?: number; minOccupancy: number }) => {
      setPlaceSettings(copy(s.place));
      setArena('binCm', s.binCm);
      setArena('minOccupancy', s.minOccupancy);
    },
    reset: () => {
      setPlaceSettings({ ...DEFAULT_PLACE_SETTINGS });
      setArena('binCm', undefined);
      setArena('minOccupancy', 0.05);
    },
  },
  auroc: {
    read: () => aurocSettings,
    write: (s: object) => setAurocSettings(reconcile(copy(s) as typeof aurocSettings)),
    reset: () =>
      setAurocSettings({
        ...copy(DEFAULT_AUROC_SETTINGS),
        unselected: [...aurocSettings.unselected],
        pairA: aurocSettings.pairA,
        pairB: aurocSettings.pairB,
      }),
  },
  peth: {
    read: () => pethSettings,
    write: (s: object) => setPethSettings(reconcile(copy(s) as typeof pethSettings)),
    reset: () =>
      setPethSettings({
        ...copy(DEFAULT_PETH_SETTINGS),
        unselected: [...pethSettings.unselected],
      }),
  },
  population: {
    read: () => populationSettings,
    write: (s: object) => setPopulationSettings(reconcile(copy(s) as typeof populationSettings)),
    reset: () =>
      setPopulationSettings({
        ...copy(DEFAULT_POPULATION),
        labels: [...populationSettings.labels],
      }),
  },
  decoding: {
    read: () => ({
      position: positionDecoding,
      behavior: behaviorDecoding,
      target: decodeTarget.type,
    }),
    write: (s: { position: object; behavior: object; target: 'position' | 'behaviors' }) => {
      setPositionDecoding(reconcile(copy(s.position) as typeof positionDecoding));
      setBehaviorDecoding(reconcile(copy(s.behavior) as typeof behaviorDecoding));
      setDecodeTarget('type', s.target);
    },
    // Only the chosen target's settings, as the page's Starting settings button does.
    reset: () => {
      if (decodeTarget.type === 'position') setPositionDecoding({ ...DEFAULT_POSITION_DECODING });
      else setBehaviorDecoding({ ...DEFAULT_BEHAVIOR_DECODING, labels: [] });
    },
  },
};

/** The analysis's settings now, as text to compare and to restore from. */
export const snapshotSettings = (id: AnalysisItem): string => JSON.stringify(HANDLES[id].read());

export const restoreSettings = (id: AnalysisItem, snapshot: string): void =>
  HANDLES[id].write(JSON.parse(snapshot) as never);

export const resetSettings = (id: AnalysisItem): void => HANDLES[id].reset();

export const settingsChanged = (id: AnalysisItem, snapshot: string): boolean =>
  snapshotSettings(id) !== snapshot;
