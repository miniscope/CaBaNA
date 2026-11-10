import { describe, expect, it } from 'vitest';
import { qcStatusText } from '../lib/qc-status.ts';

const c = (...s: ('pass' | 'warn' | 'fail')[]) => s.map((status) => ({ status }));

describe('qcStatusText', () => {
  it('states the result, the number of checks and the review', () => {
    expect(qcStatusText(c('pass', 'pass'), false)).toBe('Passed · 2 checks · not reviewed yet');
    expect(qcStatusText(c('pass', 'warn'), true)).toBe('Passed with 1 note · 2 checks · reviewed');
    expect(qcStatusText(c('fail', 'warn', 'warn'), false)).toBe(
      'Failed 1 check · 2 notes · 3 checks · not reviewed yet',
    );
  });
  it('says when nothing ran', () => {
    expect(qcStatusText([], false)).toBe('Nothing to check yet');
  });
});
