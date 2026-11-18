// Why a cell was rejected. Chosen when rejecting and kept with the rejection; it is a record for
// the user and changes nothing about which cells the analyses leave out.

export const REASONS = [
  'Duplicate of another cell',
  'Unusual shape',
  'Not a cell (vessel or neuropil)',
  'Flat trace',
  'Artifact',
  'Other',
] as const;

export type Reason = (typeof REASONS)[number];

/** Shown for rejections made without a reason. */
export const NO_REASON = 'No reason given';

/** Whether Reject can be pressed: a reason is chosen, and Other has a note. */
export const reasonReady = (reason: Reason | undefined, note: string): boolean =>
  !!reason && (reason !== 'Other' || note.trim().length > 0);

/** The reason as stored: "Flat trace", "Duplicate of another cell: overlaps cell 12", "Other: lens edge". */
export function reasonText(reason: Reason, note = ''): string {
  const n = note.trim();
  return n ? `${reason}: ${n}` : reason;
}
