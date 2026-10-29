// Frame-label files: one CSV with a frame column plus signal, binary (0/1) and categorical
// (text) columns. Rows join to camera frames by frame number, as position does.

import { parseCsvText } from './csv-text.ts';
import type { Table } from './parse.ts';

export type ColumnRole = 'frame' | 'binary' | 'categorical' | 'signal' | 'ignore';

export interface FrameLabelMapping {
  frameColumn: string;
  binary: string[];
  categorical: string[];
  signals: string[];
}

/** One value per frame. Binary: 1, 0 or null (missing). Categorical: text or null (unlabeled). */
export interface FrameLabels {
  frames: number[];
  binary: Record<string, (0 | 1 | null)[]>;
  categorical: Record<string, (string | null)[]>;
  signals: Record<string, number[]>;
  /** Anything that makes the file unusable: duplicate or non-numeric frame numbers, values that are not 0/1. */
  errors: string[];
}

export function readFrameTable(text: string): Table {
  return parseCsvText(text);
}

const isBlank = (v: string | undefined) => v === undefined || v.trim() === '';

/** First guess at what each column is; the user confirms it in the import mapping table. */
export function suggestRoles(table: Table, frameColumn = 'frame'): Record<string, ColumnRole> {
  const roles: Record<string, ColumnRole> = {};
  table.columns.forEach((name, i) => {
    if (name.toLowerCase() === frameColumn.toLowerCase()) return void (roles[name] = 'frame');
    const values = table.rows.map((r) => r[i]).filter((v) => !isBlank(v));
    if (!values.length) roles[name] = 'ignore';
    else if (values.some((v) => !Number.isFinite(Number(v)))) roles[name] = 'categorical';
    else if (values.every((v) => Number(v) === 0 || Number(v) === 1)) roles[name] = 'binary';
    else roles[name] = 'signal';
  });
  return roles;
}

export function readFrameLabels(text: string, mapping: FrameLabelMapping): FrameLabels {
  const t = readFrameTable(text);
  const out: FrameLabels = { frames: [], binary: {}, categorical: {}, signals: {}, errors: [] };
  const at = (name: string) => {
    const i = t.columns.indexOf(name);
    if (i < 0) out.errors.push(`Column "${name}" is not in the file.`);
    return i;
  };
  const f = at(mapping.frameColumn);
  if (f < 0) return out;

  out.frames = t.rows.map((r) => Number(r[f]));
  const bad = t.rows.filter((r) => isBlank(r[f]) || !Number.isInteger(Number(r[f]))).length;
  if (bad) out.errors.push(`${bad} row(s) have a frame number that is not a whole number.`);
  const seen = new Set<number>();
  const dup = new Set(out.frames.filter((n) => seen.size === seen.add(n).size));
  if (dup.size) out.errors.push(`Duplicate frame numbers: ${[...dup].slice(0, 5).join(', ')}.`);

  for (const name of mapping.binary) {
    const i = at(name);
    if (i < 0) continue;
    const values = t.rows.map((r) => (isBlank(r[i]) ? null : Number(r[i])));
    if (values.some((v) => v !== null && v !== 0 && v !== 1))
      out.errors.push(`Binary column "${name}" has values other than 0, 1 or blank.`);
    out.binary[name] = values as (0 | 1 | null)[];
  }
  for (const name of mapping.categorical) {
    const i = at(name);
    if (i >= 0) out.categorical[name] = t.rows.map((r) => (isBlank(r[i]) ? null : r[i].trim()));
  }
  for (const name of mapping.signals) {
    const i = at(name);
    if (i >= 0) out.signals[name] = t.rows.map((r) => (isBlank(r[i]) ? NaN : Number(r[i])));
  }
  return out;
}

export interface JoinedFrameLabels extends Omit<FrameLabels, 'errors'> {
  /** Camera frames with no row in the file (unscored). */
  unscored: number;
  /** Rows of the file whose frame number is not a camera frame. */
  notInCamera: number;
}

/**
 * Puts the values on the camera's frames, in camera order. Same rule as position:
 * the match is by frame number, and a frame missing from the file is unscored
 * (binary and categorical null, signals NaN).
 */
export function joinByFrame(labels: FrameLabels, cameraFrameNumbers: number[]): JoinedFrameLabels {
  const row = new Map(labels.frames.map((f, i) => [f, i]));
  const pick = <T>(values: T[], none: T) =>
    cameraFrameNumbers.map((f) => (row.has(f) ? values[row.get(f)!] : none));
  const camera = new Set(cameraFrameNumbers);
  const mapValues = <T>(src: Record<string, T[]>, none: T) =>
    Object.fromEntries(Object.entries(src).map(([k, v]) => [k, pick(v, none)]));
  return {
    frames: cameraFrameNumbers,
    binary: mapValues(labels.binary, null),
    categorical: mapValues(labels.categorical, null),
    signals: mapValues(labels.signals, NaN),
    unscored: cameraFrameNumbers.filter((f) => !row.has(f)).length,
    notInCamera: labels.frames.filter((f) => !camera.has(f)).length,
  };
}

