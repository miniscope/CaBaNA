// What the auROC results screen exports: one CSV of the cell-behavior pairs, and the run's settings as JSON.

import { MIN_FRAMES } from './auroc.ts';
import type { AurocOutcome } from './auroc-run.ts';
import { aurocOf, pAdjOf, pRawOf, responseAt, RESPONSE_LABEL, summarize } from './auroc-view.ts';

const CORRECTION_TEXT = {
  max_stat:
    'max-stat (Westfall-Young single-step minimum p) across the selected behaviors within each cell; not corrected across cells',
  none: 'none',
};

/** One row per cell and behavior. The `#` lines state the correction and its scope, which the p-values depend on. */
export function aurocCsv(out: AurocOutcome): string {
  const s = out.settings;
  const head = [
    `# correction: ${CORRECTION_TEXT[s.correction]}; alpha=${s.alpha}; two-sided`,
    `# behaviors in the family: ${out.labels.join(', ')}`,
    `# shuffles=${s.nShuffles}; minimum_shift_s=${out.minShiftS}; seed=${s.seed}; method=${s.method === 'speed' ? 'speed-matched circular shift' : 'circular shift'}`,
    'cell,behavior,auroc,p_unadjusted,p_adjusted,response',
  ];
  const v = (x: number) => (Number.isNaN(x) ? '' : x);
  const rows: string[] = [];
  out.cellIds.forEach((id, c) =>
    out.labels.forEach((label, b) =>
      rows.push(
        [
          id + 1,
          JSON.stringify(label),
          v(aurocOf(out, c, b)),
          v(pRawOf(out, c, b)),
          v(pAdjOf(out, c, b)),
          RESPONSE_LABEL[responseAt(out, c, b)],
        ].join(','),
      ),
    ),
  );
  return [...head, ...rows].join('\n');
}

/** Everything the run used and chose, for reproducing it. */
export function aurocMetadata(out: AurocOutcome) {
  const s = out.settings;
  const sum = summarize(out);
  return {
    analysis: 'auroc',
    cells_analyzed: out.cellIds.length,
    cells_not_evaluated_missing_neural_values: out.cellsMissing.map((c) => out.cellIds[c] + 1),
    frames: {
      included: out.input.mask.reduce((a, b) => a + b, 0),
      total: out.input.frames,
      excluded: out.excluded,
    },
    behaviors: out.info.map((i) => ({
      ...i,
      tested: i.during >= MIN_FRAMES && i.outside >= MIN_FRAMES,
    })),
    min_frames: MIN_FRAMES,
    comparison: {
      method: s.method === 'speed' ? 'covariate_matched_shift (speed)' : 'circular_shift',
      minimum_shift_s: out.minShiftS,
      minimum_shift_auto: s.shiftAuto,
      timescale: out.timescale,
      shuffles: s.nShuffles,
      unique_shifts: out.uniqueShifts,
      seed: s.seed,
      shifts: Array.from(out.shifts),
      speed_matching: out.matched
        ? {
            ...s.match,
            candidates: out.matched.candidates,
            acceptance_rate: out.matched.acceptanceRate,
            balance_max: out.matched.balanceMax,
            balance_mean: out.matched.balanceMean,
            reused: out.matched.reused,
          }
        : undefined,
    },
    statistics: {
      alpha: s.alpha,
      tail: 'two',
      correction: s.correction,
      correction_scope:
        s.correction === 'max_stat' ? 'across the selected behaviors within each cell' : 'none',
      response_uses: 'adjusted p-value',
    },
    results: {
      evaluated_cells: sum.evaluated,
      responding_cells: sum.respondingCells,
      significant_pairs: sum.significantPairs,
      excited: sum.excited,
      inhibited: sum.inhibited,
    },
    seconds: out.seconds,
  };
}
