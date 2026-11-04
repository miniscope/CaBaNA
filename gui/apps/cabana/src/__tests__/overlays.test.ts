import { describe, expect, it } from 'vitest';
import {
  boutTip,
  coverageText,
  coveredSeconds,
  groupByFile,
  hitRow,
  hitStripe,
  isolate,
  layoutStripes,
  sameBout,
  setAll,
  shownNames,
  stripeBox,
  visibleBouts,
  type AnnotationFile,
} from '../lib/overlays.ts';

const b = (label: string, start: number, stop: number) => ({ label, start, stop });
const files: AnnotationFile[] = [
  { id: 'zones', name: 'zones.csv', epochs: [b('open', 0, 584), b('closed', 590, 600)] },
  {
    id: 'behavior',
    name: 'behavior.csv',
    epochs: [b('investigation', 10, 20), b('grooming', 18, 25), b('investigation', 100, 104)],
  },
];
const groups = groupByFile(files, 600);

describe('coverage and default rule', () => {
  it('counts overlapped time once', () => {
    expect(coveredSeconds([b('a', 0, 10), b('b', 5, 12), b('c', 20, 25)])).toBe(17);
    expect(coveredSeconds([])).toBe(0);
  });
  it('starts a file that covers most of the session unchecked', () => {
    expect(groups[0].coverage).toBeCloseTo(594 / 600);
    expect(groups.map((g) => g.startsOff)).toEqual([true, false]);
    expect([...shownNames(groups, {})]).toEqual(['investigation', 'grooming']);
  });
  it('lists behaviors with bout counts and time', () => {
    expect(groups[1].behaviors).toEqual([
      { name: 'investigation', bouts: 2, seconds: 14 },
      { name: 'grooming', bouts: 1, seconds: 7 },
    ]);
  });
  it('has no groups and no coverage without annotations or duration', () => {
    expect(groupByFile([], 600)).toEqual([]);
    expect(groupByFile(files, 0)[0].coverage).toBe(0);
  });
  it('formats coverage', () => {
    expect(coverageText(0.973)).toBe('97% of session');
    expect(coverageText(0.001)).toBe('<1% of session');
    expect(coverageText(0)).toBe('0% of session');
  });
});

describe('choices', () => {
  it('lets a saved choice override the file rule, by name', () => {
    expect(shownNames(groups, { open: true }).has('open')).toBe(true);
    expect(shownNames(groups, { grooming: false }).has('grooming')).toBe(false);
  });
  it('shows all, hides all, isolates one', () => {
    expect(shownNames(groups, setAll(groups, {}, true)).size).toBe(4);
    expect(shownNames(groups, setAll(groups, {}, false)).size).toBe(0);
    expect([...shownNames(groups, isolate(groups, {}, 'closed'))]).toEqual(['closed']);
  });
  it('keeps choices for names the session does not have', () => {
    expect(setAll(groups, { rearing: true }, false).rearing).toBe(true);
  });
  it('applies saved names to a session with another behavior set', () => {
    const other = groupByFile(
      [{ id: 'x', name: 'x.csv', epochs: [b('grooming', 1, 2), b('new', 3, 4)] }],
      600,
    );
    expect([...shownNames(other, { grooming: false })]).toEqual(['new']);
  });
});

describe('visibleBouts', () => {
  it('keeps shown behaviors that touch the window', () => {
    const shown = new Set(['investigation', 'grooming']);
    expect(visibleBouts(files, shown, [0, 30]).map((x) => x.label)).toEqual([
      'investigation',
      'grooming',
    ]);
    expect(visibleBouts(files, shown, [101, 110])).toEqual([b('investigation', 100, 104)]);
    expect(visibleBouts(files, new Set(), [0, 600])).toEqual([]);
  });
  it('drops empty bouts', () => {
    const f = [{ id: 'a', name: 'a', epochs: [b('x', 5, 5)] }];
    expect(visibleBouts(f, new Set(['x']), [0, 10])).toEqual([]);
  });
});

describe('layoutStripes', () => {
  it('gives a lone bout the whole height', () => {
    const [s] = layoutStripes([b('a', 0, 5)]);
    expect(stripeBox(s)).toEqual([0, 1]);
  });
  it('splits overlapping bouts into one stripe each, without blending', () => {
    const s = layoutStripes([b('a', 0, 10), b('b', 5, 15)]);
    expect(s.map((x) => [x.bout.label, x.lane, x.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
    expect(stripeBox(s[1])).toEqual([0.5, 0.5]);
  });
  it('reuses a lane once its bout has ended, and keeps separate clusters apart', () => {
    const s = layoutStripes([b('a', 0, 10), b('b', 5, 8), b('c', 9, 12), b('d', 50, 60)]);
    const by = Object.fromEntries(s.map((x) => [x.bout.label, [x.lane, x.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
  });
  it('treats bouts that only touch as separate', () => {
    expect(layoutStripes([b('a', 0, 5), b('b', 5, 10)]).map((x) => x.lanes)).toEqual([1, 1]);
  });
  it('handles no bouts', () => {
    expect(layoutStripes([])).toEqual([]);
  });
});

describe('hover', () => {
  const stripes = layoutStripes([b('a', 0, 10), b('b', 5, 15)]);
  it('finds the stripe under the mouse by time and height', () => {
    expect(hitStripe(stripes, 7, 0.2)?.bout.label).toBe('a');
    expect(hitStripe(stripes, 7, 0.8)?.bout.label).toBe('b');
    expect(hitStripe(stripes, 2, 0.8)).toBeUndefined();
    expect(hitStripe(stripes, 20, 0.2)).toBeUndefined();
  });
  it('widens thin bouts by a tolerance', () => {
    const thin = layoutStripes([b('a', 10, 10.01)]);
    expect(hitStripe(thin, 10.2, 0.5)).toBeUndefined();
    expect(hitStripe(thin, 10.2, 0.5, 0.3)?.bout.label).toBe('a');
  });
  it('finds the bout in a timeline row, the shortest when several touch', () => {
    const bouts = [b('a', 0, 100), b('a', 10, 12), b('b', 10, 12)];
    expect(hitRow(bouts, 'a', 11)).toEqual(b('a', 10, 12));
    expect(hitRow(bouts, 'c', 11)).toBeUndefined();
  });
  it('matches the same bout in the plot and the timeline', () => {
    expect(sameBout(hitStripe(stripes, 7, 0.2)?.bout, hitRow([b('a', 0, 10)], 'a', 3))).toBe(true);
    expect(sameBout(undefined, undefined)).toBe(false);
  });
  it('writes the tooltip', () => {
    expect(boutTip(b('grooming', 18, 25.5))).toEqual({
      title: 'grooming',
      lines: ['Start 18.00 s', 'Stop 25.50 s', 'Duration 7.50 s'],
    });
  });
});
