import { createEffect, createSignal, For, Show, type JSX } from 'solid-js';
import { TracePanel } from '@calab/ui/chart';
import { annotationStats, type Epoch } from '../lib/behavior.ts';
import { clockProgress, timingChecks, type PositionQc } from '../lib/qc.ts';
import {
  alignmentResults,
  annotationFixCounts,
  cameraClock,
  annotationLog,
  annotationResults,
  editAnnotations,
  correctPosition,
  frameTimes,
  maxSpeed,
  positionLog,
  positionResult,
  sessionDuration,
  setMaxSpeed,
  timingResults,
  tol,
  undoAnnotationEdits,
  undoPositionCorrections,
} from '../lib/store.ts';
import { Checks, QcVerdict } from './parts.tsx';
import { QcDashboard } from './QcDashboard.tsx';

const scrollTo = (id: string) => () =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The animal's path. Steps faster than the threshold are drawn in red. */
function PathMap(props: { p: PositionQc }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    const { x, y, idx, speed } = props.p;
    const thr = maxSpeed();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ok = (i: number) => Number.isFinite(x[i]);
    const xs = x.filter(Number.isFinite);
    const ys = y.filter(Number.isFinite);
    if (!xs.length) return;
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const W = 360;
    const pad = 8;
    const k = (W - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-9);
    const H = Math.round((y1 - y0) * k + 2 * pad);
    canvas.width = W;
    canvas.height = H;
    const px = (i: number) => pad + (x[i] - x0) * k;
    const py = (i: number) => H - pad - (y[i] - y0) * k;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(33,113,181,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < x.length; i++) {
      if (ok(i) && ok(i - 1)) {
        ctx.moveTo(px(i - 1), py(i - 1));
        ctx.lineTo(px(i), py(i));
      }
    }
    ctx.stroke();
    ctx.strokeStyle = '#d32f2f';
    ctx.fillStyle = '#d32f2f';
    ctx.lineWidth = 2;
    speed.forEach((v, n) => {
      if (v <= thr) return;
      const i = idx[n];
      ctx.beginPath();
      ctx.moveTo(px(i - 1), py(i - 1));
      ctx.lineTo(px(i), py(i));
      ctx.stroke();
      ctx.fillRect(px(i) - 2, py(i) - 2, 4, 4);
    });
  });
  return <canvas ref={canvas} class="cb-pathmap" aria-label="Path of the animal" />;
}

export const PALETTE = ['#2171b5', '#e09800', '#2e7d32', '#8e44ad', '#16a085', '#c0392b'];

/** One row per label, one bar per epoch. Problem epochs are outlined in red. */
export function Ethogram(props: { epochs: Epoch[]; duration: number }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const labels = () => [...new Set(props.epochs.map((e) => e.label))];
  const ROW = 24;
  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const W = 1000;
    canvas.width = W;
    canvas.height = labels().length * ROW;
    const span = Math.max(props.duration, ...props.epochs.map((e) => e.stop));
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, canvas.height);
    for (const e of props.epochs) {
      const row = labels().indexOf(e.label);
      const x = (Math.max(e.start, 0) / span) * W;
      const w = Math.max(((Math.max(e.stop, e.start) - Math.max(e.start, 0)) / span) * W, 2);
      ctx.fillStyle = PALETTE[row % PALETTE.length];
      ctx.fillRect(x, row * ROW + 4, w, ROW - 8);
      if (e.flags.length || e.notes.length) {
        ctx.strokeStyle = e.flags.length ? '#d32f2f' : '#e09800';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, row * ROW + 2, w + 2, ROW - 4);
      }
    }
    // Where the session ends.
    ctx.strokeStyle = '#616161';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo((props.duration / span) * W, 0);
    ctx.lineTo((props.duration / span) * W, canvas.height);
    ctx.stroke();
  });
  return (
    <div class="cb-etho">
      <div class="cb-etho__labels">
        <For each={labels()}>{(l) => <div style={{ height: `${ROW}px` }}>{l}</div>}</For>
      </div>
      <canvas ref={canvas} aria-label="Annotated behavior over the session" />
    </div>
  );
}

