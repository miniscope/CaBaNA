// A preview runs the same analysis with fewer shuffles and is saved as a Preview run (its Type;
// Settings status is separate). One cap for every analysis: a preview never runs more shuffles than
// the full analysis would.

/** The parts of a run record the shuffle count is read from (results views pass smaller shapes). */
type Saved = { scope: string; gui?: { settings?: unknown } };

export const PREVIEW_SHUFFLES = 50;

/** The fewest shuffles a chosen preview count may be. */
export const MIN_PREVIEW_SHUFFLES = 10;

/**
 * Shuffles a run of this scope executes when the full analysis is set to `full`. A preview runs
 * the `chosen` count (default 50), never more than `full`; a full run ignores `chosen`.
 */
export const shufflesFor = (scope: 'full' | 'preview', full: number, chosen?: number) =>
  scope === 'preview' ? Math.min(chosen ?? PREVIEW_SHUFFLES, full) : full;

/** The range a chosen preview count may take, for the field's hint. */
export const previewRange = (full: number): [number, number] => [
  Math.min(MIN_PREVIEW_SHUFFLES, full),
  full,
];

/** Why a chosen preview count cannot be used, or undefined when it can. */
export function previewShufflesIssue(n: number, full: number): string | undefined {
  const [lo, hi] = previewRange(full);
  return Number.isInteger(n) && n >= lo && n <= hi
    ? undefined
    : `Use a whole number from ${lo.toLocaleString()} to ${hi.toLocaleString()}.`;
}

/** What a Preview run is, for help text. */
export const PREVIEW_TEXT =
  'a run with fewer shuffles, to check settings before the full analysis. It is never used for reporting';

/**
 * The shuffles a saved run executed, from its settings. Undefined when the record does not say:
 * population and decoding previews saved before settings version 2 stored the full count.
 */
export function executedShuffles(r: Saved): number | undefined {
  const saved = (r.gui?.settings ?? {}) as Record<string, unknown>;
  const s = (
    typeof saved.analysis === 'object' && saved.analysis ? saved.analysis : saved
  ) as Record<string, unknown>;
  const n = typeof s.nShuffles === 'number' ? s.nShuffles : s.shuffles;
  if (typeof n !== 'number') return undefined;
  const v2 = Number(saved.settingsVersion ?? 1) >= 2;
  if (r.scope === 'preview' && typeof s.nShuffles !== 'number' && !v2) return undefined;
  return n;
}

export type RunTypeKind = 'full' | 'preview';

export interface RunType {
  kind: RunTypeKind;
  /** Shuffles executed, when the analysis has a shuffle test and the record says. */
  shuffles?: number;
  /** "Full analysis · 1,000 shuffles", "Preview · 50 shuffles", or without the count. */
  text: string;
}

/** A saved run's Type: how it was made. Whether its settings are still in use is `settingsStatus`. */
export function runType(r: Saved & { analysis?: string }): RunType {
  const kind: RunTypeKind = r.scope === 'preview' ? 'preview' : 'full';
  const saved = (r.gui?.settings ?? {}) as Record<string, unknown>;
  const inner = (typeof saved.analysis === 'object' && saved.analysis ? saved.analysis : saved) as
    Record<string, unknown>;
  // A PETH run without a significance test has no shuffles, whatever its saved count says.
  const shuffles = r.analysis === 'peth' && inner.test === 'none' ? undefined : executedShuffles(r);
  const name = kind === 'preview' ? 'Preview' : 'Full analysis';
  return {
    kind,
    shuffles,
    text: shuffles === undefined ? name : `${name} · ${shuffles.toLocaleString()} shuffles`,
  };
}
