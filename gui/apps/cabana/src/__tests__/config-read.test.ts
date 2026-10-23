import { describe, expect, it } from 'vitest';
import { readConfig, restoreKept } from '../lib/config-read.ts';

// The framework's own template (write_session_dir_template), plus a metadata block.
const TEMPLATE = `
name: session01
neural:
  file: neural_deconvolved.npy
  orientation: cells_x_frames
  kind: deconvolved
  timestamps: neural_timestamps.csv
  alternatives:
    denoised: neural_denoised.npy
behavior:
  timestamps: behavior_timestamps.csv
  clock: {offset_s: 1.5, scale: 1.001}
  position:
    file: position.csv
    frame_column: frame
    columns: [x, y]
    missing_value: -1
    units: cm
    max_gap_s: 0.5
  head_orientation:
    file: headOrientation.csv
    format: quaternion_wxyz
    output: head_direction
    offset_deg: 12.0
  epochs:
    zones: {file: zone_annotations.csv, exclusive: true, merge_gap_s: 0.5, min_duration_s: 0.25}
    investigation: {file: data/investigation_annotations.csv, exclusive: false}
arena:
  size: [60, 30]
  units: cm
  zones:
    left: [0, 20]
    middle: [20, 0, 40, 30]
    tri: [[0, 0], [10, 0], [0, 10]]
  enclosures:
    left_cup: {center: [0, 15], radius: 9, contents: stimulus}
    right_cup: [60, 15, 9]
subjects:
  focal: mouse01
  stimulus: {left_cup: mouse02, right_cup: null}
metadata:
  species: mouse
  likelihood_threshold: 0.9
  body_length_cm: 8
  lab_notebook_page: 42
`;

describe('readConfig', () => {
  const r = readConfig(TEMPLATE);

  it('reads the values the GUI uses', () => {
    expect(r.problems).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.values).toMatchObject({
      name: 'session01',
      clockOffsetS: 1.5,
      clockScale: 1.001,
      positionUnit: 'cm',
      headOffsetDeg: 12,
      mergeGapS: 0.5,
      minBoutS: 0.25,
      arena: { width: 60, height: 30, shape: 'rectangle' },
      bodyLengthCm: 8,
      subjectId: 'mouse01',
      meta: { species: 'mouse', likelihoodMin: 0.9 },
      epochNames: { zone_annotations: 'zones', behavior_annotations: 'investigation' },
    });
  });

  it('maps file names to slots, without folders', () => {
    expect(r.files).toEqual({
      neural_deconvolved: 'neural_deconvolved.npy',
      neural_denoised: 'neural_denoised.npy',
      neural_timestamps: 'neural_timestamps.csv',
      behavior_timestamps: 'behavior_timestamps.csv',
      position: 'position.csv',
      head_orientation: 'headOrientation.csv',
      zone_annotations: 'zone_annotations.csv',
      behavior_annotations: 'investigation_annotations.csv',
    });
  });

  it('reads zones in the three framework shapes, and both enclosure forms', () => {
    expect(r.values.zones).toEqual([
      {
        name: 'left',
        kind: 'zone',
        shape: 'rect',
        pts: [
          [0, 0],
          [20, 30],
        ],
      },
      {
        name: 'middle',
        kind: 'zone',
        shape: 'rect',
        pts: [
          [20, 0],
          [40, 30],
        ],
      },
      {
        name: 'tri',
        kind: 'zone',
        shape: 'polygon',
        pts: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      },
      {
        name: 'left_cup',
        kind: 'exclude',
        shape: 'circle',
        pts: [
          [0, 15],
          [9, 15],
        ],
      },
      {
        name: 'right_cup',
        kind: 'exclude',
        shape: 'circle',
        pts: [
          [60, 15],
          [69, 15],
        ],
      },
    ]);
  });

  it('keeps framework keys it does not use', () => {
    expect(r.kept.map((k) => k.path.join('.')).sort()).toEqual(
      [
        'neural.orientation',
        'behavior.position.frame_column',
        'behavior.position.columns',
        'behavior.position.missing_value',
        'behavior.position.max_gap_s',
        'behavior.head_orientation.format',
        'behavior.head_orientation.output',
        'arena.enclosures.left_cup.contents',
        'subjects.stimulus',
        'metadata.lab_notebook_page',
      ].sort(),
    );
  });

  it('flags the old flat layout, unknown keys and a missing neural file', () => {
    const old = readConfig('arena_cm: [60, 30]\nzones:\n  left: [0, 20]\n');
    expect(old.unknown).toEqual(['arena_cm', 'zones']);
    expect(old.problems).toHaveLength(2);
    expect(old.problems[0]).toMatch(/older flat layout/);
    expect(old.problems[1]).toMatch(/neural.file is missing/);
  });

  it('reports YAML errors instead of throwing', () => {
    expect(readConfig('neural: [unclosed').problems[0]).toMatch(/not valid YAML/);
  });

  it('does not read zones when the arena is not in cm', () => {
    const r2 = readConfig('neural: {file: a.npy}\narena: {size: [600, 300], units: mm}\n');
    expect(r2.values.zones).toBeUndefined();
    expect(r2.problems[0]).toMatch(/arena.units "mm"/);
  });
});

describe('restoreKept', () => {
  it('fills in kept keys without overwriting, and skips ones whose parent is gone', () => {
    const out: Record<string, unknown> = {
      behavior: { position: { file: 'p.csv', max_gap_s: 1 } },
      arena: { enclosures: {} },
    };
    restoreKept(out, [
      { path: ['behavior', 'position', 'max_gap_s'], value: 0.5 },
      { path: ['behavior', 'position', 'columns'], value: ['x', 'y'] },
      { path: ['arena', 'enclosures', 'left_cup', 'contents'], value: 'stimulus' },
      { path: ['subjects', 'stimulus'], value: { a: 'b' } },
      { path: ['neural', 'orientation'], value: 'cells_x_frames' },
    ]);
    expect(out).toEqual({
      behavior: { position: { file: 'p.csv', max_gap_s: 1, columns: ['x', 'y'] } },
      arena: { enclosures: {} },
      subjects: { stimulus: { a: 'b' } },
    });
  });
});
