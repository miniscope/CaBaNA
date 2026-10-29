// What the Decoding results screen exports: a CSV of the per-bin results, a CSV of the decoded position of
// every used frame, and the run's settings as JSON.

import { behaviorRows, linearRows, summarizeBehavior, summarizeLinear, summarizeRun, stateRows } from './decoding-view.ts';
import type { BehaviorOutcome, DecodeOutcome, LinearOutcome } from './decoding-run.ts';
import { OTHER_NAME } from './decode-data.ts';

const v = (x: number) => (Number.isFinite(x) ? x : '');

const CORRECTION_TEXT = {
  max_stat:
    'max-stat (Westfall-Young single-step minimum p, framework _max_stat_p) across the tested spatial bins of this run; not applied to the overall test',
  none: 'none (uncorrected)',
};

/** Statement of what differs from the framework, repeated in every export. */
export const DEPARTURES = [
  'Test windows are clipped at their fold boundary: no frame of another fold enters a test frame (framework: the window may reach into neighbouring folds).',
  'The overall test (median error compared with the median error of every shuffle) is an extension: the framework reports the overall error but tests each bin only.',
  'Neural input is unsmoothed deconvolved events, binarized (> 0 is 1), whatever event smoothing is set in Preprocess.',
];

/** One row per spatial bin visited. The `#` lines state the statistic, the test and the correction, which the p-values depend on. */
export function decodingBinsCsv(o: DecodeOutcome): string {
  const s = o.settings;
  const head = [
    '# value = median decoding error in cm (distance between the centres of the decoded and true bin), held-out frames; smaller is better',
    `# bayesian decoder: ${o.params.likelihood}${o.params.likelihood === 'gaussian' ? `, sigma ${o.params.sigma}` : ''}; window_s=${o.params.windowS}; map_smoothing_bins=${o.params.smoothSigmaBins}; folds=${o.params.nFolds} contiguous time blocks; bin_cm=${o.binCm}`,
    o.test
      ? `# label shuffle test: block_s=${s.blockS}; shuffles=${s.nShuffles}; seed=${s.seed}; lower tail; correction: ${CORRECTION_TEXT[s.correction]}; alpha=${s.alpha}`
      : '# no shuffle test: p-values and significance are not computed',
    ...(o.test
      ? [
          `# overall (GUI extension to the framework): median error ${v(o.test.overall)} cm, chance error ${v(o.observed.chanceError)} cm, p=${v(o.test.pOverall)}`,
        ]
      : [`# overall: median error ${v(o.observed.errorOverall)} cm, chance error ${v(o.observed.chanceError)} cm`]),
    'bin_col,bin_row,x_cm,y_cm,frames,median_error_cm,p_unadjusted,p_adjusted,status',
  ];
  const { bin } = o.data.frames.grid;
  const rows = stateRows(o).map((r) =>
    [
      r.col,
      r.row,
      v((r.col + 0.5) * bin),
      v((r.row + 0.5) * bin),
      r.frames,
      v(r.value),
      v(r.pRaw),
      v(r.pAdj),
      r.status,
    ].join(','),
  );
  return [...head, ...rows].join('\n');
}

/** One row per used frame: the true and decoded bin, the error and the posterior confidence. Not-decoded frames have empty fields. */
export function decodingFramesCsv(o: DecodeOutcome): string {
  const { input } = o.data;
  const { observed: ob } = o;
  const nx = o.data.frames.grid.nx;
  const rows: string[] = [];
  const bin = o.data.frames.grid.bin;
  ob.usedFrames.forEach((t, j) => {
    const d = ob.decoded[t];
    rows.push(
      [
        t,
        (t / input.fs).toFixed(4),
        ob.folds[j],
        input.labels[t] % nx,
        Math.floor(input.labels[t] / nx),
        d >= 0 ? d % nx : '',
        d >= 0 ? Math.floor(d / nx) : '',
        v(ob.error[t]),
        v(ob.confPost[t]),
      ].join(','),
    );
  });
  return [
    `# one row per used frame; bin_cm=${bin}; error_cm is the distance between the centres of the decoded and true bin`,
    'frame,time_s,fold,true_col,true_row,decoded_col,decoded_row,error_cm,posterior_confidence',
    ...rows,
  ].join('\n');
}

