// The analysis window of the PETH setup page: one time-axis diagram that redraws from the entered
// values, the six boxes under it, and what is wrong with them.

import { For, Show, type JSX } from 'solid-js';
import { DEFAULT_PETH_SETTINGS, pethSettings, setPethSettings } from '../lib/peth-run.ts';
import { pethGeometry, windowProblems } from '../lib/peth.ts';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { ORANGE, PURPLE, timeTicks } from './PethPlots.tsx';

const D = DEFAULT_PETH_SETTINGS.params;
const p = () => pethSettings.params;

/** The window, baseline and response drawn on one axis, each only when its two ends are valid. */
function Diagram(): JSX.Element {
  const [L, W] = [20, 430];
  const w = () => [-p().preS, p().postS] as const;
  const lo = () => Math.min(w()[0], -1);
  const hi = () => Math.max(w()[1], 1);
  const x = (s: number) => L + ((s - lo()) / (hi() - lo())) * W;
  const interval = (iv: readonly [number, number], color: string, name: string) => (
    <Show when={iv[1] > iv[0]}>
      <rect x={x(iv[0])} y="40" width={x(iv[1]) - x(iv[0])} height="18" fill={color} opacity="0.85" />
      <text x={(x(iv[0]) + x(iv[1])) / 2} y="22" text-anchor="middle" font-size="12" fill={color} font-weight="600">
        {name}
      </text>
      <text x={(x(iv[0]) + x(iv[1])) / 2} y="35" text-anchor="middle" font-size="11" fill={color}>
        {iv[0]} to {iv[1]} s
      </text>
    </Show>
  );
  return (
    <svg
      class="cb-pe-diagram"
      viewBox="0 0 470 90"
      role="img"
      aria-label={`Analysis window from ${w()[0]} to ${w()[1]} s, baseline ${p().baselineS[0]} to ${p().baselineS[1]} s, response ${p().responseS[0]} to ${p().responseS[1]} s`}
    >
      <Show when={w()[1] > w()[0]}>
        <rect x={x(w()[0])} y="44" width={x(w()[1]) - x(w()[0])} height="10" fill="#eaeef2" />
      </Show>
      {interval(p().baselineS, PURPLE, 'Baseline')}
      {interval(p().responseS, ORANGE, 'Response')}
      <line x1={x(0)} x2={x(0)} y1="8" y2="66" stroke="#222" stroke-dasharray="4 3" />
      <text x={x(0)} y="7" text-anchor="middle" font-size="11" fill="#222">
        onset
      </text>
      <line x1={L} x2={L + W} y1="66" y2="66" stroke="#8c959f" />
      <For each={timeTicks(lo(), hi())}>
        {(t) => (
          <>
            <line x1={x(t)} x2={x(t)} y1="66" y2="70" stroke="#8c959f" />
            <text x={x(t)} y="81" text-anchor="middle" font-size="11" fill="#666">
              {t}
            </text>
          </>
        )}
      </For>
      <text x={L + W / 2} y="88" text-anchor="middle" font-size="11" fill="#666">
        Time from behavior onset (s) · gray: full window
      </text>
    </svg>
  );
}

/** Frame counts of the window at the session's sampling rate, or undefined while the values are invalid. */
function frameText(fs: number): string | undefined {
  if (windowProblems(p(), fs).length) return undefined;
  const g = pethGeometry(p(), fs);
  const overlap = g.base[1] > g.resp[0] && g.resp[1] > g.base[0];
  return `At ${+fs.toFixed(2)} Hz: window ${g.pre + g.post} frames, baseline ${g.base[1] - g.base[0]}, response ${g.resp[1] - g.resp[0]}.${overlap ? ' Baseline and response overlap.' : ''}`;
}

export function PethWindow(props: { fs: number }): JSX.Element {
  const problems = () => windowProblems(p(), props.fs);
  const bad = (word: string) => problems().some((m) => m.startsWith(word));
  const badWindow = () => problems().some((m) => /before the onset|after the onset/.test(m));
  const set = (iv: 'baselineS' | 'responseS', i: 0 | 1) => (v: number) => setPethSettings('params', iv, i, v);
  const row = (name: JSX.Element, a: JSX.Element, b: JSX.Element) => (
    <>
      <span>{name}</span>
      <span>
        {a} to {b} s
      </span>
    </>
  );
  return (
    <div class="cb-pe-window">
      <Diagram />
      <div class="cb-pe-wgrid">
        {row(
          <>
            Full window
            <InfoTip label="About the full window">
              Time before and after each onset that is cut out and shown. The baseline and response intervals must lie
              inside it. Time before the onset is entered as a negative number.
            </InfoTip>
          </>,
          <NumField label="Window start (s)" value={-p().preS} def={-D.preS} max={0} bad={badWindow()} onSet={(v) => setPethSettings('params', 'preS', -v)} />,
          <NumField label="Window end (s)" value={p().postS} def={D.postS} min={0} bad={badWindow()} onSet={(v) => setPethSettings('params', 'postS', v)} />,
        )}
        {row(
          <>
            <span style={{ color: PURPLE }}>■</span> Baseline
            <InfoTip label="About the baseline">
              The reference interval. The response is measured as the mean in the response interval minus the mean in
              this one, for each onset, then averaged over onsets. The interval is half-open: it includes its start
              and excludes its end.
            </InfoTip>
          </>,
          <NumField label="Baseline start (s)" value={p().baselineS[0]} def={D.baselineS[0]} bad={bad('Baseline')} onSet={set('baselineS', 0)} />,
          <NumField label="Baseline end (s)" value={p().baselineS[1]} def={D.baselineS[1]} bad={bad('Baseline')} onSet={set('baselineS', 1)} />,
        )}
        {row(
          <>
            <span style={{ color: ORANGE }}>■</span> Response
            <InfoTip label="About the response interval">
              The interval in which the neural response is measured. Half-open, like the baseline.
            </InfoTip>
          </>,
          <NumField label="Response start (s)" value={p().responseS[0]} def={D.responseS[0]} bad={bad('Response')} onSet={set('responseS', 0)} />,
          <NumField label="Response end (s)" value={p().responseS[1]} def={D.responseS[1]} bad={bad('Response')} onSet={set('responseS', 1)} />,
        )}
      </div>
      <Show when={problems().length}>
        <div class="cb-pe-err" role="alert">
          {problems().join(' ')}
        </div>
      </Show>
      <Show when={frameText(props.fs)}>{(t) => <div class="cb-muted cb-pe-small">{t()}</div>}</Show>
    </div>
  );
}
