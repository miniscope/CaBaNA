import { For, Show, type JSX } from 'solid-js';
import { frameTimes, samplingRate } from '../../lib/store.ts';
import { Fit } from '../AurocResults.tsx';
import { stripBlocks } from './logic.ts';

const H = 70;
const L = 14;
const R = 14;
const AXIS = 22;

/** Round tick spacing in seconds that gives about six ticks. */
export function tickStep(total: number): number {
  const raw = total / 6;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

function Strip(props: { w: number; n: number; k: number; fs: number; gapS: number }): JSX.Element {
  const total = () => props.n / props.fs;
  const x = (frac: number) => L + frac * (props.w - L - R);
  const blocks = () => stripBlocks(props.n, props.k, props.fs, props.gapS);
  const ticks = () => {
    const step = tickStep(total());
    return Array.from({ length: Math.floor(total() / step) + 1 }, (_, i) => i * step);
  };
  return (
    <svg
      width={props.w}
      height={H + AXIS}
      role="img"
      aria-label={`${props.k} test folds across ${total().toFixed(0)} seconds`}
    >
      <defs>
        <pattern id="cb-dec-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6 L6 0" stroke="#b45309" stroke-width="1.2" />
        </pattern>
      </defs>
      <For each={blocks()}>
        {(b) => (
          <>
            <rect
              x={x(b.gapBefore[0])}
              y={8}
              width={Math.max(0, x(b.gapBefore[1]) - x(b.gapBefore[0]))}
              height={H - 24}
              fill="url(#cb-dec-hatch)"
              opacity="0.7"
            />
            <rect
              x={x(b.gapAfter[0])}
              y={8}
              width={Math.max(0, x(b.gapAfter[1]) - x(b.gapAfter[0]))}
              height={H - 24}
              fill="url(#cb-dec-hatch)"
              opacity="0.7"
            />
          </>
        )}
      </For>
      <For each={blocks()}>
        {(b) => (
          <>
            <rect
              x={x(b.x0)}
              y={8}
              width={Math.max(1, x(b.x1) - x(b.x0) - 1)}
              height={H - 24}
              fill={b.fold % 2 ? '#93c5fd' : '#60a5fa'}
              stroke="#1d4ed8"
              stroke-width="0.6"
              fill-opacity="0.85"
            />
            <text
              x={(x(b.x0) + x(b.x1)) / 2}
              y={H / 2 - 4}
              text-anchor="middle"
              font-size="12"
              fill="#1e3a8a"
            >
              Fold {b.fold + 1}
            </text>
          </>
        )}
      </For>
      <line x1={L} x2={props.w - R} y1={H - 4} y2={H - 4} stroke="#64748b" />
      <For each={ticks()}>
        {(t) => (
          <>
            <line x1={x(t / total())} x2={x(t / total())} y1={H - 4} y2={H} stroke="#64748b" />
            <text x={x(t / total())} y={H + 12} text-anchor="middle" font-size="11" fill="#475569">
              {t}
            </text>
          </>
        )}
      </For>
      <text x={props.w - R} y={H + 22} text-anchor="end" font-size="11" fill="#475569">
        Time in the session (s)
      </text>
    </svg>
  );
}

/**
 * The cross-validation folds on the session timeline. Display only: the framework makes the folds
 * (equal contiguous blocks). Hatched bands are the frames next to each test fold that the fold gap
 * leaves out of training.
 */
export function FoldStrip(props: {
  folds: number;
  gapS: number;
  gapApplied: boolean;
}): JSX.Element {
  const n = () => frameTimes()?.length ?? 0;
  const fs = () => samplingRate() ?? 0;
  const valid = () => n() > 0 && fs() > 0 && Number.isInteger(props.folds) && props.folds >= 2;
  return (
    <div class="cb-dec-strip">
      <Show
        when={valid()}
        fallback={
          <p class="cb-muted">Load neural timestamps and set at least 2 folds to see the folds.</p>
        }
      >
        <div class="cb-dec-strip__plot">
          <Fit height={H + AXIS}>
            {(w) => (
              <Strip w={w} n={n()} k={props.folds} fs={fs()} gapS={Math.max(0, props.gapS)} />
            )}
          </Fit>
        </div>
        <p class="cb-muted cb-dec-strip__legend">
          Blue blocks are the test folds, each decoded by a model trained on the other folds.
          Hatched bands are the {props.gapS} s of frames next to each test fold that are left out of
          training.
          <Show when={!props.gapApplied}> The installed framework does not apply the gap yet.</Show>
        </p>
      </Show>
    </div>
  );
}
