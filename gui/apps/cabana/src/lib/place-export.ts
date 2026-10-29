// What the results screen exports: one CSV of the cells, and the run's settings as JSON.

import { outcomeOf } from './place-outcome.ts';
import type { PlaceOutcome } from './place-run.ts';

const cell = (v: unknown) => (typeof v === 'number' && Number.isNaN(v) ? '' : v);

/** The cell table. The first line is a `#` comment with the settings the values depend on. */
export function placeCsv(out: PlaceOutcome): string {
  const r = out.result;
  const header = `# minimum_time_per_bin_s spatial_tuning=${out.settings.minOccS} place_field_boundaries=${out.settings.minOccFieldsS}; bin_cm=${out.data.grid.bin}; min_speed_cm_s=${out.data.minSpeed}\ncell,outcome,information,p_information,stability,p_stability,in_out_ratio,p_in_out_ratio,n_fields,peak_rate`;
  const lines = out.data.cellIds.map((id, i) =>
    [
      id + 1,
      outcomeOf(out, i).overall,
      r.information[i],
      r.pInformation[i],
      r.stability[i],
      r.pStability[i],
      r.inOut[i],
      r.pFields[i],
      r.nFields[i],
      r.peak[i],
    ]
      .map(cell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

/** Everything the run used and chose, for reproducing it. */
export function placeMetadata(out: PlaceOutcome) {
  const s = out.settings;
  const { grid } = out.data;
  return {
    analysis: 'place_cells',
    engine: out.engine === 'framework' ? 'framework' : 'browser-ts',
    run_id: out.record?.run_id,
    cells_analyzed: out.data.cellIds.length,
    frames: { used: out.data.used, total: out.data.input.frames },
    min_speed_cm_s: out.data.minSpeed,
    bin_cm: grid.bin,
    arena_cm: out.arenaCm,
    minimum_time_per_bin_s: {
      spatial_tuning: s.minOccS,
      place_field_boundaries: s.minOccFieldsS,
    },
    smoothing: {
      mode: s.sigmaAuto ? 'auto' : 'manual',
      sigma_bins: out.sigma,
      sigma_cm: out.sigma * grid.bin,
      ...(out.sigmaChoice && {
        candidates_bins: out.sigmaChoice.candidates,
        held_out_scores: out.sigmaChoice.scores,
        standard_errors: out.sigmaChoice.se,
        best_bins: out.sigmaChoice.best,
      }),
    },
    minimum_circular_shift: {
      mode: s.shiftAuto ? 'auto' : 'manual',
      seconds: out.minShiftS,
      ...(out.timescale && {
        neural_timescale_s: out.timescale.tauNeuralS,
        position_timescale_s: out.timescale.tauPositionS,
        note: out.timescale.note,
      }),
    },
    shuffles: out.nShuffles,
    distinct_shifts: out.distinctShifts,
    smallest_p: 1 / (out.distinctShifts + 1),
    seed: s.seed,
    significance_p: s.alpha,
    place_field: { fraction_of_peak: s.fieldThreshold, smallest_region_bins: s.minFieldBins },
    run_seconds: out.seconds,
  };
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
