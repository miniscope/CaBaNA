import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultNameFromPaths } from '../lib/new-project.ts';
import {
  analysisFromData,
  analysisToData,
  describeAnalysis,
  describeExperiment,
  describeProcessing,
  processingFromData,
  processingToData,
  PROCESSING_HEADER,
  yamlText,
  type ProcessingState,
} from '../lib/project-files.ts';

const defaults = (): ProcessingState => ({
  rejectedCells: [],
  excludeFrames: [],
  keptFrames: [],
  annotationFixes: { merge: false, drop: false },
  reviewed: [],
  continued: [],
  limits: { tol: { lostPct: 5, minBoutS: 0.25 }, maxSpeed: 60 },
  prep: {
    eventSigmaS: 0,
    traceSigmaS: 0,
    maxGapS: 0.5,
    fillGapS: 0.5,
    posMethod: 'median',
    posWindowS: 0.25,
    speedWindowS: 0.25,
    minSpeed: 2,
    labelPadS: 0,
  },
  decon: { indicator: 'gcamp6f', tauRise: 0.1, tauDecay: 0.6 },
});

const changed = (): ProcessingState => ({
  ...defaults(),
  rejectedCells: [11, 3],
  excludeFrames: [120, 121, 122],
  keptFrames: [400],
  annotationFixes: { merge: true, drop: false },
  reviewed: ['neural', 'position'],
  continued: ['cells'],
  limits: { tol: { lostPct: 8, minBoutS: 0.25 }, maxSpeed: 45 },
  prep: { ...defaults().prep, eventSigmaS: 0.2, posMethod: 'gaussian', labelPadS: 0.1 },
});

describe('processing.yaml', () => {
  it('reads back what it wrote, through YAML text', () => {
    const text = yamlText(processingToData(changed()), PROCESSING_HEADER);
    const back = processingFromData(parse(text), defaults());
    expect(back).toEqual({ ...changed(), rejectedCells: [3, 11] });
  });

  it('has the viewer shape: qc first, then preprocess, with the header comment', () => {
    const text = yamlText(processingToData(changed()), PROCESSING_HEADER);
    expect(text.startsWith('# QC decisions and preprocessing')).toBe(true);
    expect(text.indexOf('qc:')).toBeLessThan(text.indexOf('preprocess:'));
    expect(text).toContain('rejected_cells: [3, 11]');
    expect(text).toContain('event_smoothing_s: 0.2');
  });

  it('keeps current values for what a file leaves out', () => {
    const back = processingFromData({ preprocess: { speed_window_s: 0.5 } }, changed());
    expect(back.prep.speedWindowS).toBe(0.5);
    expect(back.prep.eventSigmaS).toBe(0.2);
    expect(back.rejectedCells).toEqual([11, 3]);
  });

  it('ignores a malformed file instead of failing', () => {
    expect(processingFromData('nonsense', defaults())).toEqual(defaults());
    expect(processingFromData({ qc: { rejected_cells: 'x' } }, defaults()).rejectedCells).toEqual(
      [],
    );
  });
});

describe('analysis.yaml', () => {
  it('has one section per analysis, empty when never set up', () => {
    const data = analysisToData({ peth: { bin_s: 0.1 } });
    expect(Object.keys(data)).toEqual(['place_cells', 'auroc', 'peth', 'population', 'decoding']);
    expect(data.auroc).toEqual({});
  });

  it('round-trips the sections that hold settings', () => {
    const sections = { peth: { binS: 0.1, behaviors: ['a'] }, decoding: { target: 'position' } };
    const back = analysisFromData(parse(yamlText(analysisToData(sections), 'x')));
    expect(back).toEqual(sections);
  });
});

describe('change summaries', () => {
  it('says what changed in words', () => {
    expect(describeProcessing(defaults(), changed())).toEqual(
      expect.arrayContaining([
        'Cells 4, 12 rejected',
        'Event smoothing 0.20 s (was off)',
        'Bout padding 0.10 s (was off)',
        'Position smoothing gaussian (was median)',
      ]),
    );
    expect(describeProcessing(defaults(), { ...defaults(), rejectedCells: [11] })).toEqual([
      'Cell 12 rejected',
    ]);
    expect(describeProcessing(changed(), changed())).toEqual([]);
  });

  it('names the analysis and the settings that changed', () => {
    expect(describeAnalysis({ peth: { binS: 0.1 } }, { peth: { binS: 0.2 } })).toEqual([
      'PETH settings changed: binS',
    ]);
    expect(describeAnalysis({ peth: { a: 1 } }, { peth: { a: 1 } })).toEqual([]);
  });

  it('names the groups of the experimental setup that changed', () => {
    expect(
      describeExperiment({ arena: { size: [60, 30] } }, { arena: { size: [60, 40] } }),
    ).toEqual(['Experimental setup changed: arena']);
  });
});

describe('default project name from paths', () => {
  const now = new Date(2026, 10, 18);
  it('is the shared folder', () => {
    expect(
      defaultNameFromPaths(['/Users/s/Lab/data/M24/a.csv', '/Users/s/Lab/data/M24/b.npy'], now),
    ).toBe('M24');
  });
  it('is the nearest shared folder of files from several folders', () => {
    expect(
      defaultNameFromPaths(['/Users/s/Lab/data/M24/a.csv', '/Users/s/Lab/data/M23/b.npy'], now),
    ).toBe('data');
  });
  it('is dated when the shared folder is the home folder or a disk root', () => {
    expect(defaultNameFromPaths(['/Users/s/a.csv', '/Users/s/b.csv'], now)).toBe(
      'Project 2026-11-18',
    );
    expect(defaultNameFromPaths(['/Users/s/Lab/a.csv', '/Users/s/Desktop/b.csv'], now)).toBe(
      'Project 2026-11-18',
    );
    expect(defaultNameFromPaths(['/Volumes/Disk/a.csv', '/Volumes/Disk/b.csv'], now)).toBe(
      'Project 2026-11-18',
    );
  });
});
