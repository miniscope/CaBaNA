// Behavioral QC timing and alignment: the clock plot, the recordings table and their summary and correction notes.
import { For, Show, type JSX } from 'solid-js';
import type { MetricCard } from '../components/MetricCards.tsx';
import { openData } from '../lib/data-setup-view.ts';
import { source, timingResults } from '../lib/store.ts';
import { Advice, Help, PlotCard } from './QcParts.tsx';
import { ClockPlot, timing } from './BehaviorQc.tsx';

function RecordingsTable(): JSX.Element {
  return (
    <section class="cb-plot">
      <div class="cb-plot__head">
        <h3>Recordings</h3>
      </div>
      <div class="cb-plot__scroll">
        <table class="cb-stats">
          <thead>
            <tr>
              <th>Recording</th>
              <th>Frames</th>
              <th>Mean rate</th>
              <th>Dropped (limit 1%)</th>
              <th>Jitter (limit)</th>
            </tr>
          </thead>
          <tbody>
            <For each={timingResults()}>
              {(r) => (
                <tr>
                  <td>{r.name}</td>
                  <td>{r.nFrames.toLocaleString()}</td>
                  <td>{r.fsMean.toFixed(2)} Hz</td>
                  <td>
                    {r.nDropped} ({(100 * r.droppedFraction).toFixed(2)}%) in {r.gapStart.length}{' '}
                    {r.gapStart.length === 1 ? 'gap' : 'gaps'}
                  </td>
                  <td>
                    {(1000 * r.jitterS).toFixed(2)} ms ({((1000 * 0.25) / r.fsMedian).toFixed(1)}{' '}
                    ms)
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TimingPlot(props: { tab: string }): JSX.Element {
  return (
    <>
      <Show when={!timing().length}>
        <div class="cb-empty">Timing and alignment need timestamps files.</div>
      </Show>
      <Show when={timing().length && props.tab === 'clock'}>
        <PlotCard
          title="Recording progress on the neural clock"
          class="cb-plot--grow3"
          legend={
            <>
              <span class="cb-key" style={{ background: '#2171b5' }} />
              Miniscope
              <span class="cb-key cb-key--dash-amber" />
              Behavior camera
            </>
          }
          help={
            <>
              <Help k="What is plotted">
                For each recording, the share of its frames recorded so far, from 0 to 100%, against
                time. The camera times are moved onto the neural clock by the clock offset from
                Experimental Setup.
              </Help>
              <Help k="Axes">Time on the neural clock in seconds; percent of frames.</Help>
              <Help k="How to read">
                The lines should start and end together and rise in parallel. Lines that start or
                end apart mean one recording started or stopped first. A flat step is a run of
                dropped frames, and a difference in slope is a difference in frame rate.
              </Help>
              <Help k="Limits">
                The plot uses the timestamps as written. If both clocks drift together, for example
                from the same wrong clock, the lines still agree.
              </Help>
            </>
          }
        >
          {(s) => <ClockPlot h={s().h} />}
        </PlotCard>
      </Show>
      <Show when={timingResults().length && props.tab === 'recordings'}>
        <RecordingsTable />
      </Show>
    </>
  );
}

export const timingMetrics = (): MetricCard[] => {
  const rs = timingResults();
  if (!rs.length) return [];
  const dropped = rs.reduce((n, r) => n + r.nDropped, 0);
  const worstJitter = rs.reduce((a, r) => (r.jitterS > a.jitterS ? r : a));
  return [
    { label: 'Recordings', value: String(rs.length), denom: 'with timestamps', tone: 'blue' },
    {
      label: 'Dropped frames',
      value: String(dropped),
      denom: `of ${rs.reduce((n, r) => n + r.nFrames, 0).toLocaleString()} frames recorded, limit 1% per recording`,
      tone: rs.some((r) => r.droppedFraction > 0.01) ? 'warn' : 'neutral',
    },
    {
      label: 'Largest jitter',
      value: `${(1000 * worstJitter.jitterS).toFixed(2)} ms`,
      denom: `${worstJitter.name}, limit ${((1000 * 0.25) / worstJitter.fsMedian).toFixed(1)} ms`,
      tone: worstJitter.jitterS > 0.25 / worstJitter.fsMedian ? 'warn' : 'neutral',
    },
    {
      label: 'Clock offset',
      value: `${source.clockOffsetS} s`,
      denom: 'camera to neural clock',
      tone: 'gray',
    },
  ];
};

export function TimingCorrection(): JSX.Element {
  return (
    <>
      <p class="cb-muted">
        CaBaNA does not change timestamps. A clock offset is entered in Experiment config.
      </p>
      <Advice checks={timing()} />
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => openData('config')}>
          Open Experiment config
        </button>
      </div>
    </>
  );
}
