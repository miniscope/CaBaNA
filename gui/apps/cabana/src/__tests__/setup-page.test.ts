import { describe, expect, it } from 'vitest';
import { withoutAnimalDetails } from '../lib/config-template.ts';
import { checkFormat, describeFile, factsLine, npyShape, tableFacts } from '../lib/file-format.ts';
import {
  cellsByCheck,
  cellsLabel,
  footprintCentres,
  rowFractions,
  spanFractions,
  splitChecks,
} from '../lib/qc-markers.ts';
import type { Check } from '../lib/qc.ts';
import { cardActions, cardStatus, rowDescription } from '../lib/setup-rows.ts';
import {
  alignmentText,
  arenaText,
  clockText,
  durationText,
  rateText,
} from '../lib/setup-summary.ts';

const csv = (name: string, text: string) => describeFile(name, new Uint8Array(), text);
const reason = (r: ReturnType<typeof checkFormat>) => (r.ok ? '' : r.reason);

describe('format check', () => {
  it('names what time markers need and what the file has', () => {
    const info = csv('sync_pulses.txt', '1\n2\n3\n');
    expect(info.type).toBe('TXT');
    expect(factsLine(info)).toBe('TXT · 3 rows · 1 column');
    expect(reason(checkFormat('time_markers', info, 'Time markers'))).toBe(
      'Not valid: for time markers, the file needs the columns label and time_s. This file has one unnamed column.',
    );
  });
  it('accepts a table with the needed columns, matched as the loaders match them', () => {
    expect(
      checkFormat('time_markers', csv('a.csv', 'label,time_s\ntone,1\n'), 'Time markers').ok,
    ).toBe(true);
    // the marker loader wants exact names; the position loader takes any column containing them
    expect(
      checkFormat('time_markers', csv('a.csv', 'Label,time\ntone,1\n'), 'Time markers').ok,
    ).toBe(false);
    expect(checkFormat('position', csv('p.csv', 'frame,x_cm,y_cm\n0,1,2\n'), 'Position').ok).toBe(
      true,
    );
    expect(
      checkFormat(
        'neural_timestamps',
        csv('t.csv', 'Frame Number,Time Stamp (ms)\n0,0\n'),
        'Miniscope timestamps',
      ).ok,
    ).toBe(true);
    expect(
      checkFormat(
        'behavior_annotations',
        csv('b.csv', 'label,start_s,stop_s\na,1,2\n'),
        'Behavior annotations',
      ).ok,
    ).toBe(true);
  });
  it('lists the columns a file does have, and rejects a header with no rows', () => {
    const r = checkFormat('position', csv('p.csv', 'a,b\n1,2\n'), 'Position');
    expect(reason(r)).toContain('This file has the columns a, b.');
    expect(reason(checkFormat('position', csv('p.csv', 'frame,x,y\n'), 'Position'))).toContain(
      'at least one data row',
    );
  });
  it('checks arrays by file type and number of dimensions', () => {
    expect(
      checkFormat('neural_raw', { kind: 'npy', type: 'NPY', shape: [180, 9000] }, 'Raw traces').ok,
    ).toBe(true);
    expect(
      reason(
        checkFormat('footprints', { kind: 'npy', type: 'NPY', shape: [180, 9000] }, 'Footprints'),
      ),
    ).toContain('3-dimensional');
    expect(reason(checkFormat('neural_raw', csv('x.csv', 'a\n1\n'), 'Raw traces'))).toContain(
      '.npy',
    );
  });
  it('reads the shape from a .npy header', () => {
    const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (180, 9000), }";
    const bytes = new Uint8Array(10 + header.length);
    bytes.set([0x93, ...'NUMPY'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)));
    bytes.set(new TextEncoder().encode(header), 10);
    expect(npyShape(bytes)).toEqual([180, 9000]);
  });
  it('counts rows without the header', () => {
    expect(tableFacts('a,b\n1,2\n3,4\n')).toEqual({ columns: ['a', 'b'], rows: 2 });
  });
});

const check = (over: Partial<Check>): Check => ({
  id: 'x',
  group: 'Neural',
  title: 'T',
  status: 'pass',
  detail: '',
  ...over,
});

