import { createMemo, For, type JSX } from 'solid-js';
import type { AurocData } from '../lib/auroc-run.ts';
import { frameClasses, segments, type FrameClass } from '../lib/auroc-setup.ts';
import { PlotCard } from './QcParts.tsx';

type Plan = { input: Parameters<typeof frameClasses>[1]; labels: string[] };

const FILL: Record<FrameClass, string> = {
  behavior: 'var(--accent)',
  comparison: '#d5dbe6',
  excluded: '#999',
  leftOut: '#fff',
};
let nextHatch = 1;

/** One row per tested behavior over the session, drawn from the frame sets the run uses. */
function Rows(props: { data: AurocData; plan: Plan; w: number; h: number }): JSX.Element {
  const hatch = `cb-au-hatch-${nextHatch++}`;
  const [R, T] = [10, 4];
  const left = () => Math.min(200, 16 + 7 * Math.max(4, ...props.plan.labels.map((l) => l.length)));
  const dur = () => props.data.frames / props.data.fs;
  const x = (s: number) => left() + (s / dur()) * (props.w - left() - R);
  const ROW = () =>
    Math.min(34, Math.max(16, Math.floor((props.h - T - 38) / props.plan.labels.length)));
  const axisY = () => T + props.plan.labels.length * ROW();
  const rows = createMemo(() =>
    props.plan.labels.map((_, i) =>
      segments(frameClasses(props.data.mask, props.plan.input, i), props.data.fs).filter(
        (s) => s.cls !== 'comparison',
      ),
    ),
  );
  const ticks = () => {
    const step = dur() > 600 ? 120 : dur() > 120 ? 60 : 20;
    return Array.from({ length: Math.floor(dur() / step) + 1 }, (_, i) => i * step);
  };
  return (
    <svg
      class="cb-au-tl"
      width={props.w}
      height={axisY() + 38}
      role="img"
      aria-label="Frames over the session: behavior, comparison, excluded and left out"
    >
      <defs>
        <pattern
          id={hatch}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" fill="#eee" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#888" stroke-width="1.5" />
        </pattern>
      </defs>
      <For each={props.plan.labels}>
        {(label, i) => (
          <g>
            <text
              x={left() - 8}
              y={T + i() * ROW() + ROW() / 2 + 4}
              text-anchor="end"
              font-size="12"
              fill="currentColor"
            >
              {label}
            </text>
            <rect
              x={left()}
              y={T + i() * ROW() + 3}
              width={props.w - left() - R}
              height={ROW() - 6}
              fill={FILL.comparison}
            />
            <For each={rows()[i()]}>
              {(s) => (
                <rect
                  x={x(s.start)}
                  y={T + i() * ROW() + 3}
                  width={Math.max(1, x(s.stop) - x(s.start))}
                  height={ROW() - 6}
                  fill={s.cls === 'excluded' ? `url(#${hatch})` : FILL[s.cls]}
                  stroke={s.cls === 'leftOut' ? '#bbb' : undefined}
                  stroke-width={s.cls === 'leftOut' ? 0.5 : undefined}
                />
              )}
            </For>
          </g>
        )}
      </For>
      <line x1={left()} x2={props.w - R} y1={axisY()} y2={axisY()} stroke="#999" />
      <For each={ticks()}>
        {(s) => (
          <text x={x(s)} y={axisY() + 15} text-anchor="middle" font-size="11" fill="currentColor">
            {s}
          </text>
        )}
      </For>
      <text
        x={(left() + props.w - R) / 2}
        y={axisY() + 30}
        text-anchor="middle"
        font-size="11"
        fill="currentColor"
      >
        Time (s)
      </text>
    </svg>
  );
}

const Key = (props: { cls: FrameClass; children: string }) => (
  <span class="cb-au-key">
    <i class={`cb-au-key__sw cb-au-key__sw--${props.cls}`} /> {props.children}
  </span>
);

/** The Review-stage plot: where the behavior, comparison and excluded frames fall in the session. */
export function ComparisonTimeline(props: {
  data: AurocData;
  plan: Plan;
  pair: boolean;
}): JSX.Element {
  return (
    <PlotCard
      class="cb-au-plot"
      title="Comparison timeline"
      legend={
        <>
          <Key cls="behavior">Behavior</Key>
          <Key cls="comparison">Comparison</Key>
          <Key cls="excluded">Excluded</Key>
          {props.pair && <Key cls="leftOut">Left out</Key>}
        </>
      }
      help={
        <>
          <p>
            Each row is one tested behavior, drawn over the whole recording. Colored bars are frames
            in the behavior, light gray is the comparison group, and hatched bands are frames
            excluded by frame selection. Time is in seconds.
          </p>
          <p>
            Against another behavior, white boxes with an outline are frames left out because they
            are in neither behavior or in both.
          </p>
          <p>
            The rows follow the settings: changing the behaviors, the comparison or the frame
            selection redraws them. Each row needs at least 20 frames in both groups to be tested.
          </p>
        </>
      }
    >
      {(size) => (
        <div class="cb-au-tl-box">
          <Rows data={props.data} plan={props.plan} w={size().w} h={size().h} />
        </div>
      )}
    </PlotCard>
  );
}
