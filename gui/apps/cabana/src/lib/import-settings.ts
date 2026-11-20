// Import settings on Data setup: a processing.yaml or analysis.yaml read from disk, or settings
// copied from another project. Only what belongs to no one recording is applied (the groups of
// settings-template.ts): QC limits, preprocessing and analysis settings, never rejected cells,
// geometry or label selections. Each applied file is listed, and × puts back what was there before.

import { createSignal } from 'solid-js';
import { parse } from 'yaml';
import { processingFromData } from './project-files.ts';
import { analysesFromYaml } from './project-sources.ts';
import { captureProcessing } from './project-state.ts';
import { applySettings, captureSettings, type GroupId } from './settings-template.ts';
import { onClear } from './store.ts';

export interface Applied {
  label: string;
  /** Where the settings came from: a file name, or a sentence naming the project. */
  source: string;
  groups: GroupId[];
  before: ReturnType<typeof captureSettings>;
}

const [applied, setApplied] = createSignal<Applied[]>([]);
export { applied };
onClear(() => setApplied([]));

export const LABEL = {
  processing: 'QC & preprocessing settings',
  analysis: 'Analysis settings',
  copy: 'Settings from another project',
};

/** Apply a processing.yaml or analysis.yaml read from disk. */
export async function importYaml(kind: 'processing' | 'analysis', file: File): Promise<void> {
  let raw: unknown;
  try {
    raw = parse(await file.text());
  } catch (e) {
    throw new Error(`${file.name} is not valid YAML: ${e instanceof Error ? e.message : e}`, {
      cause: e,
    });
  }
  if (!raw || typeof raw !== 'object') throw new Error(`${file.name} has no settings.`);
  const before = captureSettings();
  if (kind === 'processing') {
    const s = processingFromData(raw, captureProcessing());
    applySettings(
      {
        prep: { prep: s.prep, decon: s.decon },
        qc: { tol: s.limits.tol, maxSpeed: s.limits.maxSpeed },
      },
      ['prep', 'qc'],
    );
    record({ label: LABEL.processing, source: file.name, groups: ['prep', 'qc'], before });
  } else {
    applySettings({ analyses: analysesFromYaml(raw) }, ['analyses']);
    record({ label: LABEL.analysis, source: file.name, groups: ['analyses'], before });
  }
}

/** Note settings copied from another project (ApplyFrom.tsx applied them; `before` came first). */
export function noteCopied(sentence: string, before: Applied['before']): void {
  record({
    label: LABEL.copy,
    source: sentence,
    groups: ['setup', 'prep', 'qc', 'analyses'],
    before,
  });
}

const record = (a: Applied) => setApplied((l) => [...l.filter((x) => x.label !== a.label), a]);

/** Take an applied file back: the settings it changed return to what they were before it. */
export function undoApplied(a: Applied): void {
  applySettings(a.before, a.groups);
  setApplied((l) => l.filter((x) => x !== a));
}
