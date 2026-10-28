// The Behavior target of the Decoding page: setup (behaviors, priority order, overlaps, decoder, test) and results.

import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { annotatedBehaviors, behaviorDecodeData, orderOf, OTHER_NAME } from '../lib/decode-data.ts';
import { behaviorConfusionCsv, behaviorMetadata, behaviorStatesCsv, DEPARTURES } from '../lib/decoding-export.ts';
import {
  behaviorOutcome,
  behaviorRunIssue,
  behaviorShowResults,
  cancelDecodeRun,
  decodeSettings,
  decodeStatus,
  DEFAULT_DECODE_SETTINGS,
  runBehaviorDecoding,
  setBehaviorShowResults,
  setDecodeSettings,
  type BehaviorOutcome,
} from '../lib/decoding-run.ts';
import {
  behaviorRows,
  behaviorSettingChanges,
  confusionShares,
  formatP,
  summarizeBehavior,
} from '../lib/decoding-view.ts';
import { downloadText } from '../lib/place-export.ts';
import { goToStep } from '../lib/store.ts';
import { Modal } from './AurocResults.tsx';
import { behaviorColor } from './AurocPanel.tsx';
import { Choice, InputNote, PresetBar, Row, TargetSelector, TestSection } from './DecodingParts.tsx';
import { Stat } from './DecodingResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PlotCard, PopButton } from './QcParts.tsx';

const D = DEFAULT_DECODE_SETTINGS;
const B = () => decodeSettings.behavior;
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');

// ---- setup -----------------------------------------------------------------------------------

