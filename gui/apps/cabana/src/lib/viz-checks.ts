// The Checks row of Data visualization: one chip per kind of check, its counts in words. Pure
// functions of the counts the QC tests already compute, so the chips and the tests agree.

export type ChipId = 'inputs' | 'cells' | 'neural' | 'position' | 'behavior';
export type PartTone = 'ok' | 'flag' | 'fail' | 'muted';

/** One piece of a chip's text, colored by its tone (the words carry the meaning too). */
export interface Part {
  text: string;
  tone: PartTone;
}

type Status = 'pass' | 'warn' | 'fail';

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const NOT_LOADED: Part[] = [{ text: 'not loaded', tone: 'muted' }];

/** Failed, flagged and passed checks, in that order; only the counts that are not zero. */
export function checkParts(checks: { status: Status }[], flagWord = 'flagged'): Part[] {
  const of = (s: Status) => checks.filter((c) => c.status === s).length;
  const parts: Part[] = [];
  if (of('fail')) parts.push({ text: `${of('fail')} failed`, tone: 'fail' });
  if (of('warn')) parts.push({ text: `${of('warn')} ${flagWord}`, tone: 'flag' });
  if (of('pass')) parts.push({ text: `${of('pass')} passed`, tone: 'ok' });
  return parts;
}

/** Timing and alignment checks: "5 passed · 1 warning", or why none ran. */
export function inputsParts(checks: { status: Status }[] | undefined): Part[] {
  if (!checks?.length) return [{ text: 'run once timestamps load', tone: 'muted' }];
  const of = (s: Status) => checks.filter((c) => c.status === s).length;
  const parts: Part[] = [];
  if (of('pass')) parts.push({ text: `${of('pass')} passed`, tone: 'ok' });
  if (of('warn')) parts.push({ text: n(of('warn'), 'warning', 'warnings'), tone: 'flag' });
  if (of('fail')) parts.push({ text: `${of('fail')} failed`, tone: 'fail' });
  return parts;
}

/** Cells flagged for review and overlapping footprint pairs. Rejected cells are listed in Changes. */
export function cellsParts(
  f: { flagged: number; pairs: number; rejected: number; failed: number } | undefined,
): Part[] {
  if (!f) return NOT_LOADED;
  const parts: Part[] = [];
  if (f.failed) parts.push({ text: `${f.failed} failed`, tone: 'fail' });
  if (f.flagged) parts.push({ text: `${f.flagged} flagged`, tone: 'flag' });
  if (f.pairs) parts.push({ text: n(f.pairs, 'overlap', 'overlaps'), tone: 'flag' });
  return parts.length ? parts : [{ text: 'none flagged', tone: 'ok' }];
}

/** Deconvolution checks of the neural data. */
export function neuralParts(checks: { status: Status }[] | undefined): Part[] {
  if (!checks) return NOT_LOADED;
  if (!checks.length) return [{ text: 'no checks ran', tone: 'muted' }];
  return checkParts(checks, 'flagged');
}

/** Position: failed checks, then jumps and lost stretches to review. */
export function positionParts(
  f: { failed: number; jumps: number; gaps: number } | undefined,
): Part[] {
  if (!f) return NOT_LOADED;
  const parts: Part[] = [];
  if (f.failed) parts.push({ text: `${f.failed} failed`, tone: 'fail' });
  if (f.jumps) parts.push({ text: n(f.jumps, 'jump', 'jumps'), tone: 'flag' });
  if (f.gaps) parts.push({ text: n(f.gaps, 'gap', 'gaps'), tone: 'flag' });
  return parts.length ? parts : [{ text: 'none flagged', tone: 'ok' }];
}

/**
 * Behavior annotations: failed checks (or files that could not be read), flagged epochs, then rows
 * whose start and stop do not make a pair.
 */
export function behaviorParts(
  f: { failed: number; epochs: number; unpaired?: number } | undefined,
): Part[] {
  if (!f) return NOT_LOADED;
  const parts: Part[] = [];
  if (f.failed) parts.push({ text: `${f.failed} failed`, tone: 'fail' });
  if (f.epochs) parts.push({ text: n(f.epochs, 'epoch flagged', 'epochs flagged'), tone: 'flag' });
  if (f.unpaired)
    parts.push({ text: n(f.unpaired, 'unpaired row', 'unpaired rows'), tone: 'flag' });
  return parts.length ? parts : [{ text: 'none flagged', tone: 'ok' }];
}

/** The parts as one line of text, for an accessible name or a tooltip. */
export const partsText = (parts: Part[]): string => parts.map((p) => p.text).join(' · ');

/** A mark on the session navigator: where (percent of the session) and what it marks. */
export interface Tick {
  left: number;
  kind: 'flag' | 'correction';
}

/**
 * Navigator marks for flagged times (amber) and user corrections (blue), as percent of the
 * session. Times outside the session are dropped, and marks closer than `minPct` merge into one.
 */
export function navTicks(
  flagged: number[],
  corrected: number[],
  [t0, t1]: [number, number],
  minPct = 0.4,
): Tick[] {
  const out: Tick[] = [];
  const add = (times: number[], kind: Tick['kind']) => {
    let last = -Infinity;
    for (const t of [...times].filter(Number.isFinite).sort((a, b) => a - b)) {
      const left = (100 * (t - t0)) / (t1 - t0 || 1);
      if (left < 0 || left > 100 || left - last < minPct) continue;
      out.push({ left, kind });
      last = left;
    }
  };
  add(flagged, 'flag');
  add(corrected, 'correction');
  return out;
}
