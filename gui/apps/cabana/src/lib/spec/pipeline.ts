// The framework steps shared by every analysis, as plain objects (framework step names and
// fields). The Preprocess page's YAML and the pipelines sent to the Python bridge both come from
// here, so the two cannot drift apart.

type Step = Record<string, unknown>;

export interface CommonInput {
  positionUnit: string;
  pxPerCm: number;
  fillGapS: number;
  posWindowS: number;
  posMethod: string;
  speedWindowS: number;
  minSpeed: number;
  eventSigmaS: number;
  labelPadS: number;
  /** Labels whose bouts are widened by `labelPadS`. */
  paddedLabels: string[];
  /** An arena outline exists, so position can be put on the spatial grid. */
  hasArenaBox: boolean;
  binCm: number;
  /** Arena size (cm). The grid covers [0, w] x [0, h] as the GUI's spatial bins do, not the data range. */
  arenaCm?: [number, number];
  /** Indices of QC-rejected cells. */
  rejected: number[];
}

export interface CommonOptions {
  /** `ids`: write `select_cells` here (YAML). `omit`: leave it out; the bridge adds it from indices. */
  rejected?: 'ids' | 'omit';
  /** Leave the spatial grid out (decoding and population write their own). */
  grid?: boolean;
  /** Position steps (resample, smoothing, speed, speed filter). Off for analyses that never read position. */
  position?: boolean;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function commonSteps(
  i: CommonInput,
  o: CommonOptions = {},
): { transforms: Step[]; preprocess: Step[] } {
  const transforms: Step[] = [];
  const withPosition = o.position !== false;
  if (withPosition && i.positionUnit === 'px')
    transforms.unshift({ name: 'arena_transform', signals: [''], scale: round(1 / i.pxPerCm) });
  if (withPosition && i.fillGapS > 0)
    transforms.push({ name: 'interpolate_gaps', signal: ['x', 'y'], max_gap_s: i.fillGapS });
  if (withPosition && i.posWindowS > 0)
    transforms.push({
      name: 'smooth_signal',
      signal: ['x', 'y'],
      method: i.posMethod,
      window_s: i.posWindowS,
    });
  if (withPosition)
    transforms.push({ name: 'speed', signals: ['x', 'y'], window_s: i.speedWindowS });
  if (withPosition && i.hasArenaBox && o.grid !== false)
    transforms.push({
      name: 'bin_grid',
      signals: ['x', 'y'],
      bin_size: i.binCm,
      ...(i.arenaCm && {
        extent: [
          [0, i.arenaCm[0]],
          [0, i.arenaCm[1]],
        ],
      }),
    });

  const preprocess: Step[] = [];
  if (i.rejected.length && o.rejected !== 'omit')
    preprocess.push({
      name: 'select_cells',
      exclude_ids: [...i.rejected].sort((a, b) => a - b).map(String),
    });
  if (i.eventSigmaS > 0) preprocess.push({ name: 'smooth_activity', sigma_s: i.eventSigmaS });
  if (withPosition)
    preprocess.push({ name: 'speed_threshold', signal: 'speed', min_speed: i.minSpeed });
  if (i.labelPadS > 0)
    for (const l of i.paddedLabels) {
      preprocess.push({
        name: 'mask_from_state',
        states: 'behavior',
        include: [l],
        output: `${l}_padded`,
      });
      preprocess.push({ name: 'clean_mask', mask: `${l}_padded`, dilate_s: i.labelPadS });
    }
  return { transforms, preprocess };
}
