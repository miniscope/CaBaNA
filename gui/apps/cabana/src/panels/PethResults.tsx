// PETH results: the header with the summary and run details, and the three views.

import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { pethCsv, pethCurvesCsv, pethMetadata } from '../lib/peth-export.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import { hasTest, sortCells, summarize, type CellSort } from '../lib/peth-view.ts';
import { downloadText } from '../lib/place-export.ts';
import { goToStep } from '../lib/store.ts';
import { Modal } from './AurocResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { PethInspector } from './PethInspector.tsx';
import { PopulationView } from './PethPopulation.tsx';
import { type Ctx } from './PethShared.tsx';
import { SummaryView } from './PethSummary.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton } from './QcParts.tsx';

type View = 'population' | 'inspector' | 'summary';
const VIEWS: [View, string][] = [
  ['population', 'Population'],
  ['inspector', 'Cell inspector'],
  ['summary', 'Summary'],
];

const fmt = (n: number, d = 2) => +n.toFixed(d);

function Header(props: { out: PethOutcome }): JSX.Element {
  const o = () => props.out;
  const s = createMemo(() => summarize(o()));
  const correction = () =>
    o().settings.correction === 'max_stat' ? 'max-stat across behaviors' : 'no correction';
  const notEvaluated = () => o().reports.flatMap((r, b) => (r.onsets.length < o().params.minEvents ? [o().labels[b]] : []));
  return (
    <div class="cb-ar-head">
      <div>
        <h2 class="cb-restitle">PETH results</h2>
        <p class="cb-muted">
          <Show
            when={hasTest(o())}
            fallback={
              <>
                Shuffle test off: curves only, no p-values and no labels · {s().evaluated} of {s().cells} cells
                evaluated
              </>
            }
          >
            <b>
              {s().respondingCells} of {s().evaluated}
            </b>{' '}
            evaluated cells respond to at least one behavior · {s().significantPairs} significant cell–behavior pairs ·{' '}
            {correction()}, α {o().settings.alpha}
          </Show>{' '}
          <InfoTip label="Why a cell or behavior may not be evaluated">
            <p>
              A value is left undefined, and marked <strong>Not evaluated</strong>, in two cases:
            </p>
            <ul>
              <li>
                <strong>Too few onsets:</strong> a behavior has fewer than {o().params.minEvents} included onsets. That
                behavior is not evaluated for any cell.{' '}
                {notEvaluated().length ? `In this run: ${notEvaluated().join(', ')}.` : 'None in this run.'}
              </li>
              <li>
                <strong>Non-finite neural values:</strong> the cell has a missing or infinite value anywhere in the
                session. All of its behaviors are not evaluated. {s().missingCells} cell
                {s().missingCells === 1 ? '' : 's'} in this run.
              </li>
            </ul>
            <p>Not evaluated is not zero and not nonsignificant.</p>
          </InfoTip>
        </p>
      </div>
    </div>
  );
}

/** Run details, Edit setup and Export, in the row of the view tabs. */
function Actions(props: { out: PethOutcome; onEdit: () => void; onDetails: () => void }): JSX.Element {
  const o = () => props.out;
  return (
    <div class="cb-controls">
      <button class="btn-secondary" aria-haspopup="dialog" onClick={props.onDetails}>
        Run details
      </button>
      <button class="btn-secondary" onClick={props.onEdit}>
        Edit setup
      </button>
      <PopButton label="Export results" title="Export" width={260} class="btn-secondary" button="Export ▾">
        {(close) => (
          <div class="cb-pe-menu">
            <button
              class="btn-secondary"
              onClick={() => {
                downloadText('peth_pairs.csv', pethCsv(o()), 'text/csv');
                close();
              }}
            >
              Results table (CSV)
            </button>
            <button
              class="btn-secondary"
              onClick={() => {
                downloadText('peth_curves.csv', pethCurvesCsv(o()), 'text/csv');
                close();
              }}
            >
              Mean curves (CSV)
            </button>
            <button
              class="btn-secondary"
              onClick={() => {
                downloadText('peth_run.json', JSON.stringify(pethMetadata(o()), null, 2), 'application/json');
                close();
              }}
            >
              Run settings (JSON)
            </button>
          </div>
        )}
      </PopButton>
    </div>
  );
}

