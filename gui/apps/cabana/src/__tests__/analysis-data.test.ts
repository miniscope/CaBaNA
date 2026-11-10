// The analysis data choice: written as neural.file and neural.kind with the other neural files as
// alternatives, and read back from a loaded config.

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  analysisKind,
  analysisSlot,
  isReference,
  qcShown,
  setAnalysisData,
  setReferenceQc,
} from '../lib/analysis-data.ts';
import { depChanges, runDeps } from '../lib/run-deps.ts';
import { sessionYaml } from '../lib/session-config.ts';
import { addFiles, clearAll, setSessionName } from '../lib/store.ts';

/** A small float32 .npy file of 20 frames x 2 cells. */
function npy(name: string): File {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (20, 2), }`;
  const padded = header.padEnd(Math.ceil((header.length + 11) / 64) * 64 - 11, ' ') + '\n';
  const head = new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, padded.length, 0]);
  const data = Float32Array.from({ length: 40 }, (_, i) => (i % 7) / 7);
  return new File([head, padded, data], name);
}
const layers = () => [
  npy('neural_deconvolved.npy'),
  npy('neural_denoised.npy'),
  npy('neural_raw.npy'),
];

describe('analysis data', () => {
  it('is the deconvolved events by default, the others reference data', async () => {
    clearAll();
    await addFiles(layers());
    expect(analysisKind()).toBe('deconvolved');
    expect(isReference('neural_raw')).toBe(true);
    expect(isReference('neural_deconvolved')).toBe(false);
    expect(parse(sessionYaml()).neural).toMatchObject({
      file: 'neural_deconvolved.npy',
      kind: 'deconvolved',
      alternatives: { denoised: 'neural_denoised.npy', raw: 'neural_raw.npy' },
    });
  });

  it('writes the chosen file as neural.file and reads the choice back', async () => {
    clearAll();
    await addFiles(layers());
    setAnalysisData('denoised');
    expect(analysisSlot()).toBe('neural_denoised');
    const text = sessionYaml();
    expect(parse(text).neural).toEqual({
      file: 'neural_denoised.npy',
      kind: 'denoised',
      alternatives: { deconvolved: 'neural_deconvolved.npy', raw: 'neural_raw.npy' },
    });

    clearAll();
    expect(analysisKind()).toBeUndefined();
    await addFiles([...layers(), new File([text], 'config.yaml')]);
    expect(analysisKind()).toBe('denoised');
    expect(isReference('neural_deconvolved')).toBe(true);
    expect(parse(sessionYaml()).neural.kind).toBe('denoised');
  });

  it('changes neural.file in a loaded config and keeps the rest', async () => {
    clearAll();
    const cfg = [
      'neural:',
      '  file: neural_deconvolved.npy',
      '  kind: deconvolved',
      '  alternatives: {denoised: neural_denoised.npy, raw: neural_raw.npy}',
      '',
    ].join('\n');
    await addFiles([...layers(), new File([cfg], 'config.yaml')]);
    setAnalysisData('raw');
    expect(parse(sessionYaml()).neural).toEqual({
      file: 'neural_raw.npy',
      kind: 'raw',
      alternatives: { denoised: 'neural_denoised.npy', deconvolved: 'neural_deconvolved.npy' },
    });
  });

  it('falls back to a loaded layer when the chosen one is not loaded', async () => {
    clearAll();
    setAnalysisData('raw');
    await addFiles([npy('neural_denoised.npy')]);
    expect(analysisKind()).toBe('denoised');
  });

  it('shows reference QC only when turned on, per file and dataset', async () => {
    clearAll();
    await addFiles(layers());
    setSessionName('day 1');
    expect(qcShown('neural_deconvolved')).toBe(true);
    expect(qcShown('neural_raw')).toBe(false);
    setReferenceQc('neural_raw', true);
    expect(qcShown('neural_raw')).toBe(true);
    expect(qcShown('neural_denoised')).toBe(false);
    setSessionName('day 2');
    expect(qcShown('neural_raw')).toBe(false);
    setSessionName('day 1');
    expect(qcShown('neural_raw')).toBe(true);
    setReferenceQc('neural_raw', false);
    expect(qcShown('neural_raw')).toBe(false);
  });

  it('marks earlier results out of date when the analysis data changes', async () => {
    clearAll();
    await addFiles(layers());
    const uses = { position: false, grid: false, labels: [] };
    const before = runDeps(uses);
    expect(before).not.toHaveProperty('analysisData');
    setAnalysisData('denoised');
    expect(depChanges(before, runDeps(uses))).toEqual(['analysis data']);
  });
});
