import { createMemo, For, Show, type JSX } from 'solid-js';
import { SolidUplot } from '@dschz/solid-uplot';
import { TracePanel, chartAxis } from '@calab/ui/chart';
import { INDICATORS, PRESET_NOTE, SWEEP_TAUS, fitLine, reconvolve } from '../lib/decon.ts';
import {
  compareTo,
  editTau,
  indicatorId,
  kernelChecks,
  pve,
  pveVsRaw,
  setCompareTo,
  setIndicator,
  sweep,
  target,
  targetName,
  tauDecay,
  tauRise,
  triggered,
} from '../lib/decon-state.ts';
import {
  cell,
  deconvolved,
  cellResult,
  denoisedTrace,
  frameTimes,
  rawTrace,
  samplingRate,
} from '../lib/store.ts';
import { CellPicker } from './parts.tsx';
import {
  Advice,
  CategoryHead,
  Findings,
  Help,
  Limits,
  PlotCard,
  PopButton,
  RailBox,
  ReviewActions,
} from './QcParts.tsx';
import { InfoTip } from './InfoTip.tsx';

type Data = [number[], ...number[][]];
const gap = null as unknown as number;
const AXIS = { labelSize: 10, labelFont: '10px sans-serif' };

/** Average trace after an event, next to the kernel the user picked. */
function EventTriggeredPlot(props: { h: number }): JSX.Element {
  const data = (): Data => {
    const t = triggered()!;
    const fs = samplingRate()!;
    const k = reconvolve(
      t.t.map((x) => (x === 0 ? 1 : 0)),
      0,
      t.t.length,
      fs,
      tauRise(),
      tauDecay(),
    );
    return [t.t, t.pop, Array.from(k)];
  };
  return (
    <TracePanel
      data={data}
      series={[
        {},
        { label: 'Average after event', stroke: '#2171b5', width: 2 },
        { label: 'Kernel', stroke: '#e09800', width: 1.5, dash: [5, 4] },
      ]}
      height={props.h}
      syncKey="cabana-eta"
      xLabel="Time from event (s)"
      disableWheelZoom
    />
  );
}

function SweepPlot(props: { h: number }): JSX.Element {
  const data = (): Data => {
    const sw = sweep()!;
    const nearest = SWEEP_TAUS.reduce(
      (bi, v, i) => (Math.abs(v - tauDecay()) < Math.abs(SWEEP_TAUS[bi] - tauDecay()) ? i : bi),
      0,
    );
    return [SWEEP_TAUS, sw, sw.map((v, i) => (i === nearest ? v : gap))];
  };
  return (
    <TracePanel
      data={data}
      series={[
        {},
        { label: 'Median fraction explained', stroke: '#2171b5', width: 2 },
        { label: 'Your setting', stroke: '#e09800', width: 0, points: { show: true, size: 9 } },
      ]}
      height={props.h}
      syncKey="cabana-sweep"
      xLabel="Decay time (s)"
      yRange={[0, 1]}
      disableWheelZoom
    />
  );
}

/** One cell as three stacked panels on one time axis, plus the numbers for its title and help. */
const cellStack = () => {
  const ev = deconvolved();
  const raw = rawTrace();
  const tr = raw ?? target();
  const fs = samplingRate();
  if (!ev || !tr || !fs || ev.frames !== tr.frames) return undefined;
  const c = Math.min(cell(), ev.cells - 1);
  const x = reconvolve(ev.data, c * ev.frames, ev.frames, fs, tauRise(), tauDecay());
  const fit = fitLine(tr.data, c * tr.frames, x);
  const row = (m: typeof tr) => Array.from(m.data.subarray(c * m.frames, (c + 1) * m.frames));
  const t =
    frameTimes()?.slice(0, ev.frames) ?? Array.from({ length: ev.frames }, (_, i) => i / fs);
  const against = raw ? 'raw' : targetName();
  return {
    t,
    n: ev.cells,
    pve: fit.pve,
    against,
    panels: [
      { label: 'Deconvolved events', stroke: '#e09800', v: row(ev) },
      {
        label: `Reconvolved events (fit to the ${against} trace)`,
        stroke: '#2e7d32',
        v: Array.from(x, (v) => fit.a * v + fit.b),
      },
      { label: raw ? 'Raw trace' : `${targetName()} trace`, stroke: '#8a97a8', v: row(tr) },
    ],
  };
};

/**
 * The three panels of `cellStack`, splitting `h` between them. Below 190 px the panels would be
 * too thin to read, so the card shows the cell's number and a button to open the larger view.
 */
