import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { foldedTimes } from '../../lib/decoding-browser.ts';
import { exclusionFrames } from '../../lib/fold-gap.ts';
import { Fit } from '../AurocResults.tsx';
import { stripBlocks } from './logic.ts';

const H = 70;
const L = 14;
const R = 14;
const AXIS = 22;
const SPLIT_H = 34;
const COLOR = {
  training: { fill: '#bfdbfe', text: '#1e3a8a' },
  test: { fill: '#1d4ed8', text: '#ffffff' },
  gap: { fill: '#fef3c7', text: '#78350f' },
};

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
  selected: number;
  onSelect: (fold: number) => void;
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
              stroke-width={b.fold === props.selected ? 2.5 : 0.6}
              fill-opacity="0.85"
              style={{ cursor: 'pointer' }}
              tabindex="0"
              role="button"
              aria-label={`Show the split with fold ${b.fold + 1} held out`}
              aria-pressed={b.fold === props.selected}
              onClick={() => props.onSelect(b.fold)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onSelect(b.fold)}
            />
            <text
              x={(x(b.x0) + x(b.x1)) / 2}
              y={H / 2 - 4}
              text-anchor="middle"
              font-size="12"
              fill="#1e3a8a"
              pointer-events="none"
            >
              Fold {b.fold + 1}
            </text>
          </>
        )}
      </For>
      {/* the selected fold's gaps, to scale, on top of the neighboring folds */}
      <For each={props.gapApplied ? blocks().filter((b) => b.fold === props.selected) : []}>
        {(b) => (
          <>
            <rect
              x={x(b.gapBefore[0])}
              y={8}
              width={Math.max(0, x(b.gapBefore[1]) - x(b.gapBefore[0]))}
              height={H - 24}
              fill="url(#cb-dec-hatch)"
              opacity="0.9"
              pointer-events="none"
            />
            <rect
              x={x(b.gapAfter[0])}
              y={8}
              width={Math.max(0, x(b.gapAfter[1]) - x(b.gapAfter[0]))}
              height={H - 24}
              fill="url(#cb-dec-hatch)"
              opacity="0.9"
              pointer-events="none"
            />
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

/** One held-out fold as Training | Gap | Test | Gap | Training, not to scale. */
function SplitDiagram(props: {
  w: number;
  fold: number;
  k: number;
  testS: number;
  gapS: number;
}): JSX.Element {
  const parts = () => {
    const out: { kind: keyof typeof COLOR; label: string; weight: number }[] = [];
    const gap = props.gapS > 0;
    const gapLabel = `Gap ${props.gapS.toFixed(2)} s`;
    if (props.fold > 0) {
      out.push({ kind: 'training', label: 'Training', weight: 3 });
      if (gap) out.push({ kind: 'gap', label: gapLabel, weight: 1.6 });
    }
    out.push({
      kind: 'test',
      label: `Test: fold ${props.fold + 1} (${props.testS.toFixed(0)} s)`,
      weight: 3,
    });
    if (props.fold < props.k - 1) {
      if (gap) out.push({ kind: 'gap', label: gapLabel, weight: 1.6 });
      out.push({ kind: 'training', label: 'Training', weight: 3 });
    }
    const sum = out.reduce((a, p) => a + p.weight, 0);
    let at = L;
    return out.map((p) => {
      const width = (p.weight / sum) * (props.w - L - R);
      const seg = { ...p, x: at, width };
      at += width;
      return seg;
    });
  };
  return (
    <svg
      width={props.w}
      height={SPLIT_H}
      role="img"
      aria-label={parts()
        .map((p) => p.label)
        .join(', ')}
    >
      <defs>
        <pattern id="cb-dec-gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={COLOR.gap.fill} />
          <path d="M0 6 L6 0" stroke="#d97706" stroke-width="1" />
        </pattern>
      </defs>
      <For each={parts()}>
        {(p) => (
          <>
            <rect
              x={p.x}
              y={2}
              width={Math.max(1, p.width - 2)}
              height={SPLIT_H - 4}
              fill={p.kind === 'gap' ? 'url(#cb-dec-gap-hatch)' : COLOR[p.kind].fill}
              stroke={p.kind === 'gap' ? '#b45309' : '#1d4ed8'}
              stroke-width="0.6"
              rx="2"
            />
            <text
              x={p.x + p.width / 2 - 1}
              y={SPLIT_H / 2 + 4}
              text-anchor="middle"
              font-size="12"
              font-weight={p.kind === 'gap' ? 600 : 400}
              fill={COLOR[p.kind].text}
            >
              {p.label}
            </text>
          </>
        )}
      </For>
    </svg>
  );
}

/**
 * The cross-validation folds on the session timeline, cut from the frames the browser engine uses
 * (equal contiguous blocks, the framework's folds). Display only. Below it, one held-out fold as
 * Training | Gap | Test | Gap | Training. When the framework applies the training/test
 * separation, the hatched bands are the training frames it leaves out next to each test block:
 * the separation rounded up to whole frames, plus half the Bayesian test window.
 */
export function FoldStrip(props: {
  folds: number;
  gapS: number;
  /** Bayesian test window (s); 0 for logistic regression. */
  windowS: number;
  gapApplied: boolean;
}): JSX.Element {
  const folded = createMemo(() => foldedTimes());
  const valid = () =>
    !!folded() && Number.isInteger(props.folds) && folded()!.times.length >= props.folds;
  const [picked, setPicked] = createSignal<number>();
  // the middle fold by default, so both gaps show
  const selected = () => Math.min(picked() ?? Math.floor((props.folds - 1) / 2), props.folds - 1);
  /** Seconds left out on each side of a test block, as the framework counts them. */
  const excludedS = () => {
    const step = folded()!.stepS;
    return props.gapApplied
      ? exclusionFrames(Math.max(0, props.gapS), 1 / step, props.windowS) * step
      : 0;
  };
  const testS = () => {
    const b = stripBlocks(folded()!.times, folded()!.stepS, folded()!.totalS, props.folds, 0);
    const f = b[selected()];
    return (f.x1 - f.x0) * folded()!.totalS;
  };
  return (
    <div class="cb-dec-strip">
      <Show
        when={valid()}
        fallback={
          <p class="cb-muted">
            The folds are drawn once the data and settings can run (see Review).
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
                gapS={excludedS()}
                gapApplied={props.gapApplied}
                selected={selected()}
                onSelect={setPicked}
              />
            )}
          </Fit>
        </div>
        <div class="cb-dec-strip__split">
          <Fit height={SPLIT_H}>
            {(w) => (
              <SplitDiagram
                w={w}
                fold={selected()}
                k={props.folds}
                testS={testS()}
                gapS={excludedS()}
              />
            )}
          </Fit>
        </div>
        <p class="cb-muted cb-dec-strip__legend">
          Top, to scale: the folds, equal blocks of the frames the decoder uses, so a fold spans
          more time where frames are left out. Bottom, not to scale: the split with fold{' '}
          {selected() + 1} held out (select a fold above to change it). Training frames (light blue)
          train the model that decodes the test fold (dark blue).
          <Show
            when={props.gapApplied}
            fallback={
              <> The separation is not applied: training frames border each test fold directly.</>
            }
          >
            <Show
              when={excludedS() > 0}
              fallback={<> With 0 s separation, training frames border each test fold directly.</>}
            >
              {' '}
              Hatched gaps are the {excludedS().toFixed(2)} s on each side of a test fold left out
              of training; the first and last folds have one gap.
            </Show>
          </Show>
        </p>
      </Show>
    </div>
  );
}
