// A Quick preview runs the same analysis with fewer shuffles and is saved as Preliminary. One
// cap for every analysis; a preview never runs more shuffles than the full analysis would.

/** The parts of a run record the shuffle count is read from (results views pass smaller shapes). */
type Saved = { scope: string; gui?: { settings?: unknown } };

export const PREVIEW_SHUFFLES = 50;

/** Shuffles a run of this scope executes when the full analysis is set to `full`. */
export const shufflesFor = (scope: 'full' | 'preview', full: number) =>
  scope === 'preview' ? Math.min(PREVIEW_SHUFFLES, full) : full;

/** "up to 50 shuffles", for setup text, where the count depends on the full setting. */
export const PREVIEW_TEXT = `up to ${PREVIEW_SHUFFLES} shuffles (no more than the full analysis)`;

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

/** "Preliminary: 50 shuffles", or without the count when the record does not say. */
export const preliminaryText = (r: Saved) => {
  const n = executedShuffles(r);
  return n === undefined
    ? 'Preliminary (shuffle count not recorded)'
    : `Preliminary: ${n} shuffles`;
};
