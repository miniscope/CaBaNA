// Turns the lines of a saved-run settings diff (`prep.eventSigmaS: 0 -> 0.2`) into plain phrases for
// "what changed since this run". Known keys have a name in a table; any other key is shown as its
// own words, never as the raw path. Words only: nothing here compares settings.

import { AUROC_LABELS, PIPELINE_WORD, PLACE_LABELS, PREP_LABELS } from './engine.ts';
import { DEP_WORDS } from './run-deps.ts';
import type { AnalysisId } from './runs.ts';

const SETTINGS_VERSION_WORD =
  'saved before changes to clock, calibration, arena and labels were tracked';

/** Names for the analysis settings of each analysis; keys not listed fall back to their words. */
const ANALYSIS_LABELS: Partial<Record<AnalysisId, Record<string, string>>> = {
  place: PLACE_LABELS,
  auroc: AUROC_LABELS,
};

interface Parsed {
  path: string[];
  before: unknown;
  after: unknown;
}

const parseValue = (text: string): unknown => {
  if (text === 'unset') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** `path: before -> after`, or undefined when the line has another shape. */
function parseLine(line: string): Parsed | undefined {
  const colon = line.indexOf(': ');
  const arrow = line.indexOf(' -> ', colon + 2);
  if (colon < 0 || arrow < 0) return undefined;
  return {
    path: line.slice(0, colon).split('.'),
    before: parseValue(line.slice(colon + 2, arrow)),
    after: parseValue(line.slice(arrow + 4)),
  };
}

/** "eventSigmaS" -> "event sigma s": the key as lowercase words, for keys without a table entry. */
export const keyWords = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\bactivity\b/g, 'neural data');

const UNIT: [RegExp, string][] = [
  [/S$/, ' s'],
  [/Cm$/, ' cm'],
  [/Hz$/, ' Hz'],
];

/** A setting's value with its unit: numbers to two decimals (0 stays 0), unset as "off". */
function showValue(key: string, v: unknown): string {
  if (v === undefined || v === null) return 'unset';
  if (typeof v === 'number') {
    const unit = UNIT.find(([re]) => re.test(key))?.[1] ?? '';
    return `${v === 0 ? '0' : Number.isInteger(v) ? String(v) : v.toFixed(2)}${unit}`;
  }
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v;
  return '';
}

/** "0 → 0.20 s". The unit is written once, after the last value. */
function arrowText(key: string, before: unknown, after: unknown): string {
  const a = showValue(key, before);
  const b = showValue(key, after);
  if (!a || !b) return '';
  const unit = UNIT.find(([re]) => re.test(key))?.[1] ?? '';
  const bare = (s: string) => (unit && s.endsWith(unit) ? s.slice(0, -unit.length) : s);
  return `${unit && typeof before === 'number' && typeof after === 'number' ? bare(a) : a} → ${b}`;
}

/** Rejected cells are stored from 0; the app shows them from 1. */
function rejectedText(before: unknown, after: unknown): string {
  const was = new Set(Array.isArray(before) ? (before as number[]) : []);
  const now = new Set(Array.isArray(after) ? (after as number[]) : []);
  const added = [...now].filter((c) => !was.has(c)).sort((x, y) => x - y);
  const removed = [...was].filter((c) => !now.has(c)).sort((x, y) => x - y);
  const cells = (cs: number[]) =>
    `${cs.length === 1 ? 'cell' : 'cells'} ${cs.map((c) => c + 1).join(', ')}`;
  return [
    added.length && `${cells(added)} rejected`,
    removed.length && `${cells(removed)} restored`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The phrase for one diff line: a name, and in brackets what it changed from and to. */
function phrase(p: Parsed, analysis?: AnalysisId): { name: string; detail?: string } {
  const [root, key] = p.path;
  const leaf = p.path.at(-1) ?? '';
  const withValues = (name: string, k = leaf) => {
    const d = arrowText(k, p.before, p.after);
    return d ? { name, detail: d } : { name };
  };
  switch (root) {
    case 'analysis':
      return withValues(
        ANALYSIS_LABELS[analysis as AnalysisId]?.[key] ?? keyWords(key ?? 'settings'),
      );
    case 'prep':
      return withValues(PREP_LABELS[key] ?? `preprocess ${keyWords(key ?? '')}`.trim());
    case 'inputs':
      return { name: 'input files' };
    case 'rejected':
      return { name: 'rejected cells', detail: rejectedText(p.before, p.after) };
    case 'labelRoles':
      return { name: 'label roles' };
    case 'deps':
      return key === 'rejected'
        ? { name: 'rejected cells', detail: rejectedText(p.before, p.after) }
        : { name: DEP_WORDS[key] ?? keyWords(key ?? 'inputs') };
    case 'pipeline':
      return { name: PIPELINE_WORD };
    case 'settingsVersion':
      return { name: SETTINGS_VERSION_WORD };
    default:
      return { name: keyWords(p.path.join(' ')) };
  }
}

/**
 * Plain phrases for a settings diff, each setting once, with the values where they are short
 * ("event smoothing (0 → 0.20 s)", "rejected cells (cell 12 rejected)"). The pipeline mirrors the
 * settings, so it is named only when nothing more specific changed. Lines that are already words
 * (browser-engine diffs) pass through.
 */
export function readableChanges(diff: string[], analysis?: AnalysisId): string[] {
  const byName = new Map<string, string | undefined>();
  for (const line of diff) {
    const parsed = parseLine(line);
    if (!parsed) {
      byName.set(line, undefined);
      continue;
    }
    const { name, detail } = phrase(parsed, analysis);
    // A second line of the same name with another detail (several label fields) would mislead.
    const same = !byName.has(name) || byName.get(name) === (detail || undefined);
    byName.set(name, same ? detail || undefined : undefined);
  }
  let names = [...byName.keys()];
  if (names.length > 1) names = names.filter((n) => n !== PIPELINE_WORD);
  return names.map((n) => (byName.get(n) ? `${n} (${byName.get(n)})` : n));
}
