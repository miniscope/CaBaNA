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
import { CellPicker, Checks, Note, QcVerdict } from './parts.tsx';

type Data = [number[], ...number[][]];
const gap = null as unknown as number;

/** Average trace after an event, next to the kernel the user picked. */
function EventTriggeredPlot(): JSX.Element {
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
    <Show when={triggered()}>
      <div class="cb-subhead">What the trace does after an event</div>
      <p class="cb-muted">
        Average of the {rawTrace() ? 'raw' : 'denoised'} trace around every event, each cell scaled
        to its own peak.
        {triggered()!.tauDecay && (
          <> It decays with a time constant of about {triggered()!.tauDecay!.toFixed(2)} s.</>
        )}{' '}
        The orange line is the kernel from your settings below. If the shapes differ, the kernel or
        the events are off.
      </p>
      <TracePanel
        data={data}
        series={[
          {},
          { label: 'Average after event', stroke: '#2171b5', width: 2 },
          { label: 'Kernel', stroke: '#e09800', width: 1.5, dash: [5, 4] },
        ]}
        height={150}
        syncKey="cabana-eta"
        xLabel="Time from event (s)"
        disableWheelZoom
      />
    </Show>
  );
}

function SweepPlot(): JSX.Element {
  const data = (): Data => {
    const sw = sweep()!;
    const nearest = SWEEP_TAUS.reduce(
      (bi, v, i) => (Math.abs(v - tauDecay()) < Math.abs(SWEEP_TAUS[bi] - tauDecay()) ? i : bi),
      0,
    );
    return [SWEEP_TAUS, sw, sw.map((v, i) => (i === nearest ? v : gap))];
  };
  return (
    <Show when={sweep()}>
      <div class="cb-subhead">Which decay time fits best</div>
      <p class="cb-muted">
        Fraction of the {targetName()} trace explained after reconvolving with each decay time
        (median over cells). The peak is the decay time the data prefer. The dot is your setting.
      </p>
      <TracePanel
        data={data}
        series={[
          {},
          { label: 'Median fraction explained', stroke: '#2171b5', width: 2 },
          { label: 'Your setting', stroke: '#e09800', width: 0, points: { show: true, size: 9 } },
        ]}
        height={150}
        syncKey="cabana-sweep"
        xLabel="Decay time (s)"
        yRange={[0, 1]}
        disableWheelZoom
      />
    </Show>
  );
}

/** One cell, three stacked panels on one time axis: the events, what they reconvolve to, and the raw trace. */
function CellStack(): JSX.Element {
  const view = createMemo(() => {
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
  });
  return (
    <Show when={view()}>
      <div class="cb-subhead">Compare one cell by eye</div>
      <CellPicker n={view()!.n}>
        <span class="cb-muted">
          Events reconvolved with your kernel explain{' '}
          {Number.isFinite(view()!.pve) ? `${(100 * view()!.pve).toFixed(0)}%` : 'none'} of this
          cell's {view()!.against} trace
        </span>
      </CellPicker>
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
              height={110}
              syncKey="cabana-stack"
              xLabel="Time (s). Scroll to zoom."
            />
          </>
        )}
      </For>
    </Show>
  );
}

/** Per cell: what the events explain of the raw trace against signal to noise, and the most they could. */
function PveScatter(): JSX.Element {
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
    <Show when={pveVsRaw() && cellResult()}>
      <div class="cb-subhead">Explained variance against signal to noise</div>
      <p class="cb-muted">
        One dot per cell. Gray: the most any events could explain of the raw trace, which is
        everything except the noise, so it rises with signal to noise and levels off near 1. Blue:
        what your events explain. Good events sit just under the gray dots. Blue far below gray
        means the events miss real signal or add false ones.
      </p>
      <div class="trace-panel" style={{ height: '280px' }}>
        <SolidUplot
          data={data()}
          series={[
            {},
            dots('Reconvolved events', '#2171b5', 6),
            dots('Noise ceiling', '#b4bcc7', 5),
          ]}
          scales={{ x: { time: false, distr: 3 }, y: { range: [0, 1] } }}
          axes={[
            chartAxis({
              label: 'Signal to noise (log scale)',
              labelSize: 10,
              labelFont: '10px sans-serif',
              size: 34,
            }),
            chartAxis({
              label: 'Fraction of raw trace explained',
              labelSize: 10,
              labelFont: '10px sans-serif',
              size: 50,
            }),
          ]}
          cursor={{ drag: { x: false, y: false } }}
          height={280}
          autoResize={true}
        />
      </div>
    </Show>
  );
}

export function DeconQc(): JSX.Element {
  const med = () => {
    const v = pve()
      ?.filter(Number.isFinite)
      .sort((a, b) => a - b);
    return v?.length ? v[Math.floor(v.length / 2)] : undefined;
  };
  return (
    <Show when={deconvolved()}>
      <QcVerdict
        section="decon"
        title="Deconvolution"
        checks={kernelChecks()}
        allowed={['minPve']}
      />
      <div class="cb-subhead">Compare with a kernel</div>
      <p class="cb-muted">
        Events from different pipelines are on different scales, so each cell is fitted with its own
        scale and offset. Pick your indicator, or type the time constants your pipeline used.
      </p>
      <div class="cb-controls">
        <label>
          Indicator
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
      <Note>{PRESET_NOTE}</Note>
      <Show
        when={target()}
        fallback={
          <div class="cb-note">Load raw or denoised traces to compare events with a kernel.</div>
        }
      >
        <Checks checks={kernelChecks()} />
        <EventTriggeredPlot />
        <SweepPlot />
        <PveScatter />
        <CellStack />
      </Show>
    </Show>
  );
}
