// The Preprocess previews: traces, the trajectory and the behavior label rows for the preview window.

import { createEffect, createMemo, For, Match, Show, Switch, type JSX } from 'solid-js';
import type uPlot from 'uplot';
import { TracePanel } from '@calab/ui/chart';
import { smoothNeural } from '../lib/framework.ts';
import { prep } from '../lib/preprocess.ts';
import { positionOnNeural } from '../lib/prepared.ts';
import {
  filledMask,
  fs,
  labelRows,
  PLOT_TITLE,
  prepWindow,
  win,
  type PlotId,
} from '../lib/prep-view.ts';
import { cell, deconvolved, frameTimes, traceMatrix } from '../lib/store.ts';
import { PALETTE, ticks } from './BehaviorQc.tsx';
import { openHelp, PlotNote } from './PrepHelp.tsx';
import { CellPicker } from './parts.tsx';
import { PlotCard } from './QcParts.tsx';

const GRAY = '#b4bcc7';
const BLUE = '#2171b5';
const GREEN = '#2e7d32';
const ORANGE = '#e09800';

type Col = ArrayLike<number> | number | undefined;

/** The window's part of each column; missing values become gaps, a number becomes a flat line. */
function windowData(cols: Col[]): [number[], ...number[][]] {
  const w = win()!;
  const cut = (c: Col) =>
    Array.from({ length: w.hi - w.lo }, (_, i) => {
      const v = typeof c === 'number' ? c : c?.[w.lo + i];
      return v !== undefined && Number.isFinite(v) ? v : null;
    }) as unknown as number[];
  return [w.t, ...cols.map(cut)];
}

function Trace(props: { cols: () => Col[]; series: uPlot.Series[]; h: number }): JSX.Element {
  return (
    <Show when={win()}>
      <TracePanel
        data={() => windowData(props.cols())}
        series={[{}, ...props.series]}
        height={props.h}
        syncKey="cabana-prep"
        xLabel="Time (s)"
      />
    </Show>
  );
}

const Key = (props: { color: string; dash?: boolean; children: JSX.Element }): JSX.Element => (
  <>
    <span
      class="cb-key"
      style={
        props.dash
          ? { background: 'none', 'border-top': `2px dashed ${props.color}`, height: '0' }
          : { background: props.color }
      }
    />
    {props.children}
  </>
);

/** A plot card whose "?" opens the help drawer on this plot's tab. */
function Card(props: {
  id: PlotId;
  class?: string;
  legend: JSX.Element;
  tools?: JSX.Element;
  children: (size: () => { w: number; h: number }) => JSX.Element;
}): JSX.Element {
  return (
    <PlotCard
      title={PLOT_TITLE[props.id]}
      class={props.class}
      legend={props.legend}
      tools={props.tools}
      help={<PlotNote id={props.id} />}
      onHelp={() => openHelp(props.id)}
    >
      {props.children}
    </PlotCard>
  );
}

