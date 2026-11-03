// What a run's results depend on beyond its own settings: the input files, how the camera clock
// is joined to the neural clock, the position calibration, the arena, rejected cells, and the
// labels it reads (their role and their bouts after any correction). Saved with every run and
// compared later, so a change to any of these marks the results as needing a rerun. Each run
// declares what it uses, so a change it does not read leaves it alone. Display settings are
// never part of it.

import { arena, cmPts, positionTransform, pxPerCm, sizeCm } from './arena.ts';
import { canonicalJson } from './settings-hash.ts';
import type { SlotId } from './slots.ts';
import {
  annotationResults,
  frameRoles,
  labelRegistry,
  rejected,
  roleOf,
  slotFile,
  source,
} from './store.ts';

export interface Uses {
  /** Reads tracked position (speed filters and matching count). */
  position: boolean;
  /** Bins position on the arena grid. */
  grid: boolean;
  /** Labels whose bouts or frames the run reads. */
  labels: string[];
}

/** Words for each part, as shown under "What changed". */
export const DEP_WORDS: Record<string, string> = {
  files: 'input files',
  clock: 'clock alignment',
  calibration: 'position calibration',
  arena: 'arena or excluded regions',
  rejected: 'rejected cells',
  labels: 'labels or their corrections',
};

/** A short fingerprint of a value, so long arrays (bouts) do not bloat saved run records. */
export function digest(value: unknown): string {
  const text = canonicalJson(value);
  let h = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Which file is loaded in a slot. The framework path hashes the bytes instead. */
const fileId = (slot: SlotId) => {
  const f = slotFile(slot);
  return f ? `${f.name}:${f.size}:${f.lastModified}` : undefined;
};

/**
 * The dependencies of a run that uses `u`. `files` is left out for framework runs, whose input
 * files are already identified by their SHA-256.
 */
export function runDeps(u: Uses, o: { files?: boolean } = {}): Record<string, unknown> {
  const used = labelRegistry().filter((e) => u.labels.includes(e.name));
  const slots: SlotId[] = ['neural_deconvolved', 'neural_timestamps'];
  if (u.position) slots.push('position', 'behavior_timestamps');
  for (const e of used) slots.push(e.slot as SlotId);
  const cameraData = u.position || used.length > 0;
  const bouts = annotationResults().flatMap((a) => a.epochs);
  return {
    ...(o.files !== false && {
      files: Object.fromEntries([...new Set(slots)].map((s) => [s, fileId(s)])),
    }),
    ...(cameraData && { clock: { offsetS: source.clockOffsetS, scale: source.clockScale } }),
    ...(u.position && { calibration: { units: source.positionUnit, map: positionTransform() } }),
    ...(u.grid && {
      arena: {
        shape: arena.shape,
        sizeCm: sizeCm(),
        binCm: arena.binCm,
        minOccupancy: arena.minOccupancy,
        // In cm, so moving the picture without changing a region changes nothing.
        excluded:
          arena.box && pxPerCm() ? arena.zones.filter((z) => z.kind === 'exclude').map(cmPts) : [],
      },
    }),
    rejected: [...rejected()].sort((a, b) => a - b),
    ...(used.length && {
      labels: {
        ...Object.fromEntries(
          used.map((e) => [
            e.name,
            { role: roleOf(e.name), bouts: digest(bouts.filter((b) => b.label === e.name)) },
          ]),
        ),
        // Frame-label columns are read through their roles.
        ...(used.some((e) => e.slot === 'frame_labels') && { frameColumns: digest(frameRoles()) }),
      },
    }),
  };
}

/** The parts of two dependency records that differ, in words. */
export function depChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): string[] {
  if (!before) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k]))
    .map((k) => DEP_WORDS[k] ?? k);
}
