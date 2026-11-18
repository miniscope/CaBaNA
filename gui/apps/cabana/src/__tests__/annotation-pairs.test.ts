// Onset/offset pair check on behavior annotation files: rows with a missing start or stop, or a
// stop not after the start, are found as written in the file; the epochs read are unchanged.

import { describe, expect, it } from 'vitest';
import { pairCheck, pairIssues, readEpochs } from '../lib/behavior.ts';
import { parseCsvText } from '../lib/csv-text.ts';

const CSV = [
  'label,start_s,stop_s',
  'sniff,1.0,2.0',
  'sniff,3.0,',
  'groom,,5.0',
  'groom,7.0,6.5',
  'sniff,8.0,8.0',
  'groom,9.0,10.0',
].join('\n');

describe('onset and offset pairs', () => {
  it('finds each kind of unpaired row with its data row and label', () => {
    expect(pairIssues(parseCsvText(CSV))).toEqual([
      { row: 1, label: 'sniff', kind: 'no-stop' },
      { row: 2, label: 'groom', kind: 'no-start' },
      { row: 3, label: 'groom', kind: 'reversed' },
      { row: 4, label: 'sniff', kind: 'zero' },
    ]);
  });

  it('leaves the epochs read from the file as they were', () => {
    const t = parseCsvText(CSV);
    pairIssues(t);
    expect(readEpochs(t).map((e) => [e.start, e.stop])).toEqual([
      [1, 2],
      [3, 0],
      [0, 5],
      [7, 6.5],
      [8, 8],
      [9, 10],
    ]);
  });

  it('reports the counts in words and passes a clean file', () => {
    const t = parseCsvText(CSV);
    const c = pairCheck(pairIssues(t), t.rows.length);
    expect(c.status).toBe('warn');
    expect(c.value).toBe('4 of 6 rows');
    expect(c.detail).toContain('1 row has a start but no stop');
    expect(c.detail).toContain('1 row stops before it starts');
    expect(c.detail).toContain('Data table rows 1 (sniff), 2 (groom), 3 (groom), 4 (sniff).');
    const clean = parseCsvText('label,start_s,stop_s\nsniff,1,2');
    expect(pairCheck(pairIssues(clean), 1)).toMatchObject({ status: 'pass', value: 'None found' });
  });

  it('finds nothing without start and stop columns', () => {
    expect(pairIssues(parseCsvText('label,time_s\ntone,3'))).toEqual([]);
  });
});
