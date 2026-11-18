// What a saved run's "Settings used" window shows: the analysis section and the processing settings
// of the run record, as indented text. Pure functions of the record.

import type { RunRecord } from './bridge-client.ts';

type Saved = { analysis?: Record<string, unknown>; prep?: Record<string, unknown> };

/**
 * The analysis settings the run used. A framework record keeps them under `analysis`; a record of
 * a run made in the browser keeps the settings directly.
 */
export function analysisSection(r: RunRecord): Record<string, unknown> {
  const s = (r.gui.settings ?? {}) as Saved & Record<string, unknown>;
  return s.analysis ?? s;
}

/** The processing (Preprocess) settings at the time of the run, or undefined when not recorded. */
export function processingSection(r: RunRecord): Record<string, unknown> | undefined {
  return ((r.gui.settings ?? {}) as Saved).prep;
}

const scalar = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

/** `key: value` lines, nested values indented, short lists on one line. */
export function yamlText(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null))
      return `${pad}[${value.map(scalar).join(', ')}]`;
    return value.map((v) => `${pad}-\n${yamlText(v, indent + 2)}`).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const nested = v && typeof v === 'object' && !isShortList(v);
        return nested
          ? `${pad}${k}:\n${yamlText(v, indent + 2)}`
          : `${pad}${k}: ${isShortList(v) ? yamlText(v).trim() : scalar(v)}`;
      })
      .join('\n');
  }
  return `${pad}${scalar(value)}`;
}
const isShortList = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null);

/** "11 files, e822bf33": the data a run read, as short file fingerprints. */
export const dataVersion = (r: RunRecord) =>
  r.session.inputs.length
    ? `${r.session.inputs.length} files, ${r.session.inputs[0].sha256.slice(0, 8)}`
    : 'not recorded';
