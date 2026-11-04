// What the PETH setup sections share: the data, the bouts each rule keeps, which behaviors are ready
// and the reasons the run cannot start. Called once by the page and handed to its sections.

import { createEffect, createMemo, createSignal } from 'solid-js';
import {
  alignsOf,
  estimateMinShift,
  pethAlignedReports,
  pethData,
  pethPlan,
  pethReports,
  pethRunIssue,
  pethSettings,
  seedPethSelection,
  setPethSettings,
} from '../lib/peth-run.ts';
import type { Align } from '../lib/peth.ts';
import { eventCounts } from '../lib/peth-setup.ts';
import { inRange, rangeIssue } from '../lib/ranges.ts';

/** The allowed range of the significance level. */
export const ALPHA = { min: 0.001, max: 0.5 };

export function createPethSetup() {
  const data = createMemo(() => pethData());
  const ok = () => {
    const x = data();
    return 'error' in x ? undefined : x;
  };
  const p = () => pethSettings.params;
  const aligns = () => alignsOf(pethSettings.align);
  const aligned = createMemo(() => (ok() ? pethAlignedReports(ok()!, pethSettings) : undefined));

  // The timeline draws one alignment; with both runs, a switch picks which.
  const [timelineChoice, setTimelineChoice] = createSignal<Align>('onset');
  const timelineAlign = (): Align =>
    aligns().includes(timelineChoice()) ? timelineChoice() : aligns()[0];
  const timelineReports = createMemo(() =>
    ok() ? pethReports(ok()!, p(), timelineAlign()) : undefined,
  );

  /** Included bouts of a behavior, one number per alignment run. */
  const counts = (b: number) => aligns().map((a) => aligned()?.[a]?.[b].onsets.length ?? 0);
  const countText = (b: number) => counts(b).join(' / ');
  const ready = (b: number) => counts(b).some((n) => n >= p().minEvents);
  const chosen = (b: number) => ready(b) && !pethSettings.unselected.includes(ok()!.labels[b]);
  const readyBehaviors = () => ok()!.labels.flatMap((_, b) => (chosen(b) ? [b] : []));
  const notEvaluated = () => ok()!.labels.filter((_, b) => !ready(b));
  /** Bouts and exclusions of the behaviors that will be tested, for one alignment. */
  const summaryOf = (a: Align) =>
    aligned()?.[a] ? eventCounts(aligned()![a]!, readyBehaviors()) : undefined;
  const toggle = (label: string) =>
    setPethSettings(
      'unselected',
      pethSettings.unselected.includes(label)
        ? pethSettings.unselected.filter((l) => l !== label)
        : [...pethSettings.unselected, label],
    );

  /** Alpha outside its range holds the run, with the reason. */
  const optionsIssue = () =>
    pethSettings.test === 'none' ? undefined : rangeIssue('Alpha', pethSettings.alpha, ALPHA);
  const alphaBad = () => pethSettings.test !== 'none' && !inRange(pethSettings.alpha, ALPHA);
  const issue = () =>
    (ok() ? pethRunIssue(ok()!, pethSettings, aligned()) : undefined) ?? optionsIssue();

  // Behaviors not marked controlled start out unselected, once, when the data first appear.
  let seeded = false;
  createEffect(() => {
    const d = ok();
    if (!d || seeded) return;
    seeded = true;
    seedPethSelection(d.labels);
  });

  // The automatic minimum shift, worked out ahead of the run so it can be shown here.
  createEffect(() => {
    const d = ok();
    const r = aligned();
    if (
      d &&
      r &&
      pethSettings.test === 'circular' &&
      pethSettings.shiftAuto &&
      !pethRunIssue(d, pethSettings, r)
    )
      estimateMinShift(
        pethPlan(
          d,
          { params: p(), unselected: [...pethSettings.unselected], align: pethSettings.align },
          r,
        ).input,
      );
  });

  return {
    data,
    ok,
    p,
    aligns,
    aligned,
    timelineAlign,
    setTimelineChoice,
    timelineReports,
    counts,
    countText,
    ready,
    chosen,
    readyBehaviors,
    notEvaluated,
    summaryOf,
    toggle,
    optionsIssue,
    alphaBad,
    issue,
  };
}
export type PethSetupState = ReturnType<typeof createPethSetup>;
