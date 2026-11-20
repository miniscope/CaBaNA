import { describe, expect, it } from 'vitest';
import { shapeText } from '../lib/data-shape.ts';

describe('data shape on a Data setup row', () => {
  it('gives frames for timestamps and cells x frames for traces', () => {
    const ts = { kind: 'table' as const, columns: ['Frame Number', 'Time Stamp (ms)'], rows: 9000 };
    expect(shapeText('neural_timestamps', ts)).toBe('(9,000)');
    expect(shapeText('behavior_timestamps', { ...ts, rows: 15002 })).toBe('(15,002)');
    const m = { kind: 'matrix' as const, cells: 180, frames: 9000 };
    expect(shapeText('neural_deconvolved', m)).toBe('(180, 9,000)');
    expect(shapeText('neural_raw', m)).toBe('(180, 9,000)');
  });
  it('gives cells x height x width for footprints', () => {
    expect(
      shapeText('footprints', { kind: 'footprints', cells: 180, height: 160, width: 160 }),
    ).toBe('(180, 160, 160)');
  });
  it('counts value columns of tables, leaving out the frame or time column', () => {
    expect(
      shapeText('position', { kind: 'table', columns: ['frame', 'x', 'y'], rows: 15002 }),
    ).toBe('(15,002, 2)');
    expect(
      shapeText('head_orientation', {
        kind: 'table',
        columns: ['Time Stamp (ms)', 'qw', 'qx', 'qy', 'qz'],
        rows: 9000,
      }),
    ).toBe('(9,000, 4)');
    expect(
      shapeText('frame_labels', {
        kind: 'table',
        columns: ['frame', 'grooming', 'rearing', 'behavior'],
        rows: 15002,
      }),
    ).toBe('(15,002, 3)');
  });
  it('counts bouts, epochs and markers', () => {
    expect(shapeText('behavior_annotations', { kind: 'count', count: 30 })).toBe('30 bouts');
    expect(shapeText('zone_annotations', { kind: 'count', count: 1 })).toBe('1 epoch');
    expect(shapeText('time_markers', { kind: 'count', count: 12 })).toBe('12 markers');
  });
  it('gives the picture size of the behavior video frame', () => {
    expect(shapeText('behavior_frame', { kind: 'image', width: 640, height: 480 })).toBe(
      '640 × 480 px',
    );
  });
});
