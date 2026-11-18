// Import preprocessing settings from another project or session: which settings a pop-up has, how
// each reads in the source and here, and which are ticked at first. QC decisions (rejected cells,
// jump choices, annotation fixes) are never part of this.

import type { PrepKey } from './prep-deps.ts';
import type { PrepValues } from './qc-draft.ts';

export const PREP_LABEL: Partial<Record<PrepKey, string>> = {
  eventSigmaS: 'Event smoothing',
  traceSigmaS: 'Smooth traces',
  fillGapS: 'Fill tracking gaps up to',
  posMethod: 'Position smoothing method',
  posWindowS: 'Position smoothing window',
  maxGapS: 'Gap limit onto neural frames',
  speedWindowS: 'Speed window',
  labelPadS: 'Bout padding',
};

/** A value as the pop-ups show it: seconds with two decimals, 0 as off, a method by name. */
export function prepText(key: PrepKey, v: PrepValues[PrepKey] | undefined): string {
  if (v === undefined) return 'not in that file';
  if (typeof v === 'string') return v;
  const standard = key === 'maxGapS' || key === 'speedWindowS';
  return v === 0 && !standard ? 'off' : `${v.toFixed(2)} s`;
}

export interface ImportRow {
  key: PrepKey;
  label: string;
  /** The value in the source; undefined when the source does not have it. */
  from: PrepValues[PrepKey] | undefined;
  now: PrepValues[PrepKey];
  /** Differs from the value here, so ticked at first. */
  differs: boolean;
}

/** One row per setting of the open pop-up that the source has. */
export function importRows(
  keys: readonly PrepKey[],
  source: Partial<PrepValues> | undefined,
  now: (key: PrepKey) => PrepValues[PrepKey],
): ImportRow[] {
  return keys.map((key) => {
    const from = source?.[key];
    return {
      key,
      label: PREP_LABEL[key] ?? key,
      from,
      now: now(key),
      differs: from !== undefined && from !== now(key),
    };
  });
}

/** The values of the ticked rows that the source has. */
export const chosenValues = (
  rows: ImportRow[],
  ticked: ReadonlySet<PrepKey>,
): Partial<PrepValues> =>
  Object.fromEntries(
    rows.filter((r) => ticked.has(r.key) && r.from !== undefined).map((r) => [r.key, r.from]),
  );
