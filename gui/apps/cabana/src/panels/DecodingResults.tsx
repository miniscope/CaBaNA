import { createMemo, For, Show, type JSX } from 'solid-js';
import { DEPARTURES, decodingBinsCsv, decodingFramesCsv, decodingMetadata } from '../lib/decoding-export.ts';
import type { DecodeOutcome } from '../lib/decoding-run.ts';
import { formatP, stateRows, summarizeRun } from '../lib/decoding-view.ts';
import { downloadText } from '../lib/place-export.ts';
import { goToStep } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { Modal } from './AurocResults.tsx';
import { DecodedTrace, ErrorHistogram, ErrorMap, selectedBin, setSelectedBin, TimeControls } from './DecodingPlots.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PlotCard, PopButton } from './QcParts.tsx';
import { onCleanup, onMount, createSignal } from 'solid-js';

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

const STATUS_TEXT = {
  significant: '✓ Significant',
  'not significant': 'Not significant',
  untested: 'Not tested',
  'not evaluated': 'Not evaluated',
} as const;

function Stat(props: { label: string; value: JSX.Element; note?: JSX.Element; tip?: JSX.Element }): JSX.Element {
  return (
    <div class="cb-dec-stat">
      <div class="cb-dec-stat__label">
        {props.label}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.label}`}>{props.tip}</InfoTip>
        </Show>
      </div>
      <div class="cb-dec-stat__value">{props.value}</div>
      <Show when={props.note}>
        <div class="cb-muted cb-dec-stat__note">{props.note}</div>
      </Show>
    </div>
  );
}

function Summary(props: { out: DecodeOutcome }): JSX.Element {
  const o = () => props.out;
  const sum = createMemo(() => summarizeRun(o()));
  const t = () => o().test;
  const corrected = () => (o().settings.correction === 'max_stat' ? 'max-stat corrected' : 'uncorrected');
  return (
    <div class="cb-dec-summary">
      <Stat
        label="Median decoding error"
        value={`${fmt(o().observed.errorOverall)} cm`}
        note={`chance ${fmt(o().observed.chanceError)} cm (always guessing the most visited bin)`}
        tip={
          <>
            The distance between the centre of the decoded bin and the centre of the true bin, taken over every held-out
            frame; the middle value. Smaller is better. Chance is the same median when the most visited bin of the
            training folds is guessed for every frame.
          </>
        }
      />
      <Stat
        label="Overall test"
        value={t() ? `p ${formatP(t()!.pOverall, o().settings.nShuffles)}` : 'Not tested'}
        note={t() ? 'extension to the framework' : 'shuffle test is off'}
        tip={
          <>
            The median error of the real labels is compared with the median error of the same decoder run on every
            shuffled labelling (lower tail). This overall test is an extension to the framework, which tests each bin
            only, and it is separate from the per-bin correction.
          </>
        }
      />
      <Stat
        label="Bins evaluated"
        value={`${sum().evaluated}`}
        note={`${sum().notEvaluated} not evaluated (under ${o().params.minFramesPerClass} frames)${t() ? ` · ${sum().significant} significant, ${corrected()}` : ''}`}
      />
      <Stat
        label="Frames"
        value={`${sum().decodedFrames.toLocaleString()}`}
        note={`decoded of ${sum().usedFrames.toLocaleString()} used · ${o().params.nFolds} contiguous folds`}
      />
      <Stat label="Mean posterior confidence" value={fmt(o().observed.meanConfidence, 2)} note={`within-bin accuracy ${fmt(o().observed.accuracyOverall * 100, 1)}%`} />
    </div>
  );
}

function BinTable(props: { out: DecodeOutcome }): JSX.Element {
  const rows = createMemo(() => stateRows(props.out));
  return (
    <div class="cb-dec-tablewrap">
      <table class="cb-auroc-table cb-as-tbl">
        <thead>
          <tr>
            <th>Bin (col, row)</th>
            <th class="cb-as-num">Frames</th>
            <th class="cb-as-num">Median error (cm)</th>
            <th class="cb-as-num">p</th>
            <th class="cb-as-num">p {props.out.settings.correction === 'max_stat' ? '(max-stat)' : '(uncorrected)'}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(r) => (
              <tr
                classList={{ 'cb-dec-sel': selectedBin() === r.state, 'cb-muted': r.status === 'not evaluated' }}
                onClick={() => setSelectedBin(selectedBin() === r.state ? undefined : r.state)}
              >
                <td>
                  {r.col}, {r.row}
                </td>
                <td class="cb-as-num">{r.frames}</td>
                <td class="cb-as-num">{fmt(r.value)}</td>
                <td class="cb-as-num">{formatP(r.pRaw, props.out.settings.nShuffles)}</td>
                <td class="cb-as-num">{formatP(r.pAdj, props.out.settings.nShuffles)}</td>
                <td>{STATUS_TEXT[r.status]}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function RunDetails(props: { out: DecodeOutcome; onClose: () => void }): JSX.Element {
  const o = () => props.out;
  const s = () => o().settings;
  const p = () => o().params;
  const KV = (q: { k: string; v: JSX.Element }) => (
    <div class="cb-kv">
      <span>{q.k}</span>
      <span>{q.v}</span>
    </div>
  );
  return (
    <Modal title="Run details" onClose={props.onClose}>
      <p class="cb-muted">Settings and choices of this run. Use Edit setup to change them.</p>
      <div class="cb-ar-cols">
        <section>
          <h4>Inputs</h4>
          <KV k="Neural input" v="Unsmoothed deconvolved events, binarized (above 0 is 1), whatever the Preprocess smoothing" />
          <KV k="Cells" v={o().data.cellIds.length} />
          <KV k="Sampling rate" v={`${fmt(o().data.input.fs, 2)} Hz`} />
          <KV k="Frames used" v={`${o().observed.usedFrames.length.toLocaleString()} of ${o().data.input.frames.toLocaleString()}`} />
          <KV k="Spatial bin" v={`${o().binCm} cm`} />
          <KV k="Speed filter" v={`${o().prep.minSpeed} cm/s (Preprocess)`} />
          <button class="cb-link" onClick={() => goToStep('prep')}>
            Edit in Preprocess
          </button>
        </section>
        <section>
          <h4>Decoder</h4>
          <KV k="Likelihood" v={p().likelihood === 'gaussian' ? 'Gaussian (Shuman et al. 2020)' : 'Poisson (Zhang et al. 1998)'} />
          <Show when={p().likelihood === 'gaussian'}>
            <KV k="Sigma" v={p().sigma === 'per_state' ? 'Per bin and cell' : 'Pooled: one per cell'} />
          </Show>
          <KV k="Integration window" v={`${p().windowS} s, centred, clipped at the fold boundary`} />
          <KV k="Map smoothing" v={p().smoothSigmaBins ? `${p().smoothSigmaBins} bins` : 'Off'} />
          <KV k="Prior" v={p().prior === 'occupancy' ? 'Training occupancy' : 'Uniform'} />
          <KV k="Folds" v={`${p().nFolds}, contiguous blocks of time`} />
          <KV k="Minimum frames per bin" v={p().minFramesPerClass} />
          <p class="cb-muted">
            Map means and s.d., smoothing and the occupancy prior come from the training folds only.
          </p>
        </section>
        <section>
          <h4>Shuffle test</h4>
          <Show when={o().test} fallback={<p class="cb-muted">Off: no p-values.</p>}>
            <KV k="Method" v="Label shuffle: labels permuted in blocks, neural data untouched" />
            <KV k="Block length" v={`${s().blockS} s (${o().blockFrames} frames)`} />
            <KV k="Shuffles" v={s().nShuffles.toLocaleString()} />
            <KV k="Random seed" v={s().seed} />
            <KV k="Significance level" v={`α = ${s().alpha} (lower tail)`} />
            <KV
              k="Correction"
              v={
                s().correction === 'max_stat'
                  ? 'Max-stat (min-p) across the tested bins of this run'
                  : 'None: p-values are uncorrected'
              }
            />
            <p class="cb-muted">
              The block length and shuffle count are a starting preset, not validated optima.
            </p>
          </Show>
        </section>
        <section>
          <h4>Differences from the framework</h4>
          <ul>
            <For each={DEPARTURES}>{(d) => <li>{d}</li>}</For>
          </ul>
          <p class="cb-muted">
            Framework: miniscope/CaBaNA framework-demo, commit 57c0c4b. Run time {fmt(o().seconds, 1)} s.
          </p>
        </section>
      </div>
    </Modal>
  );
}

const HELP_MAP = (
  <>
    <p>
      The arena, divided into spatial bins. Each visited bin is shaded by the median decoding error of the frames the
      animal spent there (cm); darker is worse. The scale runs from 0 to the 95th percentile of the bins.
    </p>
    <p>
      A dot marks a bin that is significant ({'p ≤ α'}, adjusted as set in the run). Hatched bins had too few frames to be
      evaluated. White bins were not visited. Click a bin to highlight it in the table.
    </p>
    <p>A bin with few frames has a noisy median. Significance asks whether the decoder beats shuffled labels in that bin.</p>
  </>
);
const HELP_HIST = (
  <>
    <p>
      How far the decoded bin was from the true bin, for every held-out frame (cm). The solid line is the median; the
      dashed line is the median error when the most visited bin of the training folds is guessed for every frame.
    </p>
    <p>A median well to the left of the dashed line means the neural data carry position beyond occupancy.</p>
  </>
);
const HELP_TRACE = (
  <>
    <p>
      The gray line is the true x and y of the used frames; blue dots are the decoded bin centres. Both are in cm, in
      steps of one spatial bin for the decoded position. Dashed vertical lines are fold boundaries: each fold was
      decoded by a model trained on the other folds.
    </p>
    <p>Use the window and slider above to move through the session. Gaps are frames that are not used.</p>
  </>
);

export function DecodingResults(props: { out: DecodeOutcome; onEdit: () => void }): JSX.Element {
  const o = () => props.out;
  const [details, setDetails] = createSignal(false);
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-place cb-dec-results" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Decoding: position</h2>
          <p class="cb-muted">
            Bayesian decoder, {o().params.likelihood === 'gaussian' ? 'Gaussian' : 'Poisson'} likelihood; each frame decoded by a model trained on the other folds.
          </p>
        </div>
        <div class="cb-controls">
          <button class="btn-secondary" aria-haspopup="dialog" onClick={() => setDetails(true)}>
            Run details
          </button>
          <button class="btn-secondary" onClick={props.onEdit}>
            Edit setup
          </button>
          <PopButton label="Export results" title="Export" width={260} class="btn-secondary" button="Export ▾">
            {(close) => (
              <div class="cb-pe-menu">
                <button class="btn-secondary" onClick={() => (downloadText('decoding_bins.csv', decodingBinsCsv(o()), 'text/csv'), close())}>
                  Per-bin results (CSV)
                </button>
                <button class="btn-secondary" onClick={() => (downloadText('decoding_frames.csv', decodingFramesCsv(o()), 'text/csv'), close())}>
                  Decoded frames (CSV)
                </button>
                <button class="btn-secondary" onClick={() => (downloadText('decoding_run.json', JSON.stringify(decodingMetadata(o()), null, 2), 'application/json'), close())}>
                  Run settings (JSON)
                </button>
              </div>
            )}
          </PopButton>
        </div>
      </div>
      <Show when={!o().test}>
        <div class="cb-note">The shuffle test was off: there are no p-values, so no bin is called significant.</div>
      </Show>
      <Show when={o().test && o().settings.nShuffles < 200}>
        <div class="cb-note">
          Quick preview: {o().settings.nShuffles} shuffles. The smallest possible p-value is{' '}
          {formatP(1 / (o().settings.nShuffles + 1), o().settings.nShuffles).replace('< ', '')}; use more shuffles for results to report.
        </div>
      </Show>
      <Summary out={o()} />
      <div class="cb-dec-grid">
        <PlotCard class="cb-dec-map" title="Median error per spatial bin" help={HELP_MAP}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><ErrorMap out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <PlotCard class="cb-dec-hist" title="Decoding error" help={HELP_HIST}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><ErrorHistogram out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <PlotCard class="cb-dec-trace" title="Decoded and true position" help={HELP_TRACE} tools={<TimeControls />}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><DecodedTrace out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <section class="cb-plot cb-dec-table">
          <div class="cb-plot__head">
            <h3>Per-bin results</h3>
          </div>
          <BinTable out={o()} />
        </section>
      </div>
      <Show when={details()}>
        <RunDetails out={o()} onClose={() => setDetails(false)} />
      </Show>
    </div>
  );
}
