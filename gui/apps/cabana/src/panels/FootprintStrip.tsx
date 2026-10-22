import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { PlaceOutcome } from '../lib/place-run.ts';
import { deconvolved, denoisedTrace, footprints, rawTrace } from '../lib/store.ts';

const TRACES = [
  { key: 'denoised', label: 'Denoised trace', color: '#2171b5', get: denoisedTrace },
  { key: 'raw', label: 'Raw fluorescence', color: '#6b7a8c', get: rawTrace },
  { key: 'events', label: 'Deconvolved events', color: '#b87400', get: deconvolved },
] as const;

/** One cell's footprint, each pixel as a share of the cell's own peak. */
export function Footprint(props: { cellRow: number; width: number }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const f = () => {
    const fp = footprints();
    return fp && props.cellRow < fp.cells ? fp : undefined;
  };
  createEffect(() => {
    const fp = f();
    const ctx = canvas?.getContext('2d');
    if (!fp || !canvas || !ctx) return;
    const px = fp.height * fp.width;
    const own = fp.data.subarray(props.cellRow * px, (props.cellRow + 1) * px);
    let peak = 0;
    for (const v of own) if (v > peak) peak = v;
    canvas.width = fp.width;
    canvas.height = fp.height;
    const img = ctx.createImageData(fp.width, fp.height);
    for (let i = 0; i < px; i++) {
      const g = peak > 0 ? Math.round(255 * Math.max(0, own[i] / peak)) : 0;
      img.data.set([g, g, g, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  });
  return (
    <Show
      when={f()}
      fallback={
        <div class="cb-fp cb-fp--none" style={{ width: `${props.width}px` }} title="No footprint">
          –
        </div>
      }
    >
      {(fp) => (
        <canvas
          ref={canvas}
          class="cb-fp"
          style={{ width: `${props.width}px`, 'aspect-ratio': `${fp().width} / ${fp().height}` }}
          role="img"
          aria-label={`Footprint of cell ${props.cellRow + 1}`}
        />
      )}
    </Show>
  );
}

/**
 * A trace over the whole recording. Each pixel column shows the lowest and highest value of the frames
 * under it. Frames the analysis left out are shaded, not changed: the trace keeps its real values there.
 */
function TraceCanvas(props: {
  values: ArrayLike<number>;
  /** Grid bin of each frame, -1 for a frame left out. Same length as `values`, or left out of the drawing. */
  labels?: ArrayLike<number>;
  color: string;
  height: number;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const [width, setWidth] = createSignal(0);
  createEffect(() => {
    if (!canvas) return;
    const ro = new ResizeObserver(() => setWidth(canvas!.clientWidth));
    ro.observe(canvas);
    setWidth(canvas.clientWidth);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    const w = width();
    if (!canvas || !ctx || w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = props.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = props.values;
    const n = v.length;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++)
      if (Number.isFinite(v[k])) {
        if (v[k] < lo) lo = v[k];
        if (v[k] > hi) hi = v[k];
      }
    if (!(hi >= lo)) return;
    const y = (x: number) => h - 2 - ((x - lo) / (hi - lo || 1)) * (h - 4);
    const labels = props.labels?.length === n ? props.labels : undefined;
    ctx.fillStyle = 'rgba(120,120,120,0.28)';
    ctx.strokeStyle = props.color;
    ctx.lineWidth = 1;
    for (let c = 0; c < w; c++) {
      const a = Math.floor((c * n) / w);
      const b = Math.max(a + 1, Math.floor(((c + 1) * n) / w));
      let mn = Infinity;
      let mx = -Infinity;
      let off = 0;
      for (let k = a; k < b && k < n; k++) {
        if (labels && labels[k] < 0) off++;
        if (Number.isFinite(v[k])) {
          if (v[k] < mn) mn = v[k];
          if (v[k] > mx) mx = v[k];
        }
      }
      if (off > 0) {
        ctx.globalAlpha = off / (b - a);
        ctx.fillRect(c, 0, 1, h);
        ctx.globalAlpha = 1;
      }
      if (mx >= mn) {
        ctx.beginPath();
        ctx.moveTo(c + 0.5, y(mn));
        ctx.lineTo(c + 0.5, Math.min(y(mn) - 1, y(mx)));
        ctx.stroke();
      }
    }
  });
  return <canvas ref={canvas} class="cb-trace" style={{ height: `${props.height}px` }} />;
}

/**
 * Under the maps: the selected cell's footprint and trace. Collapsed it is one thin strip; open it is larger
 * and lets you pick among the traces that were loaded. `i` is the cell's row in the run's results.
 */
export function FootprintStrip(props: { out: PlaceOutcome; i: number }): JSX.Element {
  const [kind, setKind] = createSignal<(typeof TRACES)[number]['key']>('denoised');
  const cellRow = () => props.out.data.cellIds[props.i];
  const frames = () => props.out.data.input.frames;
  const fs = () => props.out.data.input.fs;
  const available = createMemo(() =>
    TRACES.map((t) => ({ ...t, m: t.get() })).filter(
      (t): t is typeof t & { m: NonNullable<typeof t.m> } => !!t.m && cellRow() < t.m.cells,
    ),
  );
  const current = () => available().find((t) => t.key === kind()) ?? available()[0];
  const values = (t: ReturnType<typeof current>) =>
    t && t.m.data.subarray(cellRow() * t.m.frames, (cellRow() + 1) * t.m.frames);
  const aligned = () => current()?.m.frames === frames();
  const labels = () => (aligned() ? props.out.data.labels : undefined);
  const seconds = () => Math.round(frames() / fs());

  return (
    <details class="cb-notebox cb-fpstrip">
      <summary>
        <strong>Footprint &amp; activity</strong>
        <Footprint cellRow={cellRow()} width={36} />
        <span class="cb-fpstrip__spark">
          <Show when={current()} fallback={<span class="cb-muted">No traces loaded</span>}>
            {(t) => (
              <TraceCanvas values={values(t())!} labels={labels()} color={t().color} height={26} />
            )}
          </Show>
        </span>
        <span class="cb-muted">Full recording · {seconds()} s</span>
      </summary>
      <div class="cb-fpstrip__open">
        <Footprint cellRow={cellRow()} width={150} />
        <div class="cb-fpstrip__main">
          <Show
            when={current()}
            fallback={<div class="cb-muted">No traces are loaded for this recording.</div>}
          >
            {(t) => (
              <>
                <div class="cb-controls" role="group" aria-label="Trace">
                  <For each={available()}>
                    {(a) => (
                      <label class="cb-radio">
                        <input
                          type="radio"
                          name="cb-trace-kind"
                          checked={a.key === t().key}
                          onChange={() => setKind(a.key)}
                        />
                        <i class="cb-swatch" style={{ background: a.color }} /> {a.label}
                      </label>
                    )}
                  </For>
                </div>
                <TraceCanvas
                  values={values(t())!}
                  labels={labels()}
                  color={t().color}
                  height={130}
                />
                <div class="cb-trace__axis cb-muted">
                  <span>0 s</span>
                  <span>
                    {t().label} · cell {cellRow() + 1}
                  </span>
                  <span>{seconds()} s</span>
                </div>
                <div class="cb-legend">
                  <Show
                    when={aligned()}
                    fallback={
                      <span class="cb-muted">
                        This trace has {t().m.frames.toLocaleString()} frames and the analysis used{' '}
                        {frames().toLocaleString()}, so excluded frames cannot be marked.
                      </span>
                    }
                  >
                    <span class="cb-legend__item">
                      <i style={{ background: 'rgba(120,120,120,0.35)' }} /> Left out of the
                      analysis (slower than {props.out.data.minSpeed} cm/s, or outside the arena)
                    </span>
                  </Show>
                </div>
                <div class="cb-muted">
                  Shading only marks frames; the trace keeps its real values there. Signal units are
                  those of the loaded file.
                  <Show when={t().key !== 'events'}>
                    {' '}
                    The analysis itself uses the deconvolved events.
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
    </details>
  );
}
