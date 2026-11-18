import { describe, expect, it } from 'vitest';
import {
  resetSettings,
  restoreSettings,
  settingsChanged,
  snapshotSettings,
} from '../lib/analysis-draft.ts';
import { aurocSettings, setAurocSettings } from '../lib/auroc-run.ts';
import { DEFAULT_PETH_SETTINGS, pethSettings, setPethSettings } from '../lib/peth-run.ts';

describe('analysis settings snapshot', () => {
  it('puts the earlier settings back after edits', () => {
    const before = snapshotSettings('peth');
    setPethSettings('nShuffles', 77);
    expect(settingsChanged('peth', before)).toBe(true);
    restoreSettings('peth', before);
    expect(pethSettings.nShuffles).toBe(DEFAULT_PETH_SETTINGS.nShuffles);
    expect(settingsChanged('peth', before)).toBe(false);
  });

  it('resets to the starting values but keeps the behavior selection', () => {
    setAurocSettings({ nShuffles: 12, unselected: ['grooming'] });
    resetSettings('auroc');
    expect(aurocSettings.nShuffles).toBe(1000);
    expect([...aurocSettings.unselected]).toEqual(['grooming']);
    setAurocSettings('unselected', []);
  });
});