/** Everything the run used and chose, for reproducing it. */
export function decodingMetadata(o: DecodeOutcome) {
  const s = o.settings;
  const sum = summarizeRun(o);
  const { input } = o.data;
  return {
    analysis: 'decoding',
    target: 'position',
    decoder: 'bayesian',
    framework: 'miniscope/CaBaNA framework-demo, commit 57c0c4b, BayesianDecoder (Shuman et al. 2020 Gaussian; Zhang et al. 1998 Poisson)',
    departures_from_framework: DEPARTURES,
    neural_input: 'unsmoothed deconvolved events, binarized (> 0 becomes 1), regardless of Preprocess event smoothing',
    cells: o.data.cellIds.map((c) => c + 1),
    frames: { total: input.frames, used: sum.usedFrames, decoded: sum.decodedFrames, sampling_rate_hz: input.fs },
    spatial_bins: {
      bin_cm: o.binCm,
      shape_rows_cols: input.shape,
      minimum_frames_per_bin: o.params.minFramesPerClass,
      evaluated: sum.evaluated,
      not_evaluated: sum.notEvaluated,
    },
    preprocess: o.prep,
    decoder_settings: {
      likelihood: o.params.likelihood,
      sigma: o.params.likelihood === 'gaussian' ? o.params.sigma : null,
      integration_window_s: o.params.windowS,
      integration_window_frames: Math.round(o.params.windowS * input.fs),
      map_smoothing_bins: o.params.smoothSigmaBins,
      folds: o.params.nFolds,
      fold_type: 'contiguous time blocks over the used frames',
      training_blocks_for_gaussian_sd: o.params.nTrialBlocks,
      prior: o.params.prior,
      window_clipped_at_fold_boundary: o.params.clipWindowToFold,
      data_derived_parameters: 'map means, s.d., smoothing and occupancy prior come from training folds only',
    },
    overall: {
      median_error_cm: v(o.observed.errorOverall),
      chance_error_cm: v(o.observed.chanceError),
      accuracy_within_bin: v(o.observed.accuracyOverall),
      mean_posterior_confidence: v(o.observed.meanConfidence),
      p_overall: o.test ? v(o.test.pOverall) : null,
      p_overall_note: o.test ? 'extension to the framework: overall median error against the median error of every shuffle' : null,
    },
    shuffle_test: o.test
      ? {
          method: 'label_shuffle',
          block_s: s.blockS,
          block_frames: o.blockFrames,
          shuffles: s.nShuffles,
          seed: s.seed,
          preset_note: 'block length and shuffle count are a starting preset, not validated optima',
          alpha: s.alpha,
          tail: 'lower',
          correction: s.correction,
          correction_text: CORRECTION_TEXT[s.correction],
          corrected_p_label: s.correction === 'none' ? 'uncorrected' : 'max-stat corrected',
          significant_bins: sum.significant,
        }
      : null,
    seconds: o.seconds,
  };
}

/** One row per behavior state. The `#` lines state the statistic, the test and the correction, which the p-values depend on. */
export function behaviorStatesCsv(o: BehaviorOutcome): string {
  const s = o.settings;
  const sum = summarizeBehavior(o);
  const head = [
    '# value = recall: the share of the frames of this behavior that were decoded as it, on held-out frames; larger is better',
    `# bayesian decoder: ${o.params.likelihood}${o.params.likelihood === 'gaussian' ? ', sigma pooled (one per cell)' : ''}; window_s=${o.params.windowS}; folds=${o.params.nFolds} contiguous time blocks`,
    `# one state per frame: overlapping behaviors resolved by priority order (${o.data.names.filter((n) => n !== OTHER_NAME).join(' > ')}); frames with none of them ${s.behavior.other ? 'form the state Other' : 'are left out'}`,
    o.test
      ? `# label shuffle test: block_s=${s.blockS}; shuffles=${s.nShuffles}; seed=${s.seed}; upper tail; correction: ${CORRECTION_TEXT[s.correction]}; alpha=${s.alpha}`
      : '# no shuffle test: p-values and significance are not computed',
    o.test
      ? `# overall (GUI extension to the framework): balanced accuracy ${v(sum.balancedAccuracy)}, p=${v(o.test.pOverall)}`
      : `# overall: balanced accuracy ${v(sum.balancedAccuracy)}`,
    'behavior,frames,recall,null_95th_percentile,p_unadjusted,p_adjusted,status',
  ];
  const rows = behaviorRows(o).map((r) =>
    [JSON.stringify(r.name), r.frames, v(r.value), v(r.nullHi), v(r.pRaw), v(r.pAdj), r.status].join(','),
  );
  return [...head, ...rows].join('\n');
}

