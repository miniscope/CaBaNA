// Number handling for components/SliderNumber.tsx.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Text for the number field. A value of 0 shows `zeroLabel` (e.g. "off") when one is given. `minDecimals` pads short steps (0.1 s shows as 0.10). */
export function formatValue(
  value: number,
  step: number,
  zeroLabel?: string,
  minDecimals = 0,
): string {
  if (value === 0 && zeroLabel) return zeroLabel;
  return value.toFixed(Math.max(decimals(step), minDecimals));
}

/** The value a typed entry means, clamped to the range. Unreadable text keeps `current`. */
export function parseEntry(
  text: string,
  current: number,
  min: number,
  max: number,
  zeroLabel?: string,
): number {
  const trimmed = text.trim();
  if (zeroLabel && trimmed.toLowerCase() === zeroLabel.toLowerCase()) return clamp(0, min, max);
  const n = Number(trimmed);
  return trimmed === '' || !Number.isFinite(n) ? current : clamp(n, min, max);
}
