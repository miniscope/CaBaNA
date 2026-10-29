import { describe, expect, it } from 'vitest';
import { outsideRecording, readMarkers } from '../lib/markers.ts';

describe('readMarkers', () => {
  it('reads label and time, trims labels, keeps case', () => {
    const r = readMarkers('label,time_s\n tone ,10\nTone,20.5\n');
    expect(r.markers).toEqual([
      { label: 'tone', timeS: 10 },
      { label: 'Tone', timeS: 20.5 },
    ]);
    expect(r.problems).toEqual([]);
  });

  it('matches headers case-insensitively and notes extra columns', () => {
    const r = readMarkers('Time_S,LABEL,note\n5,shock,hard\n');
    expect(r.markers).toEqual([{ label: 'shock', timeS: 5 }]);
    expect(r.ignoredColumns).toEqual(['note']);
    expect(r.problems.join(' ')).toContain('note');
  });

  it('rejects rows with a missing or non-finite time and counts them', () => {
    const r = readMarkers('label,time_s\ntone,1\ntone,\ntone,abc\ntone,Infinity\n,3\n');
    expect(r.markers).toHaveLength(1);
    expect(r.rejected).toBe(4);
  });

  it('reports a missing column', () => {
    const r = readMarkers('label,seconds\ntone,1\n');
    expect(r.markers).toEqual([]);
    expect(r.problems[0]).toContain('time_s');
  });
});

describe('outsideRecording', () => {
  it('keeps markers outside [t0, t1]', () => {
    const m = [-1, 0, 5, 10, 11].map((timeS) => ({ label: 'a', timeS }));
    expect(outsideRecording(m, 0, 10).map((x) => x.timeS)).toEqual([-1, 11]);
  });
});
