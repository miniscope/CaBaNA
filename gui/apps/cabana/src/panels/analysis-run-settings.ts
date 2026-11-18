// "Use these settings": copy a saved run's analysis settings into the current ones, through the
// loader each analysis already has. Returns a message when the run's settings cannot be read.

import { reconcile } from 'solid-js/store';
import type { RunRecord } from '../lib/bridge-client.ts';
import { loadAurocSettings } from '../lib/auroc-run.ts';
import {
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
} from '../lib/decoding-settings.ts';
import { DEFAULT_PETH_SETTINGS, setPethSettings } from '../lib/peth-run.ts';
import { loadPlaceSettings } from '../lib/place-run.ts';
import { analysisSection } from '../lib/run-settings-view.ts';
import { loadSavedSettings } from './PopulationResults.tsx';

function loadDecodingSettings(rec: RunRecord): void {
  const { type, ...rest } = analysisSection(rec);
  if (type === 'behaviors') {
    setBehaviorDecoding(
      reconcile({
        ...DEFAULT_BEHAVIOR_DECODING,
        ...rest,
        labels: [...((rest.labels as string[]) ?? [])],
      } as typeof DEFAULT_BEHAVIOR_DECODING),
    );
    setDecodeTarget('type', 'behaviors');
  } else {
    setPositionDecoding(
      reconcile({ ...DEFAULT_POSITION_DECODING, ...rest } as typeof DEFAULT_POSITION_DECODING),
    );
    setDecodeTarget('type', 'position');
  }
}

/** PETH records keep their settings flat; only the fields PETH has are copied. */
function loadPethSettings(rec: RunRecord): void {
  const saved = analysisSection(rec);
  setPethSettings(
    JSON.parse(
      JSON.stringify(
        Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULT_PETH_SETTINGS)),
      ),
    ),
  );
}

export function loadRunSettings(rec: RunRecord): string | undefined {
  switch (rec.analysis) {
    case 'place':
      return void loadPlaceSettings(rec);
    case 'auroc':
      return void loadAurocSettings(rec);
    case 'peth':
      return void loadPethSettings(rec);
    case 'decoding':
      return void loadDecodingSettings(rec);
    case 'population':
      return loadSavedSettings(rec.gui.settings);
  }
}
