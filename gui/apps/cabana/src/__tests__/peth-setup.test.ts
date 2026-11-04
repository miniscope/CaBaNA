import { describe, expect, it } from 'vitest';
import {
  analyzePeth,
  DEFAULT_PETH_PARAMS,
  onsetReport,
  pethCurves,
  pethNullBand,
  type OnsetReport,
  type PethInput,
  type PethParams,
} from '../lib/peth.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import { drawShifts, makeRng } from '../lib/placecells.ts';
import {
  columnsOf,
  countsText,
  eventCounts,
  latencyTicks,
  pethCards,
  reasonLines,
  SETTING_TAGS,
  signalLabel,
  tagText,
} from '../lib/peth-setup.ts';

const rep = (bouts: number, kept: number, r: Partial<OnsetReport>): OnsetReport => ({
  bouts,
  onsets: new Int32Array(kept),
  short: 0,
  gap: 0,
  outside: 0,
  edge: 0,
  ...r,
});

describe('event counts', () => {
  const reports = [
    rep(30, 20, { short: 6, gap: 3, edge: 1 }),
    rep(9, 6, { gap: 3 }),
    rep(5, 5, {}),
  ];
  it('adds the chosen behaviors and splits the excluded by reason', () => {
    const c = eventCounts(reports, [0, 1]);
    expect(c).toMatchObject({ bouts: 39, included: 26, excluded: 13, short: 6, gap: 6, edge: 1 });
  });
  it('writes both numbers, never a ratio', () => {
    expect(countsText(eventCounts(reports, [0, 1]))).toBe('26 included · 13 excluded');
    expect(countsText(eventCounts(reports, []))).toBe('0 included · 0 excluded');
  });
  it('lists only reasons that occurred, with the gap side following the alignment', () => {
    const c = eventCounts(reports, [0, 1]);
    const p = { minDurationS: 1.5, minGapS: 1 };
    expect(reasonLines(c, p, 'onset')).toEqual([
      '6 too short (under 1.5 s)',
      '6 too close: under 1 s after the end of the previous bout',
      '1 window runs past the recording edge',
    ]);
    expect(reasonLines(c, p, 'offset')[1]).toMatch(/before the next bout/);
    expect(reasonLines(eventCounts(reports, [2]), p, 'onset')).toEqual([]);
  });
});

describe('setting tags and labels', () => {
  it('tags the settings the code treats as test or display', () => {
    for (const id of [
      'baseline',
      'response',
      'alignment',
      'minDuration',
      'minGap',
      'minEvents',
      'shuffles',
      'minShift',
      'alpha',
      'correction',
    ] as const)
      expect(tagText(id)).toBe('changes the test');
    for (const id of [
      'window',
      'binSize',
      'baselineSubtract',
      'nullBand',
      'latency',
      'wilcoxon',
    ] as const)
      expect(tagText(id)).toBe('display only');
    expect(Object.keys(SETTING_TAGS)).toContain('seed');
  });
  it('names the signal by what it is', () => {
    expect(signalLabel(true)).toBe('Deconvolved events (baseline-subtracted, a.u.)');
    expect(signalLabel(false)).toBe('Deconvolved events (a.u.)');
    expect(signalLabel(true)).not.toMatch(/ΔF|dF/);
  });
});

// Same fixture idea as peth-view.test.ts: cell 0 jumps after every onset, cell 1 is noise, cell 2 has a missing value.
const [fs, frames] = [10, 600];
const params: PethParams = {
  ...DEFAULT_PETH_PARAMS,
  preS: 2,
  postS: 2,
  baselineS: [-2, -1],
  responseS: [0, 1],
  binS: 0.2,
  minDurationS: 0.5,
  minGapS: 0.5,
};
const starts = [
  [100, 200, 300, 400, 500],
  [150, 350],
];
const behaviors = new Uint8Array(2 * frames);
starts.forEach((row, b) =>
  row.forEach((s) => behaviors.fill(1, b * frames + s, b * frames + s + 10)),
);
const neural = new Float32Array(3 * frames);
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let t = 0; t < frames; t++) {
  neural[frames + t] = 0.1 * rnd();
  neural[2 * frames + t] = 0.1 * rnd();
  neural[t] = 0.05 * rnd() + (starts[0].some((s) => t >= s && t < s + 10) ? 5 : 0);
}
neural[2 * frames + 5] = NaN;
const input: PethInput = {
  neural,
  cells: 3,
  frames,
  fs,
  behaviors,
  nBehaviors: 2,
  mask: new Uint8Array(frames).fill(1),
};
const reports = onsetReport(input, params);
const onsets = reports.map((r) => r.onsets);
const shifts = drawShifts(frames, 100, 50, makeRng(0)).shifts;
const curves = pethCurves(input, onsets, params);
const out = {
  labels: ['Investigation (onset)', 'Mounting (onset)'],
  cellIds: [0, 1, 2],
  input,
  reports,
  onsets,
  params,
  result: analyzePeth(input, onsets, params, shifts, 'max_stat'),
  curves,
  band: pethNullBand(input, onsets, params, shifts, 2, curves),
  cellsMissing: [2],
  shifts,
  columns: [
    { b: 0, align: 'onset' },
    { b: 1, align: 'onset' },
  ],
  settings: { test: 'circular', alpha: 0.05, align: 'onset', latencyBins: 2 },
} as unknown as PethOutcome;

describe('result cards', () => {
  it('state their denominators', () => {
    const [resp, higher, lower, lat] = pethCards(out, 'onset');
    expect(resp).toMatchObject({ label: 'Responsive cells', value: '1' });
    expect(resp.denom).toMatch(/^1 of 2 cells evaluated/);
    expect(higher.value).toBe('1');
    expect(higher.denom).toMatch(/of 2 cell–behavior pairs evaluated/);
    expect(lower.value).toBe('0');
    expect(lat.label).toBe('Latency (descriptive)');
    expect(lat.help).toBeDefined();
  });
  it('never combines onset and offset', () => {
    const both = {
      ...out,
      columns: [
        { b: 0, align: 'onset' },
        { b: 0, align: 'offset' },
      ],
      settings: { ...out.settings, align: 'both' },
    } as unknown as PethOutcome;
    expect(columnsOf(both, 'onset')).toEqual([0]);
    expect(columnsOf(both, 'offset')).toEqual([1]);
    expect(pethCards(both, 'onset')[1].denom).toMatch(/aligned to bout onset/);
    expect(pethCards(both, 'offset')[1].denom).toMatch(/aligned to bout offset/);
  });
  it('shows one card when the run had no shuffle test', () => {
    const none = { ...out, settings: { ...out.settings, test: 'none' } } as unknown as PethOutcome;
    expect(pethCards(none)).toHaveLength(1);
  });
  it('lists the latency of each significant cell', () => {
    const { ticks, significant } = latencyTicks(out, 0);
    expect(significant).toBe(1);
    expect(ticks.length).toBeLessThanOrEqual(significant);
    for (const t of ticks) expect(t.cell).toBe(0);
  });
});