export interface Agreement {
  label: string;
  /** Frames where both sides are defined and `binary == 1` is not the same as `category == label`. */
  conflicts: number;
  /** The first (up to five) conflicting frame numbers. */
  firstFrames: number[];
  /** Frames defined by only one of the two sources. Not conflicts. */
  oneSourceOnly: number;
}

/**
 * For each name that is both a binary column and a categorical value, check that
 * `binary == 1` exactly when the category equals the name. A label with conflicts is blocked.
 * Columns must be aligned to `frames` (one entry per frame).
 */
export function agreement(
  frames: number[],
  binary: Record<string, (0 | 1 | null)[]>,
  categorical: Record<string, (string | null)[]>,
): Agreement[] {
  const cats = Object.values(categorical);
  return Object.entries(binary).flatMap(([label, bin]) => {
    const owners = cats.filter((c) => c.includes(label));
    if (!owners.length) return [];
    const result: Agreement = { label, conflicts: 0, firstFrames: [], oneSourceOnly: 0 };
    frames.forEach((frame, i) => {
      // Defined on the category side when any category column has a value at this frame.
      const defined = owners.map((c) => c[i]).filter((v) => v !== null);
      if (bin[i] === null && !defined.length) return;
      if (bin[i] === null || !defined.length) return void result.oneSourceOnly++;
      const disagree = defined.some((v) => (bin[i] === 1) !== (v === label));
      if (!disagree) return;
      result.conflicts++;
      if (result.firstFrames.length < 5) result.firstFrames.push(frame);
    });
    return [result];
  });
}

/** Labeled frames per label: binary columns count frames equal to 1, categorical columns count each value. */
export function frameLabelCounts(labels: Pick<FrameLabels, 'binary' | 'categorical'>) {
  const binary = Object.entries(labels.binary).map(([name, v]) => ({
    name,
    count: v.filter((x) => x === 1).length,
  }));
  const tally = new Map<string, number>();
  for (const col of Object.values(labels.categorical))
    for (const v of col) if (v !== null) tally.set(v, (tally.get(v) ?? 0) + 1);
  const categorical = [...tally].map(([name, count]) => ({ name, count }));
  return { binary, categorical };
}

/** The columns by role, in file order. A file with no frame column has an empty `frameColumn`. */
export function mappingFromRoles(roles: Record<string, ColumnRole>): FrameLabelMapping {
  const named = (role: ColumnRole) => Object.keys(roles).filter((k) => roles[k] === role);
  return {
    frameColumn: named('frame')[0] ?? '',
    binary: named('binary'),
    categorical: named('categorical'),
    signals: named('signal'),
  };
}

/**
 * Roles for a file: suggested from the values, then overridden by a saved mapping (from a
 * config) for the columns it lists. A saved column that is not in the file is ignored.
 */
export function rolesFor(
  table: Table,
  saved?: Pick<FrameLabelMapping, 'frameColumn' | 'binary' | 'categorical'>,
): Record<string, ColumnRole> {
  const roles = suggestRoles(table, saved?.frameColumn || 'frame');
  for (const [list, role] of [
    [saved?.binary, 'binary'],
    [saved?.categorical, 'categorical'],
  ] as const)
    for (const name of list ?? []) if (name in roles) roles[name] = role;
  return roles;
}

/** Change one column's role. Only one column is the frame column, so choosing a new one releases the old. */
export function withRole(
  roles: Record<string, ColumnRole>,
  column: string,
  role: ColumnRole,
): Record<string, ColumnRole> {
  const next = { ...roles, [column]: role };
  if (role === 'frame')
    for (const k of Object.keys(next)) if (k !== column && next[k] === 'frame') next[k] = 'ignore';
  return next;
}

/** Runs of consecutive camera frames where `pick(frame)` holds, as [start, end] seconds on the neural clock. */
export function runsOf(times: ArrayLike<number>, pick: (i: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  let start: number | undefined;
  for (let i = 0; i < times.length; i++) {
    const on = pick(i) && Number.isFinite(times[i]);
    if (on && start === undefined) start = times[i];
    if (!on && start !== undefined) {
      runs.push([start, times[i]]);
      start = undefined;
    }
  }
  if (start !== undefined) runs.push([start, times[times.length - 1]]);
  return runs;
}
