import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import {
  analysisSection,
  dataVersion,
  processingSection,
  yamlText,
} from '../lib/run-settings-view.ts';

const rec = (settings: unknown, inputs: { sha256: string }[] = []) =>
  ({ gui: { settings }, session: { inputs } }) as unknown as RunRecord;

describe('run settings view', () => {
  it('reads the analysis and processing sections of a framework record', () => {
    const r = rec({ analysis: { seed: 0 }, prep: { minSpeed: 2 } });
    expect(analysisSection(r)).toEqual({ seed: 0 });
    expect(processingSection(r)).toEqual({ minSpeed: 2 });
  });

  it('reads a browser record whose settings are the analysis itself', () => {
    const r = rec({ seed: 3 });
    expect(analysisSection(r)).toEqual({ seed: 3 });
    expect(processingSection(r)).toBeUndefined();
  });

  it('writes nested settings as indented text', () => {
    expect(yamlText({ a: 1, b: { c: 'x', d: [1, 2] }, e: [] })).toBe(
      'a: 1\nb:\n  c: "x"\n  d: [1, 2]\ne: []',
    );
  });

  it('names the data version from the input fingerprints', () => {
    expect(dataVersion(rec({}))).toBe('not recorded');
    expect(dataVersion(rec({}, [{ sha256: 'e822bf33aaaa' }, { sha256: 'x' }]))).toBe(
      '2 files, e822bf33',
    );
  });
});
