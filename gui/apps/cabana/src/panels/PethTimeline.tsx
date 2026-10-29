// The session timeline of the PETH setup page: each behavior's bouts, with a circle at every onset
// (filled when included, open when excluded by the settings above).

import { For, type JSX } from 'solid-js';
import type { OnsetReport } from '../lib/peth.ts';
import type { PethData } from '../lib/peth-run.ts';
import { pethSettings } from '../lib/peth-run.ts';
import { boutTimeline } from '../lib/peth-view.ts';
import { colorOf } from './PethShared.tsx';

export function PethTimeline(props: {
  data: PethData;
  reports: OnsetReport[] | undefined;
  /** Behaviors with too few onsets are drawn gray. */
  ready: (b: number) => boolean;
  w: number;
  h: number;
}): JSX.Element {
  const [R, T] = [10, 6];
  const d = () => props.data;
  const n = () => d().labels.length;
  const L = Math.min(200, 16 + 7 * Math.max(...d().labels.map((l) => l.length)));
  const ROW = () => Math.min(34, Math.max(18, Math.floor((props.h - T - 36) / n())));
  const H = () => Math.max(props.h, T + n() * ROW() + 36);
  const dur = () => d().frames / d().fs;
  const mins = () => dur() > 300;
  const x = (s: number) => L + (s / dur()) * (props.w - L - R);
  const step = () => {
    const unit = mins() ? 60 : 1;
    const span = dur() / unit;
    return unit * ([1, 2, 5, 10, 20, 30, 60, 120].find((v) => span / v <= 8) ?? 240);
  };
  const ticks = () => Array.from({ length: Math.floor(dur() / step()) + 1 }, (_, i) => i * step());
  const axisY = () => T + n() * ROW();
  const rows = () => d().labels.map((_, b) => boutTimeline(d(), b, props.reports?.[b], pethSettings.align === 'offset' ? 'offset' : 'onset'));
  return (
    <svg
      class="cb-auroc-timeline"
      style={{ width: `${props.w}px`, height: `${H()}px` }}
      viewBox={`0 0 ${props.w} ${H()}`}
      role="img"
      aria-label="Behavior bouts over the session, with a circle at each onset: filled if included, open if excluded"
    >
      <For each={d().labels}>
        {(label, bi) => {
          const b = bi();
          const gray = () => !props.ready(b);
          const y = () => T + b * ROW() + ROW() / 2;
          return (
            <g opacity={gray() ? 0.6 : 1}>
              <text x={L - 8} y={y() + 4} text-anchor="end" font-size="12" fill="currentColor">
                {label}
              </text>
              <line x1={L} x2={props.w - R} y1={y() + 4} y2={y() + 4} stroke="#eaeef2" />
              <For each={rows()[b]}>
                {(e) => (
                  <>
                    <rect
                      x={x(e.startS)}
                      y={y() + 1}
                      width={Math.max(2, x(e.startS + e.lengthS) - x(e.startS))}
                      height={6}
                      fill={gray() ? '#d0d7de' : '#b6d4f5'}
                    />
                    <circle
                      cx={x(e.markS)}
                      cy={y() - 5}
                      r={3}
                      fill={e.included ? (gray() ? '#999' : colorOf(label)) : '#fff'}
                      stroke={e.included ? 'none' : '#cf222e'}
                      stroke-width="1.2"
                    />
                  </>
                )}
              </For>
            </g>
          );
        }}
      </For>
      <line x1={L} x2={props.w - R} y1={axisY() + 6} y2={axisY() + 6} stroke="#999" />
      <For each={ticks()}>
        {(s) => (
          <text x={x(s)} y={axisY() + 20} text-anchor="middle" font-size="11" fill="currentColor">
            {mins() ? s / 60 : s}
          </text>
        )}
      </For>
      <text x={(L + props.w - R) / 2} y={axisY() + 33} text-anchor="middle" font-size="11" fill="currentColor">
        Time in session ({mins() ? 'min' : 's'})
      </text>
    </svg>
  );
}