/** The confusion matrix in frame counts, rows true and columns decoded. */
export function behaviorConfusionCsv(o: BehaviorOutcome): string {
  const n = o.data.names.length;
  const head = ['# frames of each true behavior (rows) decoded as each behavior (columns); empty for states not evaluated', ['true', ...o.data.names].map((x) => JSON.stringify(x)).join(',')];
  const rows = o.data.names.map((name, r) =>
    [JSON.stringify(name), ...Array.from({ length: n }, (_, d) => v(o.observed.confusion[r * n + d]))].join(','),
  );
  return [...head, ...rows].join('\n');
}

/** Everything the behavior run used and chose, for reproducing it. */
export function behaviorMetadata(o: BehaviorOutcome) {
  const s = o.settings;
  const sum = summarizeBehavior(o);
  return {
    analysis: 'decoding',
    target: 'behavior',
    decoder: 'bayesian',
    framework: 'miniscope/CaBaNA framework-demo, commit 57c0c4b, BayesianDecoder',
    departures_from_framework: DEPARTURES,
    neural_input: 'unsmoothed deconvolved events, binarized (> 0 becomes 1), regardless of Preprocess event smoothing',
    cells: o.data.cellIds.map((c) => c + 1),
    frames: { total: o.data.input.frames, labeled: sum.labeledFrames, decoded: sum.decodedFrames, sampling_rate_hz: o.data.fs },
    behaviors: {
      priority_order: o.data.names,
      overlap_rule: 'the earlier behavior in the priority order wins',
      frames_with_two_or_more_selected_behaviors: o.data.overlap.overlapping,
      overlap_pairs: o.data.overlap.pairs.map((p) => ({ winner: o.data.names[p.winner], loser: o.data.names[p.loser], frames: p.frames })),
      other_state: s.behavior.other,
      annotated_span_frames: o.data.scoredFrames,
      annotated_span_note: 'from the first annotated bout to the end of the last one',
      minimum_frames_per_state: o.params.minFramesPerClass,
      evaluated: sum.evaluated,
      not_evaluated: sum.notEvaluated,
    },
    decoder_settings: {
      likelihood: o.params.likelihood,
      sigma: o.params.likelihood === 'gaussian' ? 'pooled' : null,
      integration_window_s: o.params.windowS,
      folds: o.params.nFolds,
      fold_type: 'contiguous time blocks over the labeled frames',
      prior: o.params.prior,
      window_clipped_at_fold_boundary: o.params.clipWindowToFold,
      data_derived_parameters: 'map means, s.d. and occupancy prior come from training folds only',
    },
    overall: {
      statistic: 'balanced accuracy (mean recall over the evaluated behaviors)',
      value: v(sum.balancedAccuracy),
      p_overall: o.test ? v(o.test.pOverall) : null,
      p_overall_note: o.test ? 'extension to the framework: overall balanced accuracy against that of every shuffle' : null,
    },
    shuffle_test: o.test
      ? {
          method: 'label_shuffle',
          block_s: s.blockS,
          block_frames: o.blockFrames,
          shuffles: s.nShuffles,
          seed: s.seed,
          preset_note: 'block length and shuffle count are a starting preset, not validated optima',
          alpha: s.alpha,
          tail: 'upper',
          correction: s.correction,
          correction_text: CORRECTION_TEXT[s.correction],
          corrected_p_label: s.correction === 'none' ? 'uncorrected' : 'max-stat corrected',
          significant_behaviors: sum.significant,
        }
      : null,
    seconds: o.seconds,
  };
}

