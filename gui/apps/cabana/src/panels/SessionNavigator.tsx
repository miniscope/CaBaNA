import { createEffect, type JSX } from 'solid-js';
import { cell } from '../lib/store.ts';
import { mss, setWinLen, setWinStartClamped, span, win } from '../lib/viz.ts';
import { matrixOf, neuralT, sources } from '../lib/viz-tracks.ts';
import { drawSeries } from './SessionView.tsx';

const MIN_LEN = 1;

/** The whole session as a strip with a box for the window. Drag the box to move it, its edges to resize it. */
export function SessionNavigator(): JSX.Element {
  let strip!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  const T = () => span()[1] - span()[0];
  const pct = (t: number) => `${((t - span()[0]) / T()) * 100}%`;

  // The selected cell over the whole session, for context.
  createEffect(() => {
    const ctx = canvas.getContext('2d');
    const m = sources()[0] && matrixOf(sources()[0]);
    const t = neuralT();
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    if (ctx && m && t)
      drawSeries(
        ctx,
        canvas.height,
        t,
        m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames),
        span(),
        '#9aa5b3',
      );
  });

  const drag = (mode: 'move' | 'left' | 'right') => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const [t0, t1] = span();
    const [a, b] = win();
    const per = T() / strip.getBoundingClientRect().width;
    const x0 = e.clientX;
    const min = Math.min(MIN_LEN, T());
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) * per;
      if (mode === 'move') setWinStartClamped(Math.min(Math.max(a + dt, t0), t1 - (b - a)));
      else if (mode === 'right') setWinLen(Math.min(Math.max(b + dt, a + min), t1) - a);
      else {
        const start = Math.min(Math.max(a + dt, t0), b - min);
        setWinLen(b - start);
        setWinStartClamped(start);
      }
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const step = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const len = win()[1] - win()[0];
    setWinStartClamped(Math.min(Math.max(win()[0] + (dir * len) / 4, span()[0]), span()[1] - len));
  };

  return (
    <div class="cb-nav2">
      <span class="cb-muted">{mss(span()[0])}</span>
      <div
        class="cb-nav2__strip"
        ref={strip}
        onPointerDown={(e) => {
          const r = strip.getBoundingClientRect();
          const len = win()[1] - win()[0];
          const c = span()[0] + ((e.clientX - r.left) / r.width) * T();
          setWinStartClamped(Math.min(Math.max(c - len / 2, span()[0]), span()[1] - len));
        }}
      >
        <canvas ref={canvas} width={1200} height={40} />
        <div
          class="cb-nav2__box"
          tabindex="0"
          role="slider"
          aria-label="Window start, in seconds"
          aria-valuemin={span()[0]}
          aria-valuemax={span()[1] - (win()[1] - win()[0])}
          aria-valuenow={win()[0]}
          aria-valuetext={`${mss(win()[0])} to ${mss(win()[1])}`}
          style={{ left: pct(win()[0]), width: `${((win()[1] - win()[0]) / T()) * 100}%` }}
          onPointerDown={drag('move')}
          onKeyDown={step}
        >
          <span class="cb-nav2__edge cb-nav2__edge--l" onPointerDown={drag('left')} />
          <span class="cb-nav2__edge cb-nav2__edge--r" onPointerDown={drag('right')} />
        </div>
      </div>
      <span class="cb-muted">{mss(span()[1])}</span>
    </div>
  );
}
