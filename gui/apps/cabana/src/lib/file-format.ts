// What an unmatched file looks like (read cheaply from its head) and whether it fits a data type.
// The column rules follow what the loaders read: the same names, matched the same way, so a file
// that passes here loads without an error.

import type { SlotId } from './slots.ts';

export interface FileInfo {
  kind: 'csv' | 'npy' | 'yaml' | 'other';
  /** Upper-case file type for the list: CSV, TXT, NPY. */
  type: string;
  /** Header cells of a table file. */
  columns?: string[];
  /** Data rows of a table file, when the whole file was read. */
  rows?: number;
  /** Array shape of a .npy file. */
  shape?: number[];
}

/** A header cell that names nothing: blank, or a number (the file has no header row). */
const unnamed = (c: string) => c.trim() === '' || Number.isFinite(Number(c));

const SEPARATORS = [',', '\t', ';'];

/** Split table text into its header cells and the number of data rows. */
export function tableFacts(text: string): { columns: string[]; rows: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { columns: [], rows: 0 };
  // The loaders read commas only; a file with another separator therefore shows as one column.
  const sep = SEPARATORS[0];
  const columns = lines[0].split(sep).map((c) => c.trim());
  // A first line of numbers is data, not a header.
  return { columns, rows: columns.every(unnamed) ? lines.length : lines.length - 1 };
}

/** The shape written in a .npy header, e.g. `(180, 9000)`; undefined when it cannot be read. */
export function npyShape(bytes: Uint8Array): number[] | undefined {
  const magic = String.fromCharCode(...bytes.slice(1, 6));
  if (bytes[0] !== 0x93 || magic !== 'NUMPY') return undefined;
  const header = new TextDecoder().decode(bytes.slice(10, 10 + 256));
  const m = /'shape':\s*\(([^)]*)\)/.exec(header);
  if (!m) return undefined;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

/** The file's facts from its name, its first bytes and, for a table, its text. */
export function describeFile(name: string, head: Uint8Array, text?: string): FileInfo {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'npy') return { kind: 'npy', type: 'NPY', shape: npyShape(head) };
  if (/^ya?ml$/.test(ext)) return { kind: 'yaml', type: 'YAML' };
  if (['csv', 'tsv', 'txt'].includes(ext) && text !== undefined)
    return { kind: 'csv', type: ext.toUpperCase(), ...tableFacts(text) };
  return { kind: 'other', type: ext ? ext.toUpperCase() : 'FILE' };
}

/** Files larger than this are not read in full, so the list stays quick. */
const READ_LIMIT = 25_000_000;

export async function readFileInfo(file: File): Promise<FileInfo> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const wantsText = /\.(csv|tsv|txt)$/i.test(file.name);
  const text = wantsText && file.size <= READ_LIMIT ? await file.text() : undefined;
  return describeFile(file.name, head, text);
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The list line: file type, rows, columns (or the array shape). */
export function factsLine(info: FileInfo): string {
  const parts = [info.type];
  if (info.shape) parts.push(info.shape.map((n) => n.toLocaleString('en-US')).join(' × '));
  if (info.rows !== undefined) parts.push(count(info.rows, 'row'));
  if (info.columns) parts.push(count(info.columns.length, 'column'));
  return parts.join(' · ');
}

interface ColumnRule {
  /** How the loader finds it: the exact name, or any column containing it (case-insensitive). */
  find: 'exact' | 'contains';
  name: string;
}

const TIMESTAMPS: ColumnRule[] = [
  { find: 'contains', name: 'frame number' },
  { find: 'contains', name: 'time stamp' },
];
const EPOCHS: ColumnRule[] = [
  { find: 'contains', name: 'label' },
  { find: 'contains', name: 'start' },
  { find: 'contains', name: 'stop' },
];

