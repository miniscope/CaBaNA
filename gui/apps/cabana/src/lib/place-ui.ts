// What differs between the last place-cell run and the settings now.

import { arena, effectiveBin } from './arena.ts';
import { DEFAULT_PLACE_SETTINGS, placeOutcome, placeSettings } from './place-run.ts';
import { describeChanges, PLACE_LABELS, runMatch } from './engine.ts';
import { prepChanges } from './prep-deps.ts';

const LABELS: Partial<Record<keyof typeof DEFAULT_PLACE_SETTINGS, string>> = {
  nShuffles: 'number of shuffles',
  alpha: 'significance threshold',
  fieldThreshold: 'fraction of peak',
  minFieldBins: 'smallest region',
  minOccFieldsS: 'minimum time per bin (place-field boundaries)',
  seed: 'seed',
};

/** The settings that changed since the last run, in words. Empty when there is no run or nothing changed. */
export function placeChanges(): string[] {
  const o = placeOutcome();
  if (!o) return [];
  // A framework run is compared by the hash of its settings, not field by field.
  if (o.record) return describeChanges(runMatch('place')?.diff ?? [], PLACE_LABELS);
  const a = o.settings;
  const b = placeSettings;
  const out: string[] = [];
  out.push(...prepChanges('place', o.prep, true));
  if (effectiveBin() !== o.data.grid.bin) out.push('bin size');
  if (a.minOccS !== arena.minOccupancy) out.push('minimum time per bin (spatial tuning)');
  if (a.sigmaAuto !== b.sigmaAuto || (!b.sigmaAuto && a.sigma !== b.sigma)) out.push('smoothing');
  if (a.shiftAuto !== b.shiftAuto || (!b.shiftAuto && a.minShiftS !== b.minShiftS))
    out.push('minimum circular shift');
  for (const [k, label] of Object.entries(LABELS) as [
    keyof typeof LABELS & keyof typeof a,
    string,
  ][])
    if (a[k] !== b[k]) out.push(label);
  return out;
}