function CellStack(props: { h: number; expand?: () => void }): JSX.Element {
  const view = createMemo(cellStack);
  // Below about 70 px a panel has no room left after its time axis, and uPlot draws it upside down.
  const each = () => Math.max(70, (props.h - 3 * 27) / 3);
  return (
    <Show
      when={view() && ((props.h - 3 * 27) / 3 >= 70 || !props.expand)}
      fallback={
        <Show when={view()}>
          <div class="cb-plot__small">
            <p>
              Events reconvolved with the kernel explain{' '}
              <b>{Number.isFinite(view()!.pve) ? `${(100 * view()!.pve).toFixed(0)}%` : 'none'}</b>{' '}
              of cell {cell() + 1}'s {view()!.against} trace.
            </p>
            <button class="btn-secondary btn-small" onClick={props.expand}>
              Open the three panels ⤢
            </button>
          </div>
        </Show>
      }
    >
      <For each={view()!.panels}>
        {(p) => (
          <>
            <div class="cb-label">
              <i style={{ background: p.stroke }} />
              {p.label}
            </div>
            <TracePanel
              data={() => [view()!.t, p.v] as Data}
              series={[{}, { label: p.label, stroke: p.stroke, width: 1.2 }]}
              height={each()}
              syncKey="cabana-stack"
              xLabel="Time (s)"
            />
          </>
        )}
      </For>
    </Show>
  );
}

/** Per cell: what the events explain of the raw trace against signal to noise, and the most they could. */
function PveScatter(props: { h: number }): JSX.Element {
  const data = (): Data => {
    const r = pveVsRaw()!;
    const snr = cellResult()!.snr;
    const order = snr
      .map((v, i) => i)
      .filter((i) => snr[i] > 0 && Number.isFinite(r.pve[i]))
      .sort((a, b) => snr[a] - snr[b]);
    return [order.map((i) => snr[i]), order.map((i) => r.pve[i]), order.map((i) => r.ceiling[i])];
  };
  const dots = (label: string, color: string, size: number) => ({
    label,
    stroke: color,
    paths: () => null,
    points: { show: true, size, fill: color, stroke: color },
  });
  return (
    <div class="trace-panel" style={{ height: `${props.h}px` }}>
      <SolidUplot
        data={data()}
        series={[{}, dots('Reconvolved events', '#2171b5', 6), dots('Noise ceiling', '#b4bcc7', 5)]}
        scales={{ x: { time: false, distr: 3 }, y: { range: [0, 1] } }}
        axes={[
          chartAxis({ label: 'Signal to noise (log scale)', ...AXIS, size: 34 }),
          chartAxis({ label: 'Fraction of raw trace explained', ...AXIS, size: 50 }),
        ]}
        cursor={{ drag: { x: false, y: false } }}
        height={props.h}
        autoResize={true}
      />
    </div>
  );
}

const key = (color: string) => <span class="cb-key" style={{ background: color }} />;