function StatsTable(props: { epochs: Epoch[] }): JSX.Element {
  const rows = () =>
    annotationStats(
      props.epochs,
      sessionDuration() ?? Math.max(...props.epochs.map((e) => e.stop)),
    );
  const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  return (
    <table class="cb-stats">
      <thead>
        <tr>
          <th>Label</th>
          <th>Epochs</th>
          <th>Mean length (s)</th>
          <th>Mean gap to next (s)</th>
          <th>Share of session</th>
        </tr>
      </thead>
      <tbody>
        <For each={rows()}>
          {(r) => (
            <tr>
              <td>{r.label}</td>
              <td>{r.n}</td>
              <td>
                {f(r.meanLen)} ± {f(r.sdLen)}
              </td>
              <td>{f(r.meanGap)}</td>
              <td>
                <span class="cb-bar" style={{ width: `${Math.min(r.pctSession, 100) * 0.6}px` }} />
                {f(r.pctSession, 1)}%
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** Optional fixes for annotations: merge bouts that are really one, and remove bouts too short to use. */
function AnnotationFixes(): JSX.Element {
  return (
    <div class="cb-fix">
      <div class="cb-fix__title">Optional fixes in CaBaNA</div>
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => editAnnotations('merge')}>
          Merge bouts closer than {tol.mergeGapS} s ({annotationFixCounts().merge})
        </button>
        <button class="btn-secondary btn-small" onClick={() => editAnnotations('drop')}>
          Remove bouts under {tol.minBoutS} s ({annotationFixCounts().drop})
        </button>
      </div>
      <Show when={annotationLog().length}>
        <ul class="cb-muted">
          <For each={annotationLog()}>{(m) => <li>{m}</li>}</For>
        </ul>
        <button class="cb-link" onClick={undoAnnotationEdits}>
          Undo annotation fixes
        </button>
      </Show>
      <div class="cb-muted">
        The thresholds are the QC parameters above. The annotation file itself is not changed.
      </div>
    </div>
  );
}

/** Corrections for position that CaBaNA can make. */
function PositionFixes(): JSX.Element {
  const [windowS, setWindowS] = createSignal(0.25);
  const [gapS, setGapS] = createSignal(0.5);
  return (
    <div class="cb-fix">
      <div class="cb-fix__title">Fix in CaBaNA</div>
      <div class="cb-controls">
        <button
          class="btn-secondary btn-small"
          onClick={() => correctPosition('median', windowS())}
        >
          Apply median filter
        </button>
        <label>
          window of
          <input
            type="number"
            min="0.03"
            step="0.05"
            value={windowS()}
            onInput={(e) => setWindowS(Math.max(0.03, +e.currentTarget.value || 0.25))}
          />
          s
        </label>
        <span class="cb-muted">
          Replaces each position by the median of its neighbors, which removes jumps.
        </span>
      </div>
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => correctPosition('fill', gapS())}>
          Fill short gaps
        </button>
        <label>
          up to
          <input
            type="number"
            min="0.03"
            step="0.1"
            value={gapS()}
            onInput={(e) => setGapS(Math.max(0.03, +e.currentTarget.value || 0.5))}
          />
          s
        </label>
        <span class="cb-muted">
          Draws a straight line across short lost stretches. A stretch at the start or end of the
          session is not filled.
        </span>
      </div>
      <Show when={positionLog().length}>
        <ul class="cb-muted">
          <For each={positionLog()}>{(m) => <li>{m}</li>}</For>
        </ul>
        <button class="cb-link" onClick={undoPositionCorrections}>
          Undo all position corrections
        </button>
      </Show>
    </div>
  );
}

/** Each recording's progress against time on the neural clock; the two lines should start and end together. */
function ClockPlot(): JSX.Element {
  const both = () => {
    const [n, c] = [frameTimes(), cameraClock()];
    return n?.length && c?.length ? clockProgress(n, c) : undefined;
  };
  return (
    <Show when={both()}>
      <div class="cb-label">Recording progress on the neural clock</div>
      <TracePanel
        data={() => both() as unknown as [number[], ...number[][]]}
        series={[
          {},
          { label: 'Miniscope (% of frames)', stroke: '#2171b5', width: 1.5 },
          { label: 'Behavior camera (% of frames)', stroke: '#e09800', width: 1.5, dash: [6, 4] },
        ]}
        height={180}
        syncKey="cabana-clocks"
        xLabel="Time (s)"
      />
      <div class="cb-muted">
        Each line climbs from 0 to 100% as its recording runs. Lines that start or end apart mean
        one recording started or stopped first. A flat step is a run of dropped frames, and a
        difference in slope is a difference in frame rate.
      </div>
    </Show>
  );
}

export function BehaviorQc(): JSX.Element {
  const pos = () => positionResult();
  const timing = () => [
    ...timingResults().flatMap((r) => timingChecks(r.name, r)),
    ...alignmentResults(),
  ];
  const posOk = () => {
    const p = pos();
    return p && 'checks' in p ? p : undefined;
  };
  return (
    <>
      <Show when={!pos() && !annotationResults().length}>
        <div class="cb-empty">
          Load position and camera timestamps, or annotation files, to check behavior.
        </div>
      </Show>

      <QcDashboard
        cards={[
          { title: 'Timing and alignment', checks: timing(), open: scrollTo('qc-timing') },
          {
            title: 'Position tracking',
            checks: posOk()?.checks ?? [],
            section: 'position',
            open: scrollTo('qc-position'),
          },
          ...annotationResults()
            .filter((a) => !a.error)
            .map((a) => ({
              title: `Annotations: ${a.name.replace(/\.[^.]+$/, '')}`,
              checks: a.checks,
              section: 'annotations' as const,
              open: scrollTo('qc-annotations'),
            })),
        ]}
      />

      <Show when={timing().length}>
        <Checks id="qc-timing" title="Timing and alignment" checks={timing()} />
        <ClockPlot />
      </Show>

      <Show when={pos() && !posOk()}>
        <div class="cb-error">{(pos() as { error: string }).error}</div>
      </Show>
      <Show when={posOk()}>
        <QcVerdict
          section="position"
          title="Position tracking"
          checks={posOk()!.checks}
          allowed={['lostPct', 'jumpPct']}
        >
          <PositionFixes />
        </QcVerdict>
        <Checks title="Position" checks={posOk()!.checks} />
        <div class="cb-cellbar">
          <span>Jump threshold</span>
          <input
            type="number"
            min="1"
            value={maxSpeed()}
            onInput={(e) => setMaxSpeed(+e.currentTarget.value || 60)}
          />
          <span class="cb-muted">cm/s. Steps faster than this are flagged.</span>
        </div>
        <div class="cb-cellgrid">
          <div>
            <PathMap p={posOk()!} />
            <div class="cb-muted">Path of the animal. Red: steps over the threshold.</div>
          </div>
          <TracePanel
            data={() =>
              [posOk()!.t, posOk()!.speed, posOk()!.t.map(() => maxSpeed())] as [
                number[],
                ...number[][],
              ]
            }
            series={[
              {},
              { label: 'Speed (cm/s)', stroke: '#2171b5', width: 1 },
              { label: 'Threshold', stroke: '#d32f2f', width: 1, dash: [4, 4] },
            ]}
            height={200}
            syncKey="cabana-speed"
            xLabel="Time (s)"
          />
        </div>
      </Show>

      <Show when={annotationResults().filter((a) => !a.error).length}>
        <QcVerdict
          section="annotations"
          title="Annotations"
          checks={annotationResults().flatMap((a) => a.checks)}
          allowed={['annotPct', 'minBoutS', 'mergeGapS']}
        >
          <AnnotationFixes />
        </QcVerdict>
      </Show>
      <For each={annotationResults()}>
        {(a) => (
          <>
            <Show when={a.error}>
              <div class="cb-error">
                {a.name}: {a.error}
              </div>
            </Show>
            <Show when={!a.error}>
              <Checks title={`Annotations: ${a.name}`} checks={a.checks} />
              <Ethogram epochs={a.epochs} duration={sessionDuration() ?? 0} />
              <div class="cb-muted">
                Red outline: error. Amber outline: a bout that is very short, or close to another
                bout of the same label. Dashed line: end of the session.
              </div>
              <StatsTable epochs={a.epochs} />
              <Show when={a.epochs.some((e) => e.flags.length)}>
                <ul class="cb-flaglist">
                  <For each={a.epochs.filter((e) => e.flags.length).slice(0, 12)}>
                    {(e) => (
                      <li>
                        {e.label} {e.start.toFixed(2)} to {e.stop.toFixed(2)} s:{' '}
                        {e.flags.join(', ')}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </>
        )}
      </For>
    </>
  );
}
