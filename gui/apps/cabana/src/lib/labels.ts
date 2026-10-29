// The label registry: every label from every loaded annotation file, with its source,
// and the conflicts that block analyses. A label is its exact name after trimming
// (case-sensitive), so "Freeze" and "freeze" are different labels.

import type { Agreement } from './frame-labels.ts';

export type LabelSource = 'epochs' | 'frame_binary' | 'frame_categorical' | 'markers';
export type LabelRole = 'measured' | 'controlled';

export interface LabelEntry {
  name: string;
  source: LabelSource;
  file: string;
  slot: string;
  /** Bouts, labeled frames, or markers. */
  count: number;
  problems: string[];
  /** True when a conflict blocks use in analyses. */
  blocked: boolean;
}

export interface LabelInput {
  source: LabelSource;
  file: string;
  slot: string;
  /** `problems` are notes that do not block, such as markers outside the recording. */
  labels: { name: string; count: number; problems?: string[] }[];
}

const isFramePair = (a: LabelEntry, b: LabelEntry) =>
  a.source !== b.source && a.source.startsWith('frame_') && b.source.startsWith('frame_');

function block(e: LabelEntry, problem: string) {
  if (!e.problems.includes(problem)) e.problems.push(problem);
  e.blocked = true;
}

/**
 * A name from two different sources or files is a duplicate. The exception is one binary
 * column plus one categorical value, which is checked by `agreement` instead.
 */
export function buildRegistry(inputs: LabelInput[], agreements: Agreement[] = []): LabelEntry[] {
  const entries = inputs.flatMap(({ source, file, slot, labels }) =>
    labels.map(({ name, count, problems }) => ({
      name: name.trim(),
      source,
      file,
      slot,
      count,
      problems: [...(problems ?? [])],
      blocked: false,
    })),
  );
  for (const a of entries)
    for (const b of entries) {
      if (a === b || a.name !== b.name || (a.source === b.source && a.file === b.file)) continue;
      if (isFramePair(a, b)) continue;
      block(
        a,
        `Duplicate label: also in ${b.file} (${b.source.replace('_', ' ')}). Rename one or unload a file.`,
      );
    }
  for (const g of agreements.filter((x) => x.conflicts > 0))
    for (const e of entries.filter((x) => x.name === g.label && x.source.startsWith('frame_')))
      block(
        e,
        `Binary column and category disagree on ${g.conflicts} frame(s), first: ${g.firstFrames.join(', ')}.`,
      );
  return entries;
}

/** Controlled when the paradigm lists the label (a stimulus), otherwise measured. */
export function defaultRoles(
  names: string[],
  controlledLabels: string[],
): Record<string, LabelRole> {
  return Object.fromEntries(
    names.map((n) => [n, controlledLabels.includes(n) ? 'controlled' : 'measured']),
  );
}

/** The saved role if there is one, otherwise the paradigm default. */
export function resolveRole(
  name: string,
  saved: Record<string, LabelRole> | undefined,
  controlledLabels: string[],
): LabelRole {
  return saved?.[name] ?? (controlledLabels.includes(name) ? 'controlled' : 'measured');
}

/**
 * The labels to leave out of a run when it starts: those whose role is not `keep`. Only a
 * starting point (the lists still offer every label). When no label has that role, nothing is
 * left out, so the list is never preselected empty.
 */
export function preselectUnselected(
  labels: string[],
  roleOf: (name: string) => LabelRole,
  keep: LabelRole,
): string[] {
  const left = labels.filter((l) => roleOf(l) !== keep);
  return left.length === labels.length ? [] : left;
}
