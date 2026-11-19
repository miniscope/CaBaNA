// Comparing the settings two saved runs used: the analysis section and the processing settings, by
// label. A pure function of the two records; comparison with the settings now is the
// configuration file viewer's (it reads the project's files).

import type { RunRecord } from './bridge-client.ts';
import { settingRows } from './run-info.ts';
import { analysisSection, processingSection } from './run-settings-view.ts';

export interface SettingDifference {
  k: string;
  /** The value in the first run, or "—" when it did not record one. */
  a: string;
  b: string;
}

const NOT_SAVED = '—';

function labelled(r: RunRecord): Map<string, string> {
  return new Map([
    ...settingRows(analysisSection(r)).map((x) => [x.k, x.v] as const),
    ...settingRows(processingSection(r)).map(
      (x) => [`Processing: ${x.k.toLowerCase()}`, x.v] as const,
    ),
  ]);
}

/** The settings whose value differs between two runs, in the order the first run lists them. */
export function compareSettings(a: RunRecord, b: RunRecord): SettingDifference[] {
  const [x, y] = [labelled(a), labelled(b)];
  const keys = [...new Set([...x.keys(), ...y.keys()])];
  return keys
    .filter((k) => x.get(k) !== y.get(k))
    .map((k) => ({ k, a: x.get(k) ?? NOT_SAVED, b: y.get(k) ?? NOT_SAVED }));
}