/** The columns each table type needs, with the names shown to the user. */
const COLUMNS: Partial<Record<SlotId, { rules: ColumnRule[]; shown: string }>> = {
  neural_timestamps: { rules: TIMESTAMPS, shown: 'Frame Number and Time Stamp (ms)' },
  behavior_timestamps: { rules: TIMESTAMPS, shown: 'Frame Number and Time Stamp (ms)' },
  position: {
    rules: ['frame', 'x', 'y'].map((name) => ({ find: 'contains', name })),
    shown: 'frame, x and y',
  },
  head_orientation: {
    rules: [
      { find: 'contains', name: 'time stamp' },
      ...['qw', 'qx', 'qy', 'qz'].map((name) => ({ find: 'contains' as const, name })),
    ],
    shown: 'Time Stamp (ms), qw, qx, qy and qz',
  },
  zone_annotations: { rules: EPOCHS, shown: 'label, start_s and stop_s' },
  behavior_annotations: { rules: EPOCHS, shown: 'label, start_s and stop_s' },
  time_markers: {
    rules: [
      { find: 'exact', name: 'label' },
      { find: 'exact', name: 'time_s' },
    ],
    shown: 'label and time_s',
  },
  frame_labels: {
    rules: [{ find: 'contains', name: 'frame' }],
    shown: 'a frame column and one column per label',
  },
};

const hasColumn = (columns: string[], r: ColumnRule) =>
  columns.some((c) =>
    r.find === 'exact' ? c.toLowerCase() === r.name : c.toLowerCase().includes(r.name),
  );

export type FormatCheck = { ok: true } | { ok: false; reason: string };

const ARRAY_SLOTS: Partial<Record<SlotId, number>> = {
  neural_raw: 2,
  neural_denoised: 2,
  neural_deconvolved: 2,
  footprints: 3,
};
const ARRAY_WORDS: Record<number, string> = { 2: 'cells × frames', 3: 'cells × height × width' };

/** What the file has, for the end of a reason: "This file has one unnamed column." */
function hasWhat(columns: string[]): string {
  if (!columns.length) return 'This file is empty.';
  if (columns.length === 1 && unnamed(columns[0])) return 'This file has one unnamed column.';
  const named = columns.filter((c) => !unnamed(c));
  if (!named.length) return `This file has ${count(columns.length, 'unnamed column')}.`;
  return `This file has the columns ${named.join(', ')}.`;
}

/**
 * Whether a file can be used as `slot`: the file type, then the columns or array shape the
 * loader needs. The reason names what the slot needs and what the file has.
 */
export function checkFormat(slot: SlotId, info: FileInfo, label: string): FormatCheck {
  const bad = (reason: string): FormatCheck => ({ ok: false, reason: `Not valid: ${reason}` });
  const dims = ARRAY_SLOTS[slot];
  if (dims) {
    if (info.kind !== 'npy')
      return bad(`for ${label.toLowerCase()}, the file must be a .npy file.`);
    if (!info.shape) return bad('the shape of this .npy file could not be read.');
    if (info.shape.length !== dims)
      return bad(
        `for ${label.toLowerCase()}, the file needs a ${dims}-dimensional array (${ARRAY_WORDS[dims]}). This file is ${info.shape.length}-dimensional.`,
      );
    return { ok: true };
  }
  if (slot === 'config') {
    return info.kind === 'yaml' ? { ok: true } : bad('an experimental setup must be a .yaml file.');
  }
  const rule = COLUMNS[slot];
  if (!rule) return { ok: true };
  if (info.kind !== 'csv' || !info.columns)
    return bad(
      `for ${label.toLowerCase()}, the file must be a CSV or text file with a header row.`,
    );
  if (!info.rows)
    return bad(
      `for ${label.toLowerCase()}, the file needs at least one data row. This file has none.`,
    );
  if (!rule.rules.every((r) => hasColumn(info.columns!, r)))
    return bad(
      `for ${label.toLowerCase()}, the file needs the columns ${rule.shown}. ${hasWhat(info.columns)}`,
    );
  return { ok: true };
}
