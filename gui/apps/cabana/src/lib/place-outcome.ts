// How each cell of a finished place-cell run did, in words: the two tests that make the
// place-cell call, the overall outcome, and why a value is undefined.

import type { PlaceOutcome } from './place-run.ts';

export type Test = 'pass' | 'fail' | 'undef';
export type Overall = 'both' | 'info' | 'stab' | 'neither' | 'cannot';

/** Outcomes in the order the list sorts them, with the text and symbol that show them. */
export const OVERALL: Record<Overall, { label: string; filter: string; icon: string }> = {
  both: { label: 'Both tests', filter: 'Both tests', icon: '✓' },
  info: { label: 'Spatial information only', filter: 'Spatial information only', icon: '◐' },
  stab: { label: 'Spatial stability only', filter: 'Spatial stability only', icon: '◑' },
  neither: { label: 'Neither test', filter: 'Neither test', icon: '✕' },
  cannot: { label: 'Not evaluated', filter: 'Not evaluated', icon: '?' },
};
export const OVERALL_ORDER = Object.keys(OVERALL) as Overall[];

export const TEST_ICON: Record<Test, string> = { pass: '✓', fail: '✕', undef: '?' };

const testOf = (p: number, alpha: number): Test =>
  Number.isNaN(p) ? 'undef' : p < alpha ? 'pass' : 'fail';

/** The two tests and the overall outcome of result row `i`. A test that cannot be evaluated makes the cell "cannot evaluate". */
export function outcomeOf(
  out: PlaceOutcome,
  i: number,
): { info: Test; stab: Test; overall: Overall } {
  const info = testOf(out.result.pInformation[i], out.settings.alpha);
  const stab = testOf(out.result.pStability[i], out.settings.alpha);
  const overall: Overall =
    info === 'undef' || stab === 'undef'
      ? 'cannot'
      : info === 'pass' && stab === 'pass'
        ? 'both'
        : info === 'pass'
          ? 'info'
          : stab === 'pass'
            ? 'stab'
            : 'neither';
  return { info, stab, overall };
}

/** Why a value of cell row `i` is undefined, from the data the run used. `undefined` when it is defined. */
export function whyUndefined(
  out: PlaceOutcome,
  i: number,
  what: 'information' | 'stability' | 'inOut',
): string | undefined {
  const r = out.result;
  if (!Number.isNaN(r[what][i])) return undefined;
  const { frames, neural } = out.data.input;
  const own = neural.subarray(i * frames, (i + 1) * frames);
  if (own.some((v) => !Number.isFinite(v)))
    return 'The neural data of this cell has missing values.';
  const n = r.nStates;
  const map = (a: Float32Array) => a.subarray(i * n, (i + 1) * n);
  const finite = (a: Float32Array) => a.filter(Number.isFinite);
  if (what === 'stability') {
    const [a, b] = [map(r.rateA), map(r.rateB)];
    const shared = a.reduce(
      (k, v, j) => k + (Number.isFinite(v) && Number.isFinite(b[j]) ? 1 : 0),
      0,
    );
    return shared < 3
      ? `Only ${shared} bins were visited long enough in both halves; at least 3 are needed.`
      : 'One of the two half maps is constant, so a correlation cannot be computed.';
  }
  const f = finite(map(r.rate));
  if (!f.length)
    return `No bin was visited for the minimum time (${out.settings.minOccFieldsS} s).`;
  if (what === 'information')
    return 'The cell is silent in the used frames (no events in the bins it visited).';
  return r.nFields[i] === 0
    ? 'No region reached the minimum field size.'
    : 'There are no bins outside the fields, or the mean outside them is zero.';
}