/** Deconvolution: the four comparison plots, and the kernel settings. */
export function DeconView(): JSX.Element {
  const checks = kernelChecks;
  const med = () => {
    const v = pve()
      ?.filter(Number.isFinite)
      .sort((a, b) => a - b);
    return v?.length ? v[Math.floor(v.length / 2)] : undefined;
  };
  const trace = () => (rawTrace() ? 'raw' : 'denoised');
  const stack = createMemo(cellStack);
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead
          title="Deconvolution"
          checks={checks()}
          flagged={(() => {
            const n = checks().filter((c) => c.status !== 'pass').length;
            return n ? `${n} ${n === 1 ? 'note' : 'notes'}` : undefined;
          })()}
        />
        <Show
          when={target()}
          fallback={
            <div class="cb-note">Load raw or denoised traces to compare events with a kernel.</div>
          }
        >
          <div class="cb-qc-grid4">
            <Show when={triggered()}>
              <PlotCard
                title="What the trace does after an event"
                legend={
                  <>
                    {key('#2171b5')}Average after event{key('#e09800')}Kernel
                  </>
                }
                help={
                  <>
                    <Help k="What is plotted">
                      The {trace()} trace averaged around every event, each cell scaled to its own
                      peak, then averaged over cells.
                      {triggered()!.tauDecay && (
                        <>
                          {' '}
                          It decays with a time constant of about{' '}
                          {triggered()!.tauDecay!.toFixed(2)} s.
                        </>
                      )}
                    </Help>
                    <Help k="Axes">
                      Time from the event in seconds (0 is the event); trace scaled to its peak.
                    </Help>
                    <Help k="Colors">
                      Blue: the average trace. Orange dashed: the kernel from the Settings box.
                    </Help>
                    <Help k="Limits">
                      If the shapes differ, the kernel or the events are off. Events close together
                      overlap in the average, which lengthens its tail.
                    </Help>
                  </>
                }
              >
                {(s) => <EventTriggeredPlot h={s().h} />}
              </PlotCard>
            </Show>
            <Show when={sweep()}>
              <PlotCard
                title="Which decay time fits best"
                legend={
                  <>
                    {key('#2171b5')}Median fraction explained{key('#e09800')}Your setting
                  </>
                }
                help={
                  <>
                    <Help k="What is plotted">
                      The fraction of the {targetName()} trace explained after reconvolving the
                      events with each decay time, as the median over cells (up to about 60 cells,
                      spread across the list). Each cell gets its own scale and offset. The peak is
                      the decay time the data prefer.
                    </Help>
                    <Help k="Axes">
                      Decay time in seconds (log spacing); fraction explained from 0 to 1.
                    </Help>
                    <Help k="Colors">Blue: the sweep. Orange dot: the decay time in Settings.</Help>
                    <Help k="Limits">
                      The rise time stays at the Settings value. A flat curve means the events
                      barely constrain the decay time.
                    </Help>
                  </>
                }
              >
                {(s) => <SweepPlot h={s().h} />}
              </PlotCard>
            </Show>
            <Show when={pveVsRaw() && cellResult()}>
              <PlotCard
                title="Explained variance against signal to noise"
                legend={
                  <>
                    {key('#2171b5')}Reconvolved events{key('#b4bcc7')}Noise ceiling
                  </>
                }
                help={
                  <>
                    <Help k="What is plotted">
                      One dot per cell. Gray: the most any events could explain of the raw trace,
                      which is everything except the noise. Blue: what the events explain after
                      reconvolving with the Settings kernel. Good events sit just under the gray
                      dots.
                    </Help>
                    <Help k="Axes">
                      Signal to noise on a log scale, (99th percentile minus median) divided by the
                      noise SD, which comes from the median absolute frame-to-frame difference.
                      Fraction of the raw trace explained, 0 to 1.
                    </Help>
                    <Help k="Colors">Blue: events. Gray: noise ceiling.</Help>
                    <Help k="Limits">
                      The gray dots rise with signal to noise and level off near 1. Blue far below
                      gray means the events miss real signal or add false ones. Cells with no events
                      are left out.
                    </Help>
                  </>
                }
              >
                {(s) => <PveScatter h={s().h} />}
              </PlotCard>
            </Show>
            <Show when={stack()}>
              <PlotCard
                title="Compare one cell by eye"
                tools={<CellPicker n={stack()!.n} compact />}
                legend={
                  <>
                    {key('#e09800')}Events{key('#2e7d32')}Reconvolved{key('#8a97a8')}Trace
                  </>
                }
                help={
                  <>
                    <Help k="What is plotted">
                      One cell as three panels: the deconvolved events, the events reconvolved with
                      the Settings kernel and fitted to the {stack()!.against} trace (own scale and
                      offset), and the trace itself. Events reconvolved with the kernel explain{' '}
                      {Number.isFinite(stack()!.pve)
                        ? `${(100 * stack()!.pve).toFixed(0)}%`
                        : 'none'}{' '}
                      of this cell's {stack()!.against} trace.
                    </Help>
                    <Help k="Axes">Time in seconds; each panel has its own vertical scale.</Help>
                    <Help k="Colors">
                      Orange: events. Green: reconvolved events. Gray: the trace.
                    </Help>
                    <Help k="Linked">
                      The panels share zoom and cursor: scroll to zoom, drag to pan. The cell is the
                      one selected on the Cells tab.
                    </Help>
                    <Help k="Limits">One cell can look better or worse than the median.</Help>
                  </>
                }
              >
                {(s, expand) => <CellStack h={s().h} expand={expand} />}
              </PlotCard>
            </Show>
          </div>
        </Show>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={checks()} />
        <RailBox title="Settings" fold="settings">
          <div class="cb-controls cb-controls--rail">
            <label>
              <span>
                Indicator
                <InfoTip label="About the kernel settings">
                  Events from different pipelines are on different scales, so each cell is fitted
                  with its own scale and offset. Pick the indicator, or type the time constants the
                  pipeline used.
                </InfoTip>
              </span>
              <select value={indicatorId()} onChange={(e) => setIndicator(e.currentTarget.value)}>
                <For each={INDICATORS}>{(i) => <option value={i.id}>{i.label}</option>}</For>
              </select>
            </label>
            <label>
              Rise time
              <input
                type="number"
                step="0.01"
                min="0"
                value={tauRise()}
                onInput={(e) => editTau('rise', Math.max(0, +e.currentTarget.value))}
              />{' '}
              s
            </label>
            <label>
              Decay time
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={tauDecay()}
                onInput={(e) => editTau('decay', Math.max(0.05, +e.currentTarget.value || 0.5))}
              />{' '}
              s
            </label>
            <Show when={rawTrace() && denoisedTrace()}>
              <label>
                Compare to
                <select
                  value={compareTo()}
                  onChange={(e) => setCompareTo(e.currentTarget.value as 'raw' | 'denoised')}
                >
                  <option value="denoised">Denoised trace</option>
                  <option value="raw">Raw trace</option>
                </select>
              </label>
            </Show>
            <Show when={med() !== undefined}>
              <span class="cb-muted">Median explained: {(100 * med()!).toFixed(0)}%</span>
            </Show>
          </div>
          <PopButton
            label="About indicator presets"
            title="About indicator presets"
            width={380}
            class="cb-link"
            button="About indicator presets"
          >
            <p>{PRESET_NOTE}</p>
          </PopButton>
          <Limits keys={['minPve']} />
        </RailBox>
        <RailBox title="Correction" fold="correction">
          <p class="cb-muted">
            No deconvolution fix runs in CaBaNA. Match the kernel to the one your pipeline used, or
            rerun deconvolution with a decay time closer to the data.
          </p>
          <Advice checks={checks()} />
          <ReviewActions id="decon" section="decon" checks={checks()} />
        </RailBox>
      </aside>
    </>
  );
}