describe('QC markers', () => {
  it('numbers flags in order, pairs first, and keeps passed checks apart', () => {
    const { flags, passed } = splitChecks(
      [
        check({ id: 'snr', title: 'Signal to noise', status: 'pass', value: 'median 16.8' }),
        check({
          id: 'corr',
          title: 'Correlation',
          status: 'warn',
          value: '13 of 180',
          limit: 'allow 5%',
        }),
        check({ id: 'fp-overlap', title: 'Overlap', pairs: [{ a: 0, b: 4, note: '62% shared' }] }),
      ],
      { corr: { cells: [3, 7] } },
    );
    expect(flags.map((f) => [f.n, f.title])).toEqual([
      [1, 'Cells 1 and 5 overlap'],
      [2, 'Correlation'],
    ]);
    expect(flags[0]).toMatchObject({ cells: [0, 4], pair: true, text: '62% shared' });
    expect(flags[1]).toMatchObject({ cells: [3, 7], text: '13 of 180 · allow 5%' });
    expect(passed.map((p) => p.title)).toEqual(['Signal to noise', 'Overlap']);
  });
  it('lists the cells that are not good for each cell check, leaving out rejected ones', () => {
    const s = (snr: 'good' | 'warn', rejected = false) => ({
      snrLevel: snr,
      corrLevel: 'good' as const,
      eventLevel: 'good' as const,
      rejected,
    });
    expect(cellsByCheck([s('good'), s('warn'), s('warn', true)]).snr).toEqual([1]);
  });
  it('places markers as fractions of the plot', () => {
    expect(rowFractions([2, 0], [0, 1, 2, 3])).toEqual([0.625, 0.125]);
    expect(rowFractions([9], [0, 1])).toEqual([]);
    expect(spanFractions([[30, 60]], 0, 300)).toEqual([[0.1, 0.2]]);
    expect(spanFractions([[10, 10]], 0, 100)[0][1]).toBeGreaterThan(0.1);
    expect(spanFractions([[1, 2]], 0, 0)).toEqual([]);
  });
  it('shortens a long cell list', () => {
    expect(cellsLabel([0])).toBe('cell 1');
    expect(cellsLabel([0, 1, 2, 3, 4, 5, 6, 7], 3)).toBe('cells 1, 2, 3 and 5 more');
  });
  it('finds a footprint centre from its brightest pixels', () => {
    // one 4x4 cell, bright at x=2, y=1
    const d = new Float32Array(16);
    d[1 * 4 + 2] = 1;
    const [[x, y]] = footprintCentres(d, 1, 4, 4);
    expect([x, y]).toEqual([2.5, 1.5]);
  });
});

describe('card rows', () => {
  const base = { level: 'required' as const, loaded: true };
  it('says the status in words', () => {
    expect(cardStatus(base)).toMatchObject({ text: 'Loaded', tone: 'ok' });
    expect(cardStatus({ ...base, qc: { fails: 0, notes: 1 } })).toMatchObject({
      text: '1 check flagged',
      tone: 'warn',
    });
    expect(cardStatus({ ...base, qc: { fails: 2, notes: 1 } })).toMatchObject({
      text: '2 checks failed',
      tone: 'fail',
    });
    expect(cardStatus({ ...base, error: 'bad' })).toMatchObject({
      text: 'Could not be read',
      tone: 'fail',
    });
    expect(cardStatus({ ...base, loaded: false })).toMatchObject({
      text: 'Not loaded',
      tone: 'muted',
    });
  });
  it('allows View data only for a file that was read', () => {
    expect(cardActions({ loaded: true })).toEqual({ view: true });
    expect(cardActions({ loaded: false, error: 'x' })).toEqual({ view: false });
  });
  it('describes a row by type, level and facts', () => {
    expect(rowDescription('Raw traces', 'recommended')).toBe('Raw traces · recommended');
    expect(rowDescription('Position', 'recommended', '15,002 rows')).toBe(
      'Position · recommended · 15,002 rows',
    );
  });
});

describe('summary card', () => {
  it('formats rates, durations and the arena', () => {
    expect(rateText(30)).toBe('30 Hz');
    expect(rateText(undefined)).toBe('Not known');
    expect(durationText(300)).toBe('5 min');
    expect(arenaText('rectangle', 60, 30, 3)).toBe('60 × 30 cm, 3 zones');
    expect(arenaText('circle', 50, 50, 1)).toBe('50 cm across, 1 zone');
  });
  it('words the alignment checks: failed, then flagged, then passed', () => {
    expect(alignmentText([])).toMatchObject({ tone: 'muted' });
    expect(alignmentText(['pass', 'pass', 'pass', 'pass'])).toEqual({
      text: '4 checks passed',
      tone: 'ok',
    });
    expect(alignmentText(['pass', 'warn'])).toEqual({ text: '1 check flagged', tone: 'warn' });
    expect(alignmentText(['warn', 'fail'])).toEqual({ text: '1 check failed', tone: 'fail' });
  });
});

describe('export a copy', () => {
  it('leaves out the animal details and file names but keeps the settings', () => {
    const cfg = {
      name: 'M24',
      subjects: { focal: 'm1' },
      neural: {
        file: 'n.npy',
        kind: 'deconvolved',
        timestamps: 't.csv',
        alternatives: { raw: 'r.npy' },
      },
      behavior: { clock: { offset_s: 2 }, position: { file: 'p.csv', units: 'cm' } },
      arena: { size: [60, 30], units: 'cm' },
      metadata: { species: 'mouse', file: 'keep' },
    };
    const out = withoutAnimalDetails(cfg);
    expect(out).toEqual({
      neural: { kind: 'deconvolved' },
      behavior: { position: { units: 'cm' } },
      arena: { size: [60, 30], units: 'cm' },
      metadata: { species: 'mouse', file: 'keep' },
    });
    expect(cfg.name).toBe('M24');
  });
});

describe('camera clock correction text', () => {
  it('says nothing without an offset or scale, and names what is set otherwise', () => {
    expect(clockText(0, 1)).toBeUndefined();
    expect(clockText(0.35, 1.0004)).toBe('offset 0.35 s, scale 1.0004 (set in Experiment config)');
    expect(clockText(0, 0.9996)).toContain('scale 0.9996');
  });
});