/** x against y for the window: position before filling in gray, the filled segments in blue. */
function PathPlot(props: { w: number; h: number }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const p = positionOnNeural();
    const w = win();
    const mask = filledMask();
    const [W, H] = [props.w, props.h];
    const ctx = canvas.getContext('2d');
    if (!ctx || !p || !w || !mask || W < 80 || H < 80) return;
    const [lo, hi] = [w.lo, w.hi];
    const dpr = devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = lo; i < hi; i++) {
      for (const [x, y] of [
        [p.rx[i], p.ry[i]],
        [p.x[i], p.y[i]],
      ]) {
        if (!Number.isFinite(x + y)) continue;
        [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      }
    }
    if (!Number.isFinite(x0)) {
      ctx.fillStyle = '#57606a';
      ctx.fillText('No position in this window', W / 2, H / 2);
      return;
    }
    const [L, B, T, R] = [48, 36, 8, 12];
    const s = Math.min((W - L - R) / Math.max(x1 - x0, 1), (H - T - B) / Math.max(y1 - y0, 1));
    const [pw, ph] = [Math.max(x1 - x0, 1) * s, Math.max(y1 - y0, 1) * s];
    const ox = L + (W - L - R - pw) / 2;
    const oy = T + (H - T - B - ph) / 2;
    const px = (v: number) => ox + (v - x0) * s;
    const py = (v: number) => oy + ph - (v - y0) * s;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(ox, oy, pw, ph);
    ctx.strokeStyle = '#d0d7de';
    ctx.strokeRect(ox, oy, pw, ph);
    ctx.fillStyle = '#57606a';
    for (const v of ticks(x0, x0 + pw / s)) ctx.fillText(String(v), px(v), oy + ph + 14);
    ctx.fillText('x (cm)', ox + pw / 2, oy + ph + 30);
    ctx.textAlign = 'right';
    for (const v of ticks(y0, y0 + ph / s, 4)) ctx.fillText(String(v), ox - 6, py(v) + 4);
    ctx.save();
    ctx.translate(12, oy + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('y (cm)', 0, 0);
    ctx.restore();
    const draw = (
      color: string,
      width: number,
      use: (i: number) => boolean,
      X: ArrayLike<number>,
      Y: ArrayLike<number>,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = lo + 1; i < hi; i++) {
        if (!use(i) || !Number.isFinite(X[i - 1] + Y[i - 1]) || !Number.isFinite(X[i] + Y[i]))
          continue;
        ctx.moveTo(px(X[i - 1]), py(Y[i - 1]));
        ctx.lineTo(px(X[i]), py(Y[i]));
      }
      ctx.stroke();
    };
    draw(GRAY, 1.5, () => true, p.rx, p.ry);
    draw(BLUE, 2.5, (i) => !!(mask[i] && mask[i - 1]), p.x, p.y);
  });
  return <canvas ref={canvas} style={{ width: `${props.w}px`, height: `${props.h}px` }} />;
}

/** One row per behavior (two with padding: as scored, then as frame labels). */
function LabelRows(props: { padded: boolean }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  const ROW = 18;
  createEffect(() => {
    const t = frameTimes();
    const ctx = canvas.getContext('2d');
    if (!ctx || !t) return;
    const W = 1200;
    const [a, b] = prepWindow();
    const per = props.padded ? 2 : 1;
    canvas.height = labelRows().length * per * ROW + 4;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, canvas.height);
    const w = win()!;
    const bar = Math.max(W / Math.max(w.hi - w.lo, 1), 1);
    labelRows().forEach((r, k) => {
      ctx.fillStyle = PALETTE[k % PALETTE.length];
      for (let i = w.lo; i < w.hi; i++) {
        const x = ((t[i] - a) / (b - a)) * W;
        if (r.asScored[i]) ctx.fillRect(x, k * per * ROW + 2, bar, ROW - 3);
        if (props.padded && r.padded[i]) ctx.fillRect(x, k * per * ROW + ROW + 1, bar, ROW - 3);
      }
    });
  });
  return (
    <div class="cb-prep-labels">
      <canvas ref={canvas} width={1200} />
      <div class="cb-muted cb-prep-labels__axis">
        <span>{prepWindow()[0].toFixed(0)} s</span>
        <span>{prepWindow()[1].toFixed(0)} s</span>
      </div>
    </div>
  );
}

