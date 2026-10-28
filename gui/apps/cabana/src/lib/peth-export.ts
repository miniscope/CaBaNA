// What the PETH results screen exports: a CSV of the cell-behavior pairs, a CSV of the mean curves,
// and the run's settings as JSON.

import { RESPONSE_CSV } from './auroc-view.ts';
import { MIN_NONZERO_PREPOST } from './peth.ts';
import type { PethOutcome } from './peth-run.ts';
import {
  behaviorReason,
  curveOf,
  hasTest,
  labelAt,
  latencyDirOf,
  latencyOf,
  pAdjOf,
  pRawOf,
  summarize,
  valueOf,
  wilcoxonOf,
} from './peth-view.ts';

/** The latency direction in the CSV: 1 above the band, -1 below it, 0 no latency. */
const LATENCY_DIR_CSV: Record<number, string> = { 1: 'above', [-1]: 'below', 0: '' };

const CORRECTION_TEXT = {
  max_stat:
    'max-stat (Westfall-Young single-step minimum p) across the selected behaviors within each cell; not corrected across cells',
  none: 'none',
};

const v = (x: number) => (Number.isNaN(x) ? '' : x);

/** One row per cell and behavior. The `#` lines state the test, correction and its scope, which the p-values depend on. */
export function pethCsv(o: PethOutcome): string {
  const s = o.settings;
  const p = o.params;
  const head = [
    '# value = mean over onsets of (mean smoothed deconvolved trace in the response interval - mean in the baseline interval), a.u.',
    `# baseline_s=${p.baselineS.join(' to ')}; response_s=${p.responseS.join(' to ')}; onsets from unpadded behavior frame labels; all frames used`,
    hasTest(o)
      ? `# shuffle test: circular shift; correction: ${CORRECTION_TEXT[s.correction]}; alpha=${s.alpha}; two-sided; shuffles=${s.nShuffles}; minimum_shift_s=${o.minShiftS}; seed=${s.seed}`
      : '# no shuffle test: p-values and response labels are not computed',
    `# alignment: ${s.align === 'both' ? 'onset and offset, as separate columns (behavior names carry the alignment) and separate max-stat families' : s.align}; offset is the first frame after the bout (a GUI addition, not in the framework)`,
    '# latency_s, latency_direction and wilcoxon_p are descriptive: not corrected, not used for response labels, and a latency does not mean the response is significant',
    `# latency_s: first bin of ${s.latencyBins} consecutive bins on the same side of the null band (all above or all below). This same-direction rule is a GUI departure from the framework, which accepts any bins outside the band. Blank: not detected`,
    'cell,behavior,alignment,onsets,value_au,p_unadjusted,p_adjusted,response,latency_s,latency_direction,wilcoxon_p',
  ];
  const rows: string[] = [];
  o.cellIds.forEach((id, c) =>
    o.labels.forEach((label, b) => {
      const r = labelAt(o, c, b);
      rows.push(
        [
          id + 1,
          JSON.stringify(label),
          o.columns[b].align,
          o.reports[b].onsets.length,
          v(valueOf(o, c, b)),
          v(pRawOf(o, c, b)),
          v(pAdjOf(o, c, b)),
          r ? RESPONSE_CSV[r] : '',
          v(latencyOf(o, c, b)),
          LATENCY_DIR_CSV[latencyDirOf(o, c, b)],
          v(wilcoxonOf(o, c, b)),
        ].join(','),
      );
    }),
  );
  return [...head, ...rows].join('\n');
}

