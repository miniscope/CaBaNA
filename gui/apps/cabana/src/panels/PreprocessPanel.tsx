import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { TracePanel } from '@calab/ui/chart';
import { arena, binStats, effectiveBin, setArena } from '../lib/arena.ts';
import { boutFrames, dilateMask, lowerBound, smoothNeural } from '../lib/framework.ts';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { positionOnNeural, trackedPosition } from '../lib/prepared.ts';
import { preprocessYaml } from '../lib/session-config.ts';
import {
  annotationLog,
  annotationResults,
  cell,
  deconvolved,
  denoisedTrace,
  frameTimes,
  positionLog,
  rawTrace,
  rejected,
  samplingRate,
  traceMatrix,
} from '../lib/store.ts';
import { span } from '../lib/viz.ts';
import { CellPicker, Note } from './parts.tsx';
import { PALETTE } from './BehaviorQc.tsx';

type Key = Exclude<keyof typeof DEFAULT_PREP, 'posMethod'>;
const PREVIEW_S = 20;

/** One setting: a number box with its unit and default. */
function Field(props: { k: Key; label: string; unit: string; step: number }): JSX.Element {
  return (
    <label
      class="cb-prep-field"
      classList={{ 'cb-prep-field--changed': prep[props.k] !== DEFAULT_PREP[props.k] }}
    >
      {props.label}
      <input
        type="number"
        min="0"
        step={props.step}
        value={prep[props.k]}
        onInput={(e) => setPrep(props.k, Math.max(0, +e.currentTarget.value || 0))}
      />
      {props.unit}
      <span class="cb-muted"> default {DEFAULT_PREP[props.k]}</span>
    </label>
  );
}

const fillArray = (a: ArrayLike<number>, lo: number, hi: number) =>
  Array.from(a as ArrayLike<number> & number[], (v) => v).slice(lo, hi);