function BehaviorSetup(): JSX.Element {
  const loaded = createMemo(() => annotatedBehaviors());
  const order = createMemo(() => {
    const l = loaded();
    return 'error' in l ? [] : orderOf(l.labels, B().order);
  });
  const data = createMemo(() => behaviorDecodeData({ order: B().order, unselected: [...B().unselected], other: B().other }));
  const ok = () => {
    const d = data();
    return d && !('error' in d) ? d : undefined;
  };
  const error = () => {
    const s = decodeStatus();
    return s.kind === 'error' ? s.message : undefined;
  };
  const running = () => {
    const s = decodeStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const issue = () => behaviorRunIssue(data(), decodeSettings);
  const changes = () => behaviorSettingChanges();
  const chosen = (l: string) => !B().unselected.includes(l);
  const toggle = (l: string) =>
    setDecodeSettings('behavior', 'unselected', chosen(l) ? [...B().unselected, l] : B().unselected.filter((x) => x !== l));
  const move = (l: string, by: -1 | 1) => {
    const o = [...order()];
    const i = o.indexOf(l);
    const j = i + by;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setDecodeSettings('behavior', 'order', o);
  };
  /** Frames of a behavior as annotated, and after overlaps are resolved. */
  const rawFrames = (l: string) => {
    const x = loaded();
    if ('error' in x) return 0;
    const row = x.labels.indexOf(l);
    let n = 0;
    for (let t = 0; t < x.frames; t++) n += x.rows[row * x.frames + t];
    return n;
  };
  const finalFrames = (l: string) => {
    const d = ok();
    const i = d ? d.names.indexOf(l) : -1;
    return d && i >= 0 ? d.overlap.final[i] : 0;
  };
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  return (
    <div class="cb-place cb-as cb-dec-setup" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Decoding</h2>
          <p class="cb-muted">
            Predict which behavior is happening from the neural data of all cells together, on held-out blocks of time.
          </p>
        </div>
        <TargetSelector />
        <div class="cb-controls">
          <Show when={behaviorOutcome()}>
            <button class="btn-secondary" onClick={() => setBehaviorShowResults(true)}>
              {changes().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>
      <Show when={behaviorOutcome() && changes().length}>
        <div class="cb-muted">Changed since the last run: {changes().join(', ')}. Run again to update.</div>
      </Show>
      <Show when={error()}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ok()}>
        <div class="cb-empty">
          {data() ? (data() as { error: string }).error : 'Behavior decoding needs deconvolved events, behavior annotations and neural timestamps.'}{' '}
          <button class="cb-link" onClick={() => goToStep('load')}>
            Load data
          </button>
        </div>
      </Show>
      <Show when={ok()}>
        <InputNote cells={ok()!.input.cells} />
        <PresetBar>
          integration window {D.behavior.windowS} s, {D.blockS} s blocks, {D.nShuffles.toLocaleString()} shuffles.
        </PresetBar>
        <div class="cb-pe-body">
          <section class="cb-setgroup cb-pe-left">
            <h3>1 · Behaviors and overlaps</h3>
            <p class="cb-muted cb-pe-small">
              The decoder needs one behavior per frame. Where selected behaviors overlap, the one higher in this list wins. The
              order starts as the loaded order; move a behavior to change who wins.
            </p>
            <div class="cb-pe-tablewrap">
              <table class="cb-auroc-table cb-as-tbl cb-pe-tbl">
                <thead>
                  <tr>
                    <th aria-label="Selected" />
                    <th>Priority</th>
                    <th>Behavior</th>
                    <th class="cb-as-num">Annotated frames</th>
                    <th class="cb-as-num">Frames used</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={order()}>
                    {(l, i) => (
                      <tr classList={{ 'cb-muted': !chosen(l) }}>
                        <td>
                          <input type="checkbox" aria-label={`Include ${l}`} checked={chosen(l)} onChange={() => toggle(l)} />
                        </td>
                        <td class="cb-dec-move">
                          {i() + 1}{' '}
                          <button class="cb-ib" aria-label={`Move ${l} up`} disabled={i() === 0} onClick={() => move(l, -1)}>
                            ↑
                          </button>
                          <button class="cb-ib" aria-label={`Move ${l} down`} disabled={i() === order().length - 1} onClick={() => move(l, 1)}>
                            ↓
                          </button>
                        </td>
                        <td>
                          <span class="cb-dot" style={{ background: behaviorColor(i()) }} /> {l}
                        </td>
                        <td class="cb-as-num">{rawFrames(l)}</td>
                        <td class="cb-as-num">{chosen(l) ? finalFrames(l) : '–'}</td>
                        <td>
                          {!chosen(l)
                            ? 'Left out'
                            : finalFrames(l) < B().minFrames
                              ? `Not evaluated: under ${B().minFrames} frames`
                              : '✓ Ready'}
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={B().other}>
                    <tr>
                      <td />
                      <td>last</td>
                      <td>{OTHER_NAME}</td>
                      <td class="cb-as-num">–</td>
                      <td class="cb-as-num">{ok()!.overlap.final[ok()!.overlap.final.length - 1]}</td>
                      <td>{ok()!.overlap.final[ok()!.overlap.final.length - 1] < B().minFrames ? `Not evaluated: under ${B().minFrames} frames` : '✓ Ready'}</td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
            <label class="cb-as-check cb-pe-small">
              <input type="checkbox" checked={B().other} onChange={(e) => setDecodeSettings('behavior', 'other', e.currentTarget.checked)} />
              Add the state "{OTHER_NAME}"
              <InfoTip label="About the Other state">
                Frames inside the annotated span (from the first bout to the end of the last) with none of the selected behaviors
                become one more state. When off, those frames are left out of training and testing.
              </InfoTip>
            </label>
            <div class="cb-dec-counts">
              <b>{ok()!.overlap.overlapping.toLocaleString()}</b> frames have two or more selected behaviors.
              <Show when={ok()!.overlap.pairs.length}>
                {' '}
                Largest overlaps:{' '}
                {ok()!.overlap.pairs
                  .slice(0, 3)
                  .map((p) => `${ok()!.names[p.winner]} wins over ${ok()!.names[p.loser]} (${p.frames.toLocaleString()} frames)`)
                  .join('; ')}
                .
              </Show>
            </div>
          </section>

          <section class="cb-setgroup cb-pe-right">
            <h3>2 · Bayesian decoder</h3>
            <Row label="Likelihood" tip="Gaussian: Shuman et al. 2020, the lab's decoder. Poisson: independent Poisson cells, Zhang et al. 1998.">
              <Choice label="Likelihood" value={B().likelihood} options={[['gaussian', 'Gaussian'], ['poisson', 'Poisson']]} onSet={(v) => setDecodeSettings('behavior', 'likelihood', v)} />
            </Row>
            <Show when={B().likelihood === 'gaussian'}>
              <Row
                label="Sigma"
                tip="Sigma is the spread of a cell's mean value across training blocks. It sets how much a deviation from the expected value counts against a behavior. Behaviors use one pooled sigma per cell, because with behavior-specific sigma rare behaviors get a wide, flat likelihood and are decoded too often."
              >
                <span class="cb-pe-small">Pooled (one per cell)</span>
              </Row>
            </Show>
            <Row
              label="Integration window"
              tip="Each frame is decoded from the mean of the binarized events in a window centred on it, using frames of the same fold only. 0 uses a single frame."
            >
              <NumField label="Integration window (s)" value={B().windowS} def={D.behavior.windowS} min={0} step={0.05} unit="s" onSet={(v) => setDecodeSettings('behavior', 'windowS', Math.max(0, v))} />
            </Row>
            <Row label="Prior" tip="Occupancy: behaviors that take more frames in the training folds are more likely. Uniform: every behavior is equally likely.">
              <Choice label="Prior" value={B().prior} options={[['occupancy', 'Occupancy'], ['uniform', 'Uniform']]} onSet={(v) => setDecodeSettings('behavior', 'prior', v)} />
            </Row>
            <Row label="Folds" tip="The labeled frames are cut into this many contiguous blocks of time. Each block is decoded by a model trained on the others.">
              <NumField label="Folds" value={B().nFolds} def={D.behavior.nFolds} min={2} step={1} onSet={(v) => setDecodeSettings('behavior', 'nFolds', Math.max(2, Math.round(v)))} />
            </Row>
            <Row label="Minimum frames per behavior" tip="A behavior with fewer frames is not decoded and shows as Not evaluated.">
              <NumField label="Minimum frames per behavior" value={B().minFrames} def={D.behavior.minFrames} min={1} step={1} onSet={(v) => setDecodeSettings('behavior', 'minFrames', Math.max(1, Math.round(v)))} />
            </Row>
            <TestSection what="behavior" />
          </section>
        </div>

        <div class="cb-pe-foot">
          <span class="cb-pe-foot__text">
            <Show
              when={!running()}
              fallback={
                <>
                  <progress class="cb-progress" value={running()!.done} max={running()!.total} />
                  <span class="cb-muted">{running()!.step}</span>
                </>
              }
            >
              <Show when={issue()} fallback={<span class="cb-muted">Held-out blocks: each fold is decoded by a model trained on the others.</span>}>
                <span class="cb-muted">{issue()}</span>
              </Show>
            </Show>
          </span>
          <Show when={!running()} fallback={<button class="btn-secondary" onClick={cancelDecodeRun}>Cancel</button>}>
            <button class="btn-primary" disabled={!!issue()} onClick={() => void runBehaviorDecoding()}>
              {behaviorOutcome() ? 'Run again' : 'Run analysis'} ▶
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---- plots -----------------------------------------------------------------------------------

const [selected, setSelected] = createSignal<number | undefined>();

/** Share of each true behavior's frames decoded as each behavior; rows true, columns decoded. */
function Confusion(props: { out: BehaviorOutcome; w: number; h: number }): JSX.Element {
  const names = () => props.out.data.names;
  const n = () => names().length;
  const shares = createMemo(() => confusionShares(props.out));
  const left = 96;
  const top = 64;
  const cell = () => Math.max(14, Math.min((props.w - left - 8) / n(), (props.h - top - 24) / n()));
  const short = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="Confusion matrix">
      <text x={left + (cell() * n()) / 2} y={12} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Decoded as
      </text>
      <text transform={`translate(10,${top + (cell() * n()) / 2}) rotate(-90)`} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        True behavior
      </text>
      <For each={names()}>
        {(name, c) => (
          <text transform={`translate(${left + c() * cell() + cell() / 2},${top - 4}) rotate(-35)`} font-size="10" fill="var(--text-primary)">
            {short(name)}
          </text>
        )}
      </For>
      <For each={names()}>
        {(name, r) => (
          <>
            <text x={left - 4} y={top + r() * cell() + cell() / 2 + 3} text-anchor="end" font-size="10" fill="var(--text-primary)">
              {short(name)}
            </text>
            <For each={names()}>
              {(_, c) => {
                const v = () => shares()[r() * n() + c()];
                return (
                  <g onClick={() => setSelected(selected() === r() ? undefined : r())}>
                    <rect
                      x={left + c() * cell()}
                      y={top + r() * cell()}
                      width={cell()}
                      height={cell()}
                      fill={Number.isFinite(v()) ? `rgba(18,74,160,${0.08 + 0.92 * v()})` : '#f1f1f1'}
                      stroke={r() === c() ? 'var(--text-primary)' : 'var(--border-subtle)'}
                    >
                      <title>{`${name} decoded as ${names()[c()]}: ${Number.isFinite(v()) ? `${(v() * 100).toFixed(1)}% of ${name} frames` : 'not evaluated'}`}</title>
                    </rect>
                    <Show when={Number.isFinite(v())}>
                      <text x={left + c() * cell() + cell() / 2} y={top + r() * cell() + cell() / 2 + 3} text-anchor="middle" font-size="10" fill={v() > 0.5 ? '#fff' : '#222'} pointer-events="none">
                        {(v() * 100).toFixed(0)}
                      </text>
                    </Show>
                  </g>
                );
              }}
            </For>
          </>
        )}
      </For>
    </svg>
  );
}

/** Recall of each behavior with the 95th percentile of its shuffled recalls and the chance level. */
function RecallBars(props: { out: BehaviorOutcome; w: number; h: number }): JSX.Element {
  const rows = createMemo(() => behaviorRows(props.out));
  const left = 120;
  const rowH = () => Math.min(34, (props.h - 36) / Math.max(1, rows().length));
  const x = (v: number) => left + v * (props.w - left - 16);
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="Recall per behavior">
      <For each={[0, 0.25, 0.5, 0.75, 1]}>
        {(g) => (
          <>
            <line x1={x(g)} x2={x(g)} y1={4} y2={4 + rows().length * rowH()} stroke="var(--border-subtle)" />
            <text x={x(g)} y={4 + rows().length * rowH() + 14} text-anchor="middle" font-size="10" fill="var(--text-secondary)">
              {g}
            </text>
          </>
        )}
      </For>
      <For each={rows()}>
        {(r, i) => (
          <g onClick={() => setSelected(selected() === i() ? undefined : i())}>
            <text x={left - 6} y={4 + i() * rowH() + rowH() / 2 + 3} text-anchor="end" font-size="11" fill="var(--text-primary)">
              {r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}
            </text>
            <Show
              when={r.status !== 'not evaluated'}
              fallback={
                <text x={left + 4} y={4 + i() * rowH() + rowH() / 2 + 3} font-size="10" fill="var(--text-secondary)">
                  Not evaluated
                </text>
              }
            >
              <rect x={left} y={4 + i() * rowH() + 4} width={Math.max(1, x(r.value) - left)} height={rowH() - 8} fill={behaviorColor(i())} opacity={selected() === i() ? 1 : 0.85} />
              <Show when={Number.isFinite(r.nullHi)}>
                <line x1={x(r.nullHi)} x2={x(r.nullHi)} y1={4 + i() * rowH() + 2} y2={4 + (i() + 1) * rowH() - 2} stroke="#222" stroke-width="2" stroke-dasharray="3 2" />
              </Show>
              <text x={Math.min(x(r.value) + 4, props.w - 34)} y={4 + i() * rowH() + rowH() / 2 + 3} font-size="10" fill="var(--text-primary)">
                {fmt(r.value)}
              </text>
            </Show>
          </g>
        )}
      </For>
      <text x={left + (props.w - left - 16) / 2} y={props.h - 2} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Recall (share of the behavior's frames decoded as it)
      </text>
    </svg>
  );
}

/** True and decoded behavior along the session, one strip each, colored by behavior. */
function LabelTimeline(props: { out: BehaviorOutcome; w: number; h: number }): JSX.Element {
  const ob = () => props.out.observed;
  const frames = () => props.out.data.input.frames;
  const left = 56;
  const stripH = () => Math.max(10, (props.h - 40) / 2 - 4);
  const x = (t: number) => left + (t / frames()) * (props.w - left - 8);
  /** Runs of equal state over the used frames, so a strip draws a few hundred rectangles, not every frame. */
  const runs = (get: (t: number) => number) => {
    const out: { a: number; b: number; s: number }[] = [];
    let cur: { a: number; b: number; s: number } | undefined;
    for (const t of ob().usedFrames) {
      const s = get(t);
      if (s < 0) continue;
      if (cur && cur.s === s && t - cur.b <= 1) cur.b = t;
      else out.push((cur = { a: t, b: t, s }));
    }
    return out;
  };
  const truth = createMemo(() => runs((t) => props.out.data.input.labels[t]));
  const decoded = createMemo(() => runs((t) => ob().decoded[t]));
  const edges = createMemo(() => {
    const e: number[] = [];
    ob().folds.forEach((f, j) => {
      if (j > 0 && f !== ob().folds[j - 1]) e.push(ob().usedFrames[j]);
    });
    return e;
  });
  const strip = (runsList: { a: number; b: number; s: number }[], y: number) => (
    <For each={runsList}>
      {(r) => <rect x={x(r.a)} y={y} width={Math.max(1, x(r.b + 1) - x(r.a))} height={stripH()} fill={behaviorColor(r.s)} />}
    </For>
  );
  return (
    <svg width={props.w} height={props.h} role="img" aria-label="True and decoded behavior over time">
      <text x={left - 4} y={8 + stripH() / 2} text-anchor="end" font-size="11" fill="var(--text-primary)">
        True
      </text>
      <text x={left - 4} y={8 + stripH() + 6 + stripH() / 2} text-anchor="end" font-size="11" fill="var(--text-primary)">
        Decoded
      </text>
      {strip(truth(), 4)}
      {strip(decoded(), 4 + stripH() + 6)}
      <For each={edges()}>
        {(t) => <line x1={x(t)} x2={x(t)} y1={0} y2={8 + 2 * stripH()} stroke="#555" stroke-dasharray="4 3" />}
      </For>
      <For each={[0, 0.25, 0.5, 0.75, 1]}>
        {(g) => (
          <text x={x(g * frames())} y={props.h - 16} text-anchor="middle" font-size="10" fill="var(--text-secondary)">
            {fmt((g * frames()) / props.out.data.input.fs, 0)}
          </text>
        )}
      </For>
      <text x={left + (props.w - left) / 2} y={props.h - 2} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
        Time (s)
      </text>
    </svg>
  );
}

// ---- results ---------------------------------------------------------------------------------

const HELP_CONF = (
  <>
    <p>
      Each row is a true behavior; each column is what the decoder chose for those frames. The number is the percent of the
      row's frames, so every row sums to 100. The diagonal (outlined) is recall. Gray rows were not evaluated.
    </p>
    <p>Large off-diagonal values show which behaviors the neural data confuse. Click a row to highlight the behavior.</p>
  </>
);
const HELP_RECALL = (
  <>
    <p>
      Recall of each behavior: the share of its held-out frames decoded as that behavior. The dashed line is the 95th
      percentile of the recalls obtained with shuffled labels, the range expected without a link between neural data and
      behavior. Recall above it supports a real relationship.
    </p>
    <p>
      Recall is not corrected for how common a behavior is. The overall value is balanced accuracy, the mean recall over the
      evaluated behaviors.
    </p>
  </>
);
const HELP_TIME = (
  <>
    <p>
      The upper strip is the behavior on each labeled frame; the lower strip is what the decoder chose. Colors match the
      other plots. Dashed lines are fold boundaries: each fold was decoded by a model trained on the other folds. Frames
      that were left out are blank.
    </p>
  </>
);

function BehaviorResults(props: { out: BehaviorOutcome; onEdit: () => void }): JSX.Element {
  const o = () => props.out;
  const rows = createMemo(() => behaviorRows(o()));
  const sum = createMemo(() => summarizeBehavior(o()));
  const [details, setDetails] = createSignal(false);
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const t = () => o().test;
  const status = {
    significant: '✓ Significant',
    'not significant': 'Not significant',
    untested: 'Not tested',
    'not evaluated': 'Not evaluated',
  };
  return (
    <div class="cb-place cb-dec-results" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Decoding: behavior</h2>
          <p class="cb-muted">
            Bayesian decoder, {o().params.likelihood === 'gaussian' ? 'Gaussian (pooled sigma)' : 'Poisson'} likelihood; each frame
            decoded by a model trained on the other folds.
          </p>
        </div>
        <TargetSelector />
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
                <button class="btn-secondary" onClick={() => (downloadText('decoding_behaviors.csv', behaviorStatesCsv(o()), 'text/csv'), close())}>
                  Per-behavior results (CSV)
                </button>
                <button class="btn-secondary" onClick={() => (downloadText('decoding_confusion.csv', behaviorConfusionCsv(o()), 'text/csv'), close())}>
                  Confusion matrix (CSV)
                </button>
                <button class="btn-secondary" onClick={() => (downloadText('decoding_behavior_run.json', JSON.stringify(behaviorMetadata(o()), null, 2), 'application/json'), close())}>
                  Run settings (JSON)
                </button>
              </div>
            )}
          </PopButton>
        </div>
      </div>
      <Show when={!t()}>
        <div class="cb-note">The shuffle test was off: there are no p-values, so no behavior is called significant.</div>
      </Show>
      <Show when={t() && o().settings.nShuffles < 200}>
        <div class="cb-note">
          Quick preview: {o().settings.nShuffles} shuffles. The smallest possible p-value is {(1 / (o().settings.nShuffles + 1)).toFixed(4)}; use
          more shuffles for results to report.
        </div>
      </Show>
      <div class="cb-dec-summary">
        <Stat
          label="Balanced accuracy"
          value={fmt(sum().balancedAccuracy)}
          note={`mean recall over ${sum().evaluated} behaviors; chance for equal guessing ${fmt(sum().chance)}`}
          tip="The mean of the recalls of the evaluated behaviors, so a common behavior does not dominate. It is the overall result."
        />
        <Stat
          label="Overall test"
          value={t() ? `p ${formatP(t()!.pOverall, o().settings.nShuffles)}` : 'Not tested'}
          note={t() ? 'extension to the framework' : 'shuffle test is off'}
          tip="The balanced accuracy of the real labels is compared with that of every shuffled labelling (upper tail). It is an extension to the framework, which tests each behavior only, and it is not part of the per-behavior correction."
        />
        <Stat
          label="Behaviors evaluated"
          value={`${sum().evaluated}`}
          note={`${sum().notEvaluated} not evaluated (under ${o().params.minFramesPerClass} frames)${t() ? ` · ${sum().significant} significant, ${o().settings.correction === 'max_stat' ? 'max-stat corrected' : 'uncorrected'}` : ''}`}
        />
        <Stat label="Frames" value={sum().decodedFrames.toLocaleString()} note={`decoded of ${sum().labeledFrames.toLocaleString()} labeled · ${o().params.nFolds} contiguous folds`} />
        <Stat label="Mean posterior confidence" value={fmt(o().observed.meanConfidence)} note={`accuracy over all frames ${fmt(o().observed.accuracyOverall * 100, 1)}%`} />
      </div>
      <div class="cb-dec-grid cb-dec-grid--beh">
        <PlotCard class="cb-dec-map" title="Confusion matrix" help={HELP_CONF}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><Confusion out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <PlotCard class="cb-dec-hist" title="Recall per behavior" help={HELP_RECALL}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><RecallBars out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <PlotCard class="cb-dec-trace" title="True and decoded behavior" help={HELP_TIME}>
          {(size) => <Show when={size().w > 0 && size().h > 0}><LabelTimeline out={o()} w={size().w} h={size().h} /></Show>}
        </PlotCard>
        <section class="cb-plot cb-dec-table">
          <div class="cb-plot__head">
            <h3>Per-behavior results</h3>
          </div>
          <div class="cb-dec-tablewrap">
            <table class="cb-auroc-table cb-as-tbl">
              <thead>
                <tr>
                  <th>Behavior</th>
                  <th class="cb-as-num">Frames</th>
                  <th class="cb-as-num">Recall</th>
                  <th class="cb-as-num">Null 95th pct</th>
                  <th class="cb-as-num">p</th>
                  <th class="cb-as-num">p {o().settings.correction === 'max_stat' ? '(max-stat)' : '(uncorrected)'}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r, i) => (
                    <tr classList={{ 'cb-dec-sel': selected() === i(), 'cb-muted': r.status === 'not evaluated' }} onClick={() => setSelected(selected() === i() ? undefined : i())}>
                      <td>
                        <span class="cb-dot" style={{ background: behaviorColor(i()) }} /> {r.name}
                      </td>
                      <td class="cb-as-num">{r.frames}</td>
                      <td class="cb-as-num">{fmt(r.value)}</td>
                      <td class="cb-as-num">{fmt(r.nullHi)}</td>
                      <td class="cb-as-num">{formatP(r.pRaw, o().settings.nShuffles)}</td>
                      <td class="cb-as-num">{formatP(r.pAdj, o().settings.nShuffles)}</td>
                      <td>{status[r.status]}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <Show when={details()}>
        <BehaviorDetails out={o()} onClose={() => setDetails(false)} />
      </Show>
    </div>
  );
}

function BehaviorDetails(props: { out: BehaviorOutcome; onClose: () => void }): JSX.Element {
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
          <KV k="Sampling rate" v={`${fmt(o().data.fs)} Hz`} />
          <KV k="Labeled frames" v={`${o().observed.usedFrames.length.toLocaleString()} of ${o().data.input.frames.toLocaleString()}`} />
          <button class="cb-link" onClick={() => goToStep('prep')}>
            Preprocess
          </button>
        </section>
        <section>
          <h4>Behaviors</h4>
          <KV k="Priority order" v={o().data.names.join(' > ')} />
          <KV k="Frames with two or more" v={o().data.overlap.overlapping.toLocaleString()} />
          <KV k="Other state" v={s().behavior.other ? 'On: annotated frames with none of the selected behaviors' : 'Off: those frames are left out'} />
          <KV k="Annotated span" v={`${o().data.scoredFrames.toLocaleString()} frames, first bout to the end of the last`} />
          <KV k="Behavior labels" v="Unpadded annotation frames" />
          <p class="cb-muted">Each state's frames after overlaps: {o().data.overlap.final.map((n, i) => `${o().data.names[i]} ${n}`).join(', ')}.</p>
        </section>
        <section>
          <h4>Decoder</h4>
          <KV k="Likelihood" v={p().likelihood === 'gaussian' ? 'Gaussian (Shuman et al. 2020), pooled sigma' : 'Poisson (Zhang et al. 1998)'} />
          <KV k="Integration window" v={`${p().windowS} s, centred, clipped at the fold boundary`} />
          <KV k="Prior" v={p().prior === 'occupancy' ? 'Training occupancy' : 'Uniform'} />
          <KV k="Folds" v={`${p().nFolds}, contiguous blocks of time`} />
          <KV k="Minimum frames per behavior" v={p().minFramesPerClass} />
          <p class="cb-muted">Map means, s.d. and the occupancy prior come from the training folds only.</p>
        </section>
        <section>
          <h4>Shuffle test</h4>
          <Show when={o().test} fallback={<p class="cb-muted">Off: no p-values.</p>}>
            <KV k="Method" v="Label shuffle: labels permuted in blocks, neural data untouched" />
            <KV k="Block length" v={`${s().blockS} s (${o().blockFrames} frames)`} />
            <KV k="Shuffles" v={s().nShuffles.toLocaleString()} />
            <KV k="Random seed" v={s().seed} />
            <KV k="Significance level" v={`α = ${s().alpha} (upper tail)`} />
            <KV k="Correction" v={s().correction === 'max_stat' ? 'Max-stat (min-p) across the tested behaviors of this run' : 'None: p-values are uncorrected'} />
            <p class="cb-muted">The block length and shuffle count are a starting preset, not validated optima.</p>
          </Show>
        </section>
        <section>
          <h4>Differences from the framework</h4>
          <ul>
            <For each={DEPARTURES}>{(d) => <li>{d}</li>}</For>
          </ul>
          <p class="cb-muted">Framework: miniscope/CaBaNA framework-demo, commit 57c0c4b. Run time {fmt(o().seconds, 1)} s.</p>
        </section>
      </div>
    </Modal>
  );
}

/** The behavior target: its setup, or after a run its results. */
export function DecodingBehaviorPanel(): JSX.Element {
  return (
    <Show when={behaviorShowResults() && behaviorOutcome()} keyed fallback={<BehaviorSetup />}>
      {(out) => <BehaviorResults out={out} onEdit={() => setBehaviorShowResults(false)} />}
    </Show>
  );
}