export function PrepPlots(props: { step: string }): JSX.Element {
  const row = (m: ReturnType<typeof deconvolved>) =>
    m ? m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames) : undefined;
  const events = createMemo(() => row(deconvolved()));
  const smoothed = createMemo(() => {
    const r = events();
    return r ? smoothNeural(r, fs(), prep.eventSigmaS) : undefined;
  });
  const p = positionOnNeural;
  const filled = () => {
    const m = filledMask();
    const q = p();
    return m && q ? Float64Array.from(q.x, (v, i) => (m[i] ? v : NaN)) : undefined;
  };
  const speedKey = (
    <>
      <Key color={GRAY}>Before</Key>
      <Key color={GREEN}>After</Key>
    </>
  );
  return (
    <Switch>
      <Match when={props.step === 'eventSmooth'}>
        <Card
          id="events"
          legend={
            <>
              <Key color={GRAY}>Before</Key>
              <Key color={ORANGE}>After</Key>
            </>
          }
          tools={<CellPicker compact n={traceMatrix()?.cells ?? deconvolved()?.cells ?? 0} />}
        >
          {(s) => (
            <Trace
              h={s().h}
              cols={() => [events(), smoothed()]}
              series={[
                { label: 'Before', stroke: GRAY, width: 1 },
                { label: 'After', stroke: ORANGE, width: 1.5 },
              ]}
            />
          )}
        </Card>
      </Match>
      <Match when={props.step === 'fillGaps'}>
        <div class="cb-prep__plots cb-prep__plots--row">
          <Card
            id="fillPos"
            class="cb-plot--grow3"
            legend={
              <>
                <Key color={GRAY}>Without this step</Key>
                <Key color={BLUE} dash>
                  Filled
                </Key>
              </>
            }
          >
            {(s) => (
              <Trace
                h={s().h}
                cols={() => [p()?.rx, filled()]}
                series={[
                  { label: 'Without this step', stroke: GRAY, width: 1.5 },
                  { label: 'Filled', stroke: BLUE, width: 2, dash: [4, 3] },
                ]}
              />
            )}
          </Card>
          <Card
            id="traj"
            class="cb-plot--grow2"
            legend={
              <>
                <Key color={GRAY}>Without this step</Key>
                <Key color={BLUE}>Filled</Key>
              </>
            }
          >
            {(s) => <PathPlot w={s().w} h={s().h} />}
          </Card>
        </div>
      </Match>
      <Match when={props.step === 'posSmooth'}>
        <Card
          id="smoothPos"
          legend={
            <>
              <Key color={GRAY}>Before</Key>
              <Key color={BLUE}>After</Key>
            </>
          }
        >
          {(s) => (
            <Trace
              h={s().h}
              cols={() => [p()?.x, p()?.sx]}
              series={[
                { label: 'Before', stroke: GRAY, width: 1 },
                { label: 'After', stroke: BLUE, width: 1.5 },
              ]}
            />
          )}
        </Card>
        <Card id="smoothSpeed" legend={speedKey}>
          {(s) => (
            <Trace
              h={s().h}
              cols={() => [p()?.speedBefore, p()?.speedAfter]}
              series={[
                { label: 'Before', stroke: GRAY, width: 1 },
                { label: 'After', stroke: GREEN, width: 1.5 },
              ]}
            />
          )}
        </Card>
      </Match>
      <Match when={props.step === 'boutPad' || props.step === 'boutLabels'}>
        <Card
          id="labels"
          legend={
            <>
              <For each={labelRows()}>
                {(r, i) => <Key color={PALETTE[i() % PALETTE.length]}>{r.label}</Key>}
              </For>
              <Show when={props.step === 'boutPad'}>
                <span class="cb-muted">top row as scored, bottom row as frame labels</span>
              </Show>
            </>
          }
        >
          {() => (
            <div class="cb-plot__scroll cb-prep-labels__scroll">
              <LabelRows padded={props.step === 'boutPad'} />
            </div>
          )}
        </Card>
      </Match>
      <Match when={props.step === 'positionOnFrames'}>
        <Card id="onFrames" legend={<Key color={BLUE}>x position</Key>}>
          {(s) => (
            <Trace
              h={s().h}
              cols={() => [p()?.rx]}
              series={[{ label: 'x position', stroke: BLUE, width: 1.5 }]}
            />
          )}
        </Card>
      </Match>
      <Match when={props.step === 'speed'}>
        <Card
          id="speed"
          legend={
            <>
              <Key color={GREEN}>Speed</Key>
              <Show when={prep.minSpeed > 0}>
                <Key color="#d32f2f" dash>
                  Shared speed filter ({prep.minSpeed} cm/s)
                </Key>
              </Show>
            </>
          }
        >
          {(s) => (
            <Trace
              h={s().h}
              cols={() => [p()?.speedAfter, ...(prep.minSpeed > 0 ? [prep.minSpeed] : [])]}
              series={[
                { label: 'Speed', stroke: GREEN, width: 1.5 },
                ...(prep.minSpeed > 0
                  ? [{ label: 'Speed filter', stroke: '#d32f2f', width: 1, dash: [5, 4] }]
                  : []),
              ]}
            />
          )}
        </Card>
      </Match>
    </Switch>
  );
}
