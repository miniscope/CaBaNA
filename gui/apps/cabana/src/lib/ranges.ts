// Valid ranges of numeric settings. A value outside its range is kept in the box, marked, and
// blocks the run with this reason, so a typed value is never silently changed or ignored.

export interface Range {
  min?: number;
  max?: number;
  whole?: boolean;
}

export function rangeText(r: Range): string {
  const kind = r.whole ? 'a whole number' : 'a number';
  if (r.min !== undefined && r.max !== undefined) return `${kind} from ${r.min} to ${r.max}`;
  if (r.min !== undefined) return `${kind} from ${r.min}`;
  if (r.max !== undefined) return `${kind} up to ${r.max}`;
  return kind;
}

export const inRange = (v: number, r: Range) =>
  Number.isFinite(v) &&
  v >= (r.min ?? -Infinity) &&
  v <= (r.max ?? Infinity) &&
  (!r.whole || Number.isInteger(v));

/** "Alpha must be a number from 0.001 to 0.5." when `v` is outside `r`, else undefined. */
export const rangeIssue = (name: string, v: number, r: Range): string | undefined =>
  inRange(v, r) ? undefined : `${name} must be ${rangeText(r)}.`;