/** One row per behavior for logistic regression. The `#` lines state the statistic, classifier, test and correction. */
export function linearStatesCsv(o: LinearOutcome): string {
  const s = o.settings;
  const sum = summarizeLinear(o);
  const head = [
    '# value = balanced accuracy of the behavior against all other labeled bins, on held-out blocks; chance 0.5; larger is better',
    `# logistic regression (L2, C=${o.params.C}, balanced class weights, standardized with the training fold), one behavior against the rest; events summed in ${o.binS} s bins; folds=${o.params.nFolds} contiguous time blocks`,
    `# one state per bin: overlapping behaviors resolved by priority order (${o.data.names.filter((n) => n !== OTHER_NAME).join(' > ')}); bins with none of them ${s.behavior.other ? 'form the state Other' : 'are left out'}`,
    o.test
      ? `# label shuffle test: block_s=${s.blockS}; shuffles=${s.nShuffles}; seed=${s.seed}; upper tail; correction: ${CORRECTION_TEXT[s.correction]}; alpha=${s.alpha}`
      : '# no shuffle test: p-values and significance are not computed',
    o.test
      ? `# overall (GUI extension to the framework): mean balanced accuracy ${v(sum.meanBalancedAccuracy)}, p=${v(o.test.pOverall)}`
      : `# overall: mean balanced accuracy ${v(sum.meanBalancedAccuracy)}`,
    'behavior,bins,balanced_accuracy,null_95th_percentile,p_unadjusted,p_adjusted,status',
  ];
  const rows = linearRows(o).map((r) => [JSON.stringify(r.name), r.frames, v(r.value), v(r.nullHi), v(r.pRaw), v(r.pAdj), r.status].join(','));
  return [...head, ...rows].join('\n');
}

/** Everything the logistic-regression run used and chose, for reproducing it. */
export function linearMetadata(o: LinearOutcome) {
  const s = o.settings;
  const sum = summarizeLinear(o);
  return {
    analysis: 'decoding',
    target: 'behavior',
    decoder: 'logistic_regression',
    framework: 'miniscope/CaBaNA framework-demo, commit 57c0c4b, DecodeStates(classifier="logistic", mode="one_vs_rest")',
    classifier_note:
      'TypeScript port of the scikit-learn LogisticRegression objective (L2, balanced class weights), solved with L-BFGS to a largest gradient component of 1e-5; scikit-learn stops at tolerance 1e-4, so a frame on the decision boundary can differ. Weights agree with scikit-learn at tolerance 1e-12 to 5 decimals.',
    departures_from_framework: DEPARTURES.slice(1, 2),
    neural_input: 'unsmoothed deconvolved events summed per time bin, whatever the Preprocess event smoothing; each cell standardized with the training fold',
    cells: o.data.cellIds.map((c) => c + 1),
    time_bin_s: o.binS,
    bins: { total: o.linear.frames, labeled: sum.bins, sampling_rate_hz: o.linear.fs },
    behaviors: {
      priority_order: o.data.names,
      overlap_rule: 'the earlier behavior in the priority order wins',
      other_state: s.behavior.other,
      minimum_bins_per_state: o.params.minFramesPerClass,
      evaluated: sum.evaluated,
      not_evaluated: sum.notEvaluated,
    },
    classifier_settings: { C: o.params.C, class_weight: 'balanced', mode: 'one_vs_rest', folds: o.params.nFolds, fold_type: 'contiguous time blocks over the labeled bins', zscore: 'training fold mean and s.d.' },
    overall: {
      statistic: 'mean balanced accuracy over the decodable behaviors',
      value: v(sum.meanBalancedAccuracy),
      p_overall: o.test ? v(o.test.pOverall) : null,
      p_overall_note: o.test ? 'extension to the framework' : null,
    },
    shuffle_test: o.test
      ? {
          method: 'label_shuffle',
          block_s: s.blockS,
          block_bins: o.blockFrames,
          shuffles: s.nShuffles,
          seed: s.seed,
          preset_note: 'block length and shuffle count are a starting preset, not validated optima',
          alpha: s.alpha,
          tail: 'upper',
          correction: s.correction,
          correction_text: CORRECTION_TEXT[s.correction],
          corrected_p_label: s.correction === 'none' ? 'uncorrected' : 'max-stat corrected',
          significant_behaviors: sum.significant,
        }
      : null,
    seconds: o.seconds,
  };
}