/** The mean curves, one row per cell, behavior and bin. */
export function pethCurvesCsv(o: PethOutcome): string {
  const p = o.params;
  const head = [
    `# mean over onsets of the smoothed deconvolved trace (a.u.)${p.baselineSubtract ? ', each onset minus its own baseline mean' : ', not baseline-subtracted'}; bin_s=${p.binS ?? 'one frame'}`,
    '# sem is across onsets; null_lo and null_hi are the 2.5th and 97.5th percentile of the shifted curves (empty with the null band off)',
    'cell,behavior,time_s,mean,sem,null_lo,null_hi',
  ];
  const rows: string[] = [];
  o.cellIds.forEach((id, c) =>
    o.labels.forEach((label, b) => {
      const k = curveOf(o, c, b);
      k.mean.forEach((m, i) =>
        rows.push(
          [id + 1, JSON.stringify(label), o.curves.timeS[i], v(m), v(k.sem[i]), v(k.lo?.[i] ?? NaN), v(k.hi?.[i] ?? NaN)].join(','),
        ),
      );
    }),
  );
  return [...head, ...rows].join('\n');
}

/** Everything the run used and chose, for reproducing it. */
export function pethMetadata(o: PethOutcome) {
  const s = o.settings;
  const sum = summarize(o);
  return {
    analysis: 'peth',
    neural_input: `smoothed deconvolved trace, a.u., event smoothing sigma ${o.prep.eventSigmaS} s (Preprocess)`,
    cells_analyzed: o.cellIds.length,
    cells_not_evaluated_non_finite_neural_values: o.cellsMissing.map((c) => o.cellIds[c] + 1),
    frames: { total: o.input.frames, used: 'all (no frame selection)' },
    window: {
      pre_s: o.params.preS,
      post_s: o.params.postS,
      baseline_s: o.params.baselineS,
      response_s: o.params.responseS,
    },
    onsets: {
      source: 'unpadded behavior frame labels',
      alignment: s.align,
      alignment_note:
        'offset is the first frame after the bout; offset alignment and the separate onset/offset corrections are GUI additions, not in the framework',
      minimum_bout_duration_s: o.params.minDurationS,
      minimum_gap_s: o.params.minGapS,
      minimum_onsets: o.params.minEvents,
      behaviors: o.labels.map((label, b) => ({
        label,
        alignment: o.columns[b].align,
        bouts: o.reports[b].bouts,
        included: o.reports[b].onsets.length,
        excluded: {
          bout_shorter_than_minimum: o.reports[b].short,
          gap_before_too_short: o.reports[b].gap,
          onset_outside_selected_frames: o.reports[b].outside,
          window_beyond_session: o.reports[b].edge,
        },
        not_evaluated: behaviorReason(o, b) ?? null,
      })),
    },
    display: { bin_s: o.params.binS, baseline_subtracted_curves: o.params.baselineSubtract },
    shuffle_test: hasTest(o)
      ? {
          method: 'circular_shift',
          minimum_shift_s: o.minShiftS,
          minimum_shift_auto: s.shiftAuto,
          timescale: o.timescale,
          shuffles: s.nShuffles,
          unique_shifts: o.uniqueShifts,
          seed: s.seed,
          shifts: Array.from(o.shifts),
          alpha: s.alpha,
          tail: 'two',
          correction: s.correction,
          correction_scope:
            s.correction === 'max_stat' ? 'across the selected behaviors within each cell' : 'none',
          response_uses: s.correction === 'max_stat' ? 'adjusted p-value' : 'uncorrected p-value',
        }
      : null,
    null_band_and_latency: o.band
      ? {
          descriptive: true,
          shifts: s.bandShifts,
          seed: s.bandSeed,
          minimum_shift_s: s.bandMinShiftS,
          latency_bins_outside: s.latencyBins,
          latency_rule:
            'first run of consecutive bins all above or all below the band (same direction); departs from the framework, which accepts any bins outside the band',
          band_shifts: Array.from(o.bandShifts ?? []),
        }
      : null,
    wilcoxon_pre_vs_post: {
      descriptive: true,
      shown: s.wilcoxon,
      minimum_nonzero_differences: MIN_NONZERO_PREPOST,
    },
    results: hasTest(o)
      ? {
          evaluated_cells: sum.evaluated,
          responding_cells: sum.respondingCells,
          significant_pairs: sum.significantPairs,
          higher: sum.higher,
          lower: sum.lower,
        }
      : null,
    seconds: o.seconds,
  };
}
