// The step wizard of a file on the Data setup page: what each step is for, and its state. The state
// is a plain function of a few facts so the rules can be tested. A step is marked complete only
// when that means something: Overview once looked at, QC once opened with no failed check, Arena
// and zones once the arena's real size is set. Preprocess is never "complete": its previews are
// live and nothing is applied, so it reads "Viewed" or "Skipped".

import type { SectionId } from './file-sections.ts';

export interface StepText {
  /** Under the step's name in the wizard. */
  short: string;
  /** One line above the step's content. */
  intro: string;
  /** The expandable note under that line. */
  more: string;
}

export const STEP_TEXT: Record<SectionId, StepText> = {
  overview: {
    short: 'Inspect data',
    intro: 'The whole file as plots, or its values as loaded in a table.',
    more: 'Neural files show every cell over the session; behavior files show each column over time. Data table lists the values as they were read, and opens at the row a QC finding points to. Opening a file marks it reviewed; nothing here changes the data.',
  },
  arena: {
    short: 'Set arena size and zones',
    intro: 'Outline the arena, set its real size, and draw zones. Saved to the experiment config.',
    more: "Spatial analyses stay blocked until the arena's real size or a known distance is set. Zones become the zone epochs the analyses use; the time in each zone updates as zones are drawn or moved.",
  },
  qc: {
    short: 'Check data quality',
    intro:
      'Computed checks for this file, each against its limit. Passing a check and reviewing it are separate.',
    more: 'A failed check does not block analysis; it stays listed here so it can be reviewed or corrected. Selecting a flagged item highlights the frames or cells involved. Limits can be changed under Limits.',
  },
  prep: {
    short: 'Process before analysis',
    intro:
      'Optional steps applied to this file before every analysis. Previews update as settings change; there is nothing to apply.',
    more: 'Each step lists the analyses that use it. Runs keep the settings they used, so results made before a change are marked out of date.',
  },
};

export type StepState = 'done' | 'attention' | 'todo' | 'viewed' | 'skipped' | 'off' | 'unused';

export interface StepFacts {
  section: SectionId;
  visited: boolean;
  skipped: boolean;
  /** Neural trace files only. */
  role?: 'analysis' | 'reference';
  /** QC: whether its checks are shown (always, except for reference data with QC off). */
  qcShown: boolean;
  /** QC: counts of its checks, once they ran. */
  qc?: { fails: number; notes: number; total: number };
  /** Arena: the real size or a known distance is set. */
  scaleSet: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Whether Skip is offered: Preprocess always, QC for reference data. */
export const isOptional = (f: Pick<StepFacts, 'section' | 'role'>): boolean =>
  f.section === 'prep' || (f.section === 'qc' && f.role === 'reference');

export function stepState(f: StepFacts): { state: StepState; text: string } {
  switch (f.section) {
    case 'overview':
      return f.visited ? { state: 'done', text: 'Viewed' } : { state: 'todo', text: 'Not opened' };
    case 'arena':
      return f.scaleSet
        ? { state: 'done', text: 'Size set' }
        : { state: 'todo', text: 'Arena size not set' };
    case 'qc': {
      if (!f.qcShown) return { state: 'off', text: 'Off for reference data' };
      if (!f.qc?.total) return { state: 'todo', text: 'No checks yet' };
      if (f.qc.fails) return { state: 'attention', text: `${plural(f.qc.fails, 'check')} failed` };
      const passed = f.qc.notes ? `Passed with ${plural(f.qc.notes, 'note')}` : 'Passed';
      if (f.skipped) return { state: 'skipped', text: 'Skipped' };
      return f.visited
        ? { state: 'done', text: passed }
        : { state: 'todo', text: `${passed} · not opened` };
    }
    case 'prep':
      if (f.role === 'reference') return { state: 'unused', text: 'Not used for reference data' };
      if (f.skipped) return { state: 'skipped', text: 'Skipped' };
      return f.visited
        ? { state: 'viewed', text: 'Viewed' }
        : { state: 'todo', text: 'Not opened' };
  }
}