/** What a run used and chose. Read only: changes go through Edit setup and a new run. */
function RunDetails(props: { out: PethOutcome; onClose: () => void }): JSX.Element {
  const o = () => props.out;
  const s = () => o().settings;
  const KV = (p: { k: string; v: JSX.Element }) => (
    <div class="cb-kv">
      <span>{p.k}</span>
      <span>{p.v}</span>
    </div>
  );
  const iv = (a: [number, number]) => `${a[0]} to ${a[1]} s`;
  return (
    <Modal title="Run details" onClose={props.onClose}>
      <p class="cb-muted">Settings and automatic choices. Use Edit setup to change them.</p>
      <div class="cb-ar-cols">
        <section>
          <h4>Inputs</h4>
          <KV k="Neural signal" v={`Smoothed deconvolved trace (a.u.), Gaussian smoothing σ = ${o().prep.eventSigmaS} s`} />
          <KV k="Cells analyzed" v={o().cellIds.length.toLocaleString()} />
          <KV k="Frames in recording" v={o().input.frames.toLocaleString()} />
          <KV k="Sampling rate" v={`${fmt(o().input.fs)} Hz`} />
          <KV k="Frames used" v="All (no frame selection)" />
          <button class="cb-link" onClick={() => goToStep('prep')}>
            Edit smoothing in Preprocess
          </button>
        </section>
        <section>
          <h4>Window</h4>
          <KV k="Full window" v={`${-o().params.preS} to ${o().params.postS} s`} />
          <KV k="Baseline" v={iv(o().params.baselineS)} />
          <KV k="Response" v={iv(o().params.responseS)} />
          <KV k="Bin size (display)" v={`${o().params.binS} s`} />
          <KV k="Subtract each onset's baseline (display)" v={o().params.baselineSubtract ? 'Yes' : 'No'} />
        </section>
        <section>
          <h4>Onsets</h4>
          <KV k="Source" v="Unpadded behavior frame labels" />
          <KV k="Minimum bout duration" v={`${o().params.minDurationS} s`} />
          <KV k="Minimum gap after previous bout" v={`${o().params.minGapS} s`} />
          <KV k="Minimum onsets per behavior" v={o().params.minEvents} />
          <table class="cb-auroc-table">
            <thead>
              <tr>
                <th>Behavior</th>
                <th>Bouts</th>
                <th>Included</th>
                <th title="Bout shorter than the minimum duration">Short</th>
                <th title="Gap after the previous bout under the minimum">Gap</th>
                <th title="Onset outside the selected frames">Frames</th>
                <th title="Window extends beyond the session">Edge</th>
              </tr>
            </thead>
            <tbody>
              <For each={o().reports}>
                {(r, b) => (
                  <tr>
                    <td>{o().labels[b()]}</td>
                    <td>{r.bouts}</td>
                    <td>{r.onsets.length}</td>
                    <td>{r.short}</td>
                    <td>{r.gap}</td>
                    <td>{r.outside}</td>
                    <td>{r.edge}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <p class="cb-muted">Each excluded bout is counted once, under the first reason that applies.</p>
        </section>
        <section>
          <h4>Shuffle test</h4>
          <Show when={hasTest(o())} fallback={<p class="cb-muted">Off: no p-values and no labels.</p>}>
            <KV k="Method" v="Circular shift of each cell's trace, onsets fixed" />
            <KV k="Minimum shift" v={`${o().minShiftS} s${o().timescale ? ' (auto)' : ' (manual)'}`} />
            <KV k="Shuffles" v={s().nShuffles.toLocaleString()} />
            <KV k="Unique shifts" v={o().uniqueShifts.toLocaleString()} />
            <KV k="Random seed" v={s().seed} />
            <KV k="Significance level" v={`α = ${s().alpha} (two-sided, adjusted p)`} />
            <KV
              k="Correction"
              v={
                s().correction === 'max_stat'
                  ? `Max-stat across the ${o().labels.length} selected behaviors within each cell, not across cells`
                  : 'None'
              }
            />
            <Show when={o().uniqueShifts < s().nShuffles}>
              <p class="cb-muted">
                Only {o().uniqueShifts.toLocaleString()} distinct shifts were possible; they were reused to make{' '}
                {s().nShuffles.toLocaleString()} shuffles.
              </p>
            </Show>
          </Show>
        </section>
        <section>
          <h4>Null band and latency (descriptive)</h4>
          <Show when={o().band} fallback={<p class="cb-muted">Off.</p>}>
            <KV k="Shifts" v={s().bandShifts} />
            <KV k="Random seed" v={s().bandSeed} />
            <KV k="Minimum shift" v={`${s().bandMinShiftS} s`} />
            <KV k="Latency" v={`first bin at or after 0 outside the band for ${s().latencyBins} bins in a row`} />
          </Show>
          <h4>Pre vs post Wilcoxon (descriptive)</h4>
          <KV k="Shown" v={s().wilcoxon ? 'Yes' : 'No'} />
        </section>
        <section>
          <h4>Not evaluated</h4>
          <KV
            k="Cells with non-finite neural values"
            v={o().cellsMissing.length ? o().cellsMissing.map((c) => o().cellIds[c] + 1).join(', ') : 'None'}
          />
          <KV
            k={`Behaviors with fewer than ${o().params.minEvents} onsets`}
            v={
              o()
                .reports.flatMap((r, b) => (r.onsets.length < o().params.minEvents ? [o().labels[b]] : []))
                .join(', ') || 'None'
            }
          />
        </section>
        <Show when={o().timescale}>
          {(t) => (
            <section>
              <h4>Calculation details</h4>
              <div class="cb-muted">
                <p>
                  Neural data decorrelates in {fmt(t().tauNeuralS)} s (median over cells) and behavior in{' '}
                  {fmt(t().tauBehaviorS)} s. {t().note}.
                </p>
              </div>
            </section>
          )}
        </Show>
      </div>
      <p class="cb-muted">
        Completed in {Math.max(1, Math.round(o().seconds))} s. Shifted values for a cell are recomputed from the stored
        shifts, so they are the draws the p-values came from.
      </p>
      <button
        class="btn-secondary"
        onClick={() => downloadText('peth_run.json', JSON.stringify(pethMetadata(o()), null, 2), 'application/json')}
      >
        Export run metadata
      </button>
    </Modal>
  );
}

export function PethResults(props: { out: PethOutcome; onEdit: () => void }): JSX.Element {
  const o = () => props.out;
  // Selection and sort live here, so no view loses them when another opens.
  const [view, setView] = createSignal<View>('population');
  const [details, setDetails] = createSignal(false);
  const firstReady = () => Math.max(0, o().reports.findIndex((r) => r.onsets.length >= o().params.minEvents));
  const [b, setB] = createSignal(firstReady());
  const [sort, setSort] = createSignal<CellSort>('response');
  const order = createMemo(() => sortCells(o(), b(), sort()));
  const [c, setC] = createSignal(order()[0] ?? 0);
  const ctx: Ctx = {
    get out() {
      return props.out;
    },
    get b() {
      return b();
    },
    get c() {
      return c();
    },
    setB,
    setC,
    get sort() {
      return sort();
    },
    setSort,
    get order() {
      return order();
    },
    openInspector: () => setView('inspector'),
    backToPopulation: () => setView('population'),
  };
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-results cb-ar cb-pe" ref={root}>
      <Header out={props.out} />
      <div class="cb-ar-tool">
        <div class="cb-seg" role="group" aria-label="Results view">
          <For each={VIEWS}>
            {([id, label]) => (
              <button classList={{ 'cb-seg__on': view() === id }} aria-pressed={view() === id} onClick={() => setView(id)}>
                {label}
              </button>
            )}
          </For>
        </div>
        <Actions out={props.out} onEdit={props.onEdit} onDetails={() => setDetails(true)} />
      </div>
      <div class="cb-pe-view">
        <Show when={view() === 'population'}>
          <PopulationView ctx={ctx} />
        </Show>
        <Show when={view() === 'inspector'}>
          <PethInspector ctx={ctx} />
        </Show>
        <Show when={view() === 'summary'}>
          <SummaryView out={props.out} />
        </Show>
      </div>
      <Show when={details()}>
        <RunDetails out={props.out} onClose={() => setDetails(false)} />
      </Show>
    </div>
  );
}