export function PreprocessPanel(): JSX.Element {
  const [start, setStart] = createSignal(0);
  const t0 = () => span()[0];
  const winStart = () => Math.min(Math.max(start(), t0()), Math.max(t0(), span()[1] - PREVIEW_S));
  const window = (): [number, number] => [winStart(), winStart() + PREVIEW_S];
  const fs = () => samplingRate() ?? 30;

  // ---- neural signals
  const row = (m: ReturnType<typeof rawTrace>) =>
    m ? m.data.subarray(cell() * m.frames, (cell() + 1) * m.frames) : undefined;
  const trace = () => denoisedTrace() ?? rawTrace();
  const eventsSmooth = createMemo(() => {
    const r = row(deconvolved());
    return r ? smoothNeural(r, fs(), prep.eventSigmaS) : undefined;
  });
  const traceSmooth = createMemo(() => {
    const r = row(trace());
    return r ? smoothNeural(r, fs(), prep.traceSigmaS) : undefined;
  });
  const neuralWindow = () => {
    const t = frameTimes();
    if (!t) return undefined;
    const [a, b] = window();
    return {
      t: Array.from(t.slice(lowerBound(t, a), lowerBound(t, b))),
      lo: lowerBound(t, a),
      hi: lowerBound(t, b),
    };
  };

  // ---- position
  const pos = trackedPosition;
  const onNeural = positionOnNeural;
  /** Which neural frames are kept: position found, and with a minimum speed, speed at least that. */
  const frames = createMemo(() => {
    const p = onNeural();
    if (!p) return undefined;
    let kept = 0;
    for (let i = 0; i < p.sx.length; i++) {
      const found = Number.isFinite(p.sx[i] + p.sy[i]);
      if (found && (prep.minSpeed <= 0 || p.speedAfter[i] >= prep.minSpeed)) kept++;
    }
    return { pct: (100 * kept) / p.sx.length };
  });

  // ---- frame labels
  const epochs = createMemo(() =>
    annotationResults().flatMap((a) => (a.error ? [] : a.epochs.filter((e) => e.stop > e.start))),
  );
  const labels = createMemo(() => [...new Set(epochs().map((e) => e.label))]);
  const labelRows = createMemo(() => {
    const t = frameTimes();
    if (!t) return [];
    return labels().map((l) => {
      const bouts = epochs().filter((e) => e.label === l);
      const asScored = boutFrames(bouts, t);
      const processed = dilateMask(asScored, fs(), prep.labelPadS);
      const sum = (a: boolean[]) => a.filter(Boolean).length;
      return {
        label: l,
        bouts,
        asScored,
        processed,
        nScored: sum(asScored),
        nAfter: sum(processed),
      };
    });
  });
  let labelCanvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    const ctx = labelCanvas?.getContext('2d');
    const t = frameTimes();
    if (!labelCanvas || !ctx || !t) return;
    const W = 1200;
    const ROW = 18;
    const [a, b] = window();
    labelCanvas.height = labelRows().length * ROW * 2 + 4;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, labelCanvas.height);
    const lo = lowerBound(t, a);
    const hi = lowerBound(t, b);
    labelRows().forEach((r, k) => {
      for (let i = lo; i < hi; i++) {
        const x = ((t[i] - a) / (b - a)) * W;
        const w = Math.max(W / (hi - lo), 1);
        ctx.fillStyle = PALETTE[k % PALETTE.length];
        ctx.globalAlpha = r.asScored[i] ? 1 : 0;
        ctx.fillRect(x, k * ROW * 2 + 2, w, ROW - 3);
        ctx.globalAlpha = r.processed[i] ? 1 : 0;
        ctx.fillRect(x, k * ROW * 2 + ROW + 1, w, ROW - 3);
      }
      ctx.globalAlpha = 1;
    });
  });

  const preset = () => ({ events: !!deconvolved(), trace: !!trace() });
  const anything = () => preset().events || preset().trace || pos() || labels().length;
  const cells = () => (traceMatrix()?.cells ?? deconvolved()?.cells ?? 0) - rejected().size;

  const download = () => {
    const url = URL.createObjectURL(new Blob([preprocessYaml()], { type: 'text/yaml' }));
    Object.assign(document.createElement('a'), { href: url, download: 'preprocess.yaml' }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="cb-panel cb-panel--wide">
      <h2>Preprocess</h2>
      <p class="cb-lead">
        Choose how the data is smoothed and how behavior is turned into frame labels. Every setting
        starts at a default and updates the previews below. Nothing here is required.
      </p>
      <Show when={!anything()}>
        <div class="cb-empty">Load neural or behavior data to preview these choices.</div>
      </Show>
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => setPrep({ ...DEFAULT_PREP })}>
          Reset all to defaults
        </button>
        <label>
          Preview window starts at
          <input
            type="range"
            min={t0()}
            max={Math.max(t0(), span()[1] - PREVIEW_S)}
            step="1"
            value={winStart()}
            onInput={(e) => setStart(+e.currentTarget.value)}
          />
          {winStart().toFixed(0)} s ({PREVIEW_S} s shown)
        </label>
      </div>

      <Show when={preset().events || preset().trace}>
        <section class="cb-group">
          <h3>Neural signals</h3>
          <Note>
            Deconvolved events are sharp, often a single frame wide. Manual labels can be off by a
            frame or two, so one event can miss the frame it belongs to. Smoothing spreads each
            event over its neighbors; a larger width blurs timing more. Traces rarely need
            smoothing, since it hides fast changes. 0 s leaves a signal as it is.
          </Note>
          <CellPicker n={cells() + rejected().size} />
          <div class="cb-controls">
            <Show when={preset().events}>
              <Field k="eventSigmaS" label="Smooth events" unit="s" step={0.05} />
            </Show>
            <Show when={preset().trace}>
              <Field k="traceSigmaS" label="Smooth traces" unit="s" step={0.05} />
            </Show>
          </div>
          <Show when={neuralWindow()}>
            <For
              each={[
                {
                  show: preset().events,
                  label: 'Deconvolved events',
                  color: '#e09800',
                  before: () => row(deconvolved()),
                  after: eventsSmooth,
                },
                {
                  show: preset().trace,
                  label: denoisedTrace() ? 'Denoised trace' : 'Raw fluorescence',
                  color: '#2171b5',
                  before: () => row(trace()),
                  after: traceSmooth,
                },
              ]}
            >
              {(p) => (
                <Show when={p.show && p.before() && p.after()}>
                  <div class="cb-label">
                    <i style={{ background: p.color }} />
                    Cell {cell() + 1}: {p.label}, before (gray) and after (color) smoothing
                  </div>
                  <TracePanel
                    data={() =>
                      [
                        neuralWindow()!.t,
                        fillArray(p.before()!, neuralWindow()!.lo, neuralWindow()!.hi),
                        fillArray(p.after()!, neuralWindow()!.lo, neuralWindow()!.hi),
                      ] as [number[], ...number[][]]
                    }
                    series={[
                      {},
                      { label: 'Before', stroke: '#b4bcc7', width: 1 },
                      { label: 'After', stroke: p.color, width: 1.5 },
                    ]}
                    height={100}
                    syncKey="cabana-prep"
                    xLabel="Time (s)"
                  />
                </Show>
              )}
            </For>
          </Show>
        </section>
      </Show>

      <Show when={pos()}>
        <section class="cb-group">
          <h3>Position</h3>
          <Note>
            Tracking jitter makes a still animal look like it is moving, which inflates speed. A
            median window removes jumps and keeps sharp turns; a Gaussian window blurs them.
            Position is first placed on the miniscope frames (lost stretches over 0.5 s stay lost),
            then smoothed, then speed is taken over the speed window. Place cell analyses often
            leave out frames when the animal is nearly still, because firing then may reflect rest
            rather than place. Typical thresholds are a few cm/s. The minimum speed here is the one
            place cell and auROC analyses use. A window or threshold of 0 leaves that step out.
          </Note>
          <div class="cb-controls">
            <label>
              Smooth position with
              <select
                value={prep.posMethod}
                onChange={(e) =>
                  setPrep('posMethod', e.currentTarget.value as 'median' | 'gaussian')
                }
              >
                <option value="median">a median</option>
                <option value="gaussian">a Gaussian</option>
              </select>
            </label>
            <Field k="posWindowS" label="window of" unit="s" step={0.05} />
            <Field k="speedWindowS" label="Speed window" unit="s" step={0.05} />
            <Field k="minSpeed" label="Leave out frames slower than" unit="cm/s" step={0.5} />
          </div>
          <Show when={frames()}>
            <div class="cb-muted">
              {frames()!.pct.toFixed(1)}% of the neural frames are kept (position found
              {prep.minSpeed > 0 ? `, speed at least ${prep.minSpeed} cm/s` : ''}).
            </div>
          </Show>
          <Show when={neuralWindow() && onNeural()}>
            <div class="cb-label">
              <i style={{ background: '#2171b5' }} />
              Position x (cm), before (gray) and after (blue) smoothing
            </div>
            <TracePanel
              data={() =>
                [
                  neuralWindow()!.t,
                  fillArray(onNeural()!.x, neuralWindow()!.lo, neuralWindow()!.hi),
                  fillArray(onNeural()!.sx, neuralWindow()!.lo, neuralWindow()!.hi),
                ] as [number[], ...number[][]]
              }
              series={[
                {},
                { label: 'Before', stroke: '#b4bcc7', width: 1 },
                { label: 'After', stroke: '#2171b5', width: 1.5 },
              ]}
              height={100}
              syncKey="cabana-prep"
              xLabel="Time (s)"
            />
            <div class="cb-label">
              <i style={{ background: '#2e7d32' }} />
              Speed (cm/s), before (gray) and after (green) smoothing
            </div>
            <TracePanel
              data={() =>
                [
                  neuralWindow()!.t,
                  fillArray(onNeural()!.speedBefore, neuralWindow()!.lo, neuralWindow()!.hi),
                  fillArray(onNeural()!.speedAfter, neuralWindow()!.lo, neuralWindow()!.hi),
                ] as [number[], ...number[][]]
              }
              series={[
                {},
                { label: 'Before', stroke: '#b4bcc7', width: 1 },
                { label: 'After', stroke: '#2e7d32', width: 1.5 },
              ]}
              height={100}
              syncKey="cabana-prep"
              xLabel="Time (s)"
            />
          </Show>
        </section>
      </Show>

      <Show when={labels().length && frameTimes()}>
        <section class="cb-group">
          <h3>Frame labels</h3>
          <Note>
            Scored bouts become one label per neural frame: a frame is in a bout from the first
            frame at or after its start up to the frame before its stop. A bout can start or end a
            frame or two off, so widening each bout makes the labels more forgiving. Larger values
            blur the bout edges. The default is 0.
          </Note>
          <div class="cb-controls">
            <Field k="labelPadS" label="Widen each bout by" unit="s each side" step={0.05} />
          </div>
          <div class="cb-label">
            For each behavior: as scored (top row) and as frame labels (bottom row)
          </div>
          <div class="cb-legend">
            <For each={labels()}>
              {(l, i) => (
                <span class="cb-legend__item">
                  <i style={{ background: PALETTE[i() % PALETTE.length] }} />
                  {l}
                </span>
              )}
            </For>
          </div>
          <canvas
            ref={labelCanvas}
            width={1200}
            class="cb-sess__canvas"
            style={{ height: `${labelRows().length * 36 + 4}px` }}
          />
          <table class="cb-stats">
            <thead>
              <tr>
                <th>Behavior</th>
                <th>Frames as scored</th>
                <th>Frames as labels</th>
                <th>Share of session</th>
              </tr>
            </thead>
            <tbody>
              <For each={labelRows()}>
                {(r) => (
                  <tr>
                    <td>{r.label}</td>
                    <td>{r.nScored}</td>
                    <td>{r.nAfter.toFixed(0)}</td>
                    <td>{((100 * r.nAfter) / (frameTimes()?.length || 1)).toFixed(1)}%</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>

      <section class="cb-group">
        <h3>Place map bins</h3>
        <Note>
          Place maps count how long the animal spends, and what the cell does, in each square bin.
          Small bins show detail, but each holds little data and is noisy. Large bins are smoother
          but blur the fields. Studies most often use 2 to 5 cm. Draw the arena and set its scale in
          Experimental Setup first. Tick Show place map bins there to see them on the picture.
        </Note>
        <div class="cb-controls">
          <label>
            Bin size
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={effectiveBin()}
              onInput={(e) => setArena('binCm', Math.max(0.5, +e.currentTarget.value || 0.5))}
            />{' '}
            cm
          </label>
          <label>
            Minimum time in a bin
            <input
              type="number"
              min="0"
              step="0.05"
              value={arena.minOccupancy}
              onInput={(e) => setArena('minOccupancy', Math.max(0, +e.currentTarget.value || 0))}
            />{' '}
            s
          </label>
        </div>
        <div class="cb-muted">
          Bins left out of the maps are those visited for less than the minimum time. 0.05 s is the
          default in the Miniscope place cell guide.
        </div>
        <Show
          when={binStats()}
          fallback={<div class="cb-note">Bins appear once the arena is drawn and scaled.</div>}
        >
          <div class="cb-muted">
            {binStats()!.n} bins, {binStats()!.open} open.
            <Show
              when={binStats()!.underPct !== undefined}
              fallback=" Load position to see the time in each bin."
            >
              {' '}
              Median {binStats()!.median!.toFixed(2)} s per bin;{' '}
              {(100 - binStats()!.underPct!).toFixed(0)}% reach the minimum.
            </Show>
          </div>
          <Show when={(binStats()?.underPct ?? 0) > 20}>
            <div class="cb-note">
              {binStats()!.underPct!.toFixed(0)}% of the open bins get less than{' '}
              {arena.minOccupancy} s. When many bins are visited that briefly, the bins are probably
              too small, or the animal covers little of the arena.
            </div>
          </Show>
        </Show>
      </section>

      <section class="cb-group">
        <h3>What goes forward</h3>
        <ul class="cb-help">
          <li>
            Cells: {cells()} kept{rejected().size ? `, ${rejected().size} rejected in Data QC` : ''}
            .
          </li>
          <Show when={positionLog().length}>
            <For each={positionLog()}>{(m) => <li>Position: {m}</li>}</For>
          </Show>
          <Show when={annotationLog().length}>
            <For each={annotationLog()}>{(m) => <li>Annotations: {m}</li>}</For>
          </Show>
          <Show when={frames()}>
            <li>
              Frames: {frames()!.pct.toFixed(1)}% of neural frames have a position and pass the
              speed filter.
            </li>
          </Show>
        </ul>
        <button class="btn-secondary btn-small" onClick={download}>
          Download settings as preprocess.yaml
        </button>
      </section>
    </div>
  );
}
