import { createMemo, For, Show, type JSX } from 'solid-js';
import { foldedTimes } from '../../lib/decoding-browser.ts';
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

function Strip(props: {
  w: number;
  folded: { times: number[]; stepS: number; totalS: number };
  k: number;
  gapS: number;
  gapApplied: boolean;
}): JSX.Element {
  const total = () => props.folded.totalS;
  const x = (frac: number) => L + frac * (props.w - L - R);
  const blocks = () =>
    stripBlocks(props.folded.times, props.folded.stepS, total(), props.k, props.gapS);
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
      <For each={props.gapApplied ? blocks() : []}>
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
 * The cross-validation folds on the session timeline, cut from the frames the browser engine uses
 * (equal contiguous blocks). Display only. Hatched bands, drawn only when an engine applies the
 * fold gap, are the frames next to each test fold left out of training.
 */
export function FoldStrip(props: {
  folds: number;
  gapS: number;
  gapApplied: boolean;
}): JSX.Element {
  const folded = createMemo(() => foldedTimes());
  const valid = () =>
    !!folded() && Number.isInteger(props.folds) && folded()!.times.length >= props.folds;
  return (
    <div class="cb-dec-strip">
      <Show
        when={valid()}
        fallback={
          <p class="cb-muted">
            The folds are drawn once the data and settings can run (see Checks).
          </p>
        }
      >
        <div class="cb-dec-strip__plot">
          <Fit height={H + AXIS}>
            {(w) => (
              <Strip
                w={w}
                folded={folded()!}
                k={props.folds}
                gapS={Math.max(0, props.gapS)}
                gapApplied={props.gapApplied}
              />
            )}
          </Fit>
        </div>
        <p class="cb-muted cb-dec-strip__legend">
          Blue blocks are the test folds, each decoded by a model trained on the other folds. They
          are equal blocks of the frames the decoder uses, so a fold spans more time where frames
          are left out.
          <Show
            when={props.gapApplied}
            fallback={
              <> The fold gap is not applied: training frames border each test fold directly.</>
            }
          >
            {' '}
            Hatched bands are the {props.gapS} s of frames next to each test fold that are left out
            of training.
          </Show>
        </p>
      </Show>
    </div>
  );
}
