import { createEffect, createMemo, For, Show, type JSX } from 'solid-js';
import { matchGroupsOf, MIN_FRAMES } from '../lib/auroc.ts';
import {
  aurocData,
  aurocInput,
  aurocOutcome,
  aurocSettings,
  aurocShowResults,
  aurocStatus,
  autoShift,
  cancelAurocRun,
  DEFAULT_AUROC_SETTINGS,
  estimateMinShift,
  runAuroc,
  setAurocSettings,
  setAurocShowResults,
  type AurocData,
} from '../lib/auroc-run.ts';
import { aurocColor } from '../lib/auroc-view.ts';
import { prep } from '../lib/preprocess.ts';
import { annotationResults, goToStep } from '../lib/store.ts';
import { HowToRead, Note } from './parts.tsx';
import { AurocResults } from './AurocResults.tsx';

const PALETTE = ['#1f77b4', '#2ca02c', '#8c6d3f', '#c9a227', '#9467bd', '#d62728', '#17becf'];
export const behaviorColor = (i: number) => PALETTE[i % PALETTE.length];

/** The purple-to-orange scale with what each end means. Shared by the setup and the heatmap. */
export function AurocScale(): JSX.Element {
  const stops = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <div class="cb-auroc-scale">
      <div
        class="cb-auroc-scale__bar"
        role="img"
        aria-label="auROC scale from 0 (lower activity during the behavior) to 1 (higher)"
      >
        <For each={stops}>{(v) => <span style={{ background: aurocColor(v) }} />}</For>
      </div>
      <div class="cb-auroc-scale__ends">
        <span>
          <b class="cb-auroc-low">Below 0.5</b>
          Lower activity during behavior
        </span>
        <span>
          <b>0.5</b>No tendency
        </span>
        <span>
          <b class="cb-auroc-high">Above 0.5</b>Higher activity during behavior
        </span>
      </div>
    </div>
  );
}

/**
 * Each behavior's bouts over the recording, with the excluded frames hatched. Bars, bands and the time
 * axis share one scale (seconds to pixels), so a bar always sits at its own time.
 */
function Timeline(props: { data: AurocData }): JSX.Element {
  const W = 560;
  const [L, R, T, ROW] = [110, 10, 6, 22];
  const d = () => props.data;
  const dur = () => d().frames / d().fs;
  const x = (s: number) => L + (s / dur()) * (W - L - R);
  const H = () => T + d().labels.length * ROW + 24;
  const bouts = (label: string) =>
    (annotationResults().find((r) => r.id === 'behavior_annotations')?.epochs ?? []).filter(
      (e) => e.label === label,
    );
  const gaps = createMemo(() => {
    const out: [number, number][] = [];
    const m = d().mask;
    for (let i = 0; i < m.length;) {
      if (m[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < m.length && !m[j]) j++;
      out.push([i / d().fs, j / d().fs]);
      i = j;
    }
    return out;
  });
  const ticks = () => {
    const step = dur() > 600 ? 120 : dur() > 120 ? 60 : 20;
    return Array.from({ length: Math.floor(dur() / step) + 1 }, (_, i) => i * step);
  };
  return (
    <svg
      class="cb-auroc-timeline"
      viewBox={`0 0 ${W} ${H()}`}
      role="img"
      aria-label="Behavior bouts over time; hatched bands are excluded frames"
    >
      <defs>
        <pattern
          id="cb-hatch"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" stroke="#999" stroke-width="1.5" />
        </pattern>
      </defs>
      <For each={d().labels}>
        {(label, i) => {
          const tooFew = () =>
            d().info[i()].during < MIN_FRAMES || d().info[i()].outside < MIN_FRAMES;
          return (
            <g opacity={tooFew() ? 0.55 : 1}>
              <text
                x={L - 8}
                y={T + i() * ROW + 14}
                text-anchor="end"
                font-size="12"
                fill="currentColor"
              >
                {label}
              </text>
              <For each={bouts(label)}>
                {(e) => (
                  <rect
                    x={x(e.start)}
                    y={T + i() * ROW + 3}
                    width={Math.max(2, x(e.stop) - x(e.start))}
                    height={ROW - 8}
                    fill={tooFew() ? '#999' : behaviorColor(i())}
                  />
                )}
              </For>
            </g>
          );
        }}
      </For>
      <For each={gaps()}>
        {([a, b]) => (
          <rect
            x={x(a)}
            y={T}
            width={Math.max(2, x(b) - x(a))}
            height={d().labels.length * ROW}
            fill="url(#cb-hatch)"
            opacity="0.6"
          />
        )}
      </For>
      <line
        x1={L}
        x2={W - R}
        y1={T + d().labels.length * ROW}
        y2={T + d().labels.length * ROW}
        stroke="#999"
      />
      <For each={ticks()}>
        {(s) => (
          <text
            x={x(s)}
            y={T + d().labels.length * ROW + 15}
            text-anchor="middle"
            font-size="11"
            fill="currentColor"
          >
            {s}
          </text>
        )}
      </For>
      <text
        x={W - R}
        y={T + d().labels.length * ROW + 15}
        text-anchor="end"
        font-size="11"
        fill="currentColor"
      >
        s
      </text>
    </svg>
  );
}

/** Whether the setting differs from its starting value, to highlight the box. */
const changed = (k: 'nShuffles' | 'alpha' | 'seed' | 'minShiftS') =>
  aurocSettings[k] !== DEFAULT_AUROC_SETTINGS[k];

function NumberBox(props: {
  k: 'nShuffles' | 'alpha' | 'seed' | 'minShiftS';
  step: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <div class="cb-setting__title">{props.label}</div>
      <label class="cb-prep-field" classList={{ 'cb-prep-field--changed': changed(props.k) }}>
        <input
          type="number"
          min={props.min ?? 0}
          max={props.max}
          step={props.step}
          value={aurocSettings[props.k]}
          onInput={(e) => {
            const v = +e.currentTarget.value;
            if (Number.isFinite(v)) setAurocSettings(props.k, v);
          }}
        />
        {props.unit}
      </label>
    </div>
  );
}

function AurocSetup(): JSX.Element {
  const data = createMemo(() => aurocData());
  const ok = () => {
    const x = data();
    return 'error' in x ? undefined : x;
  };
  const running = () => {
    const s = aurocStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const error = () => {
    const s = aurocStatus();
    if (s.kind === 'error') return s.message;
    const x = data();
    return 'error' in x ? undefined : undefined;
  };
  const selected = () =>
    ok() ? ok()!.labels.filter((l) => !aurocSettings.unselected.includes(l)) : [];
  const tooFew = (i: number) =>
    ok()!.info[i].during < MIN_FRAMES || ok()!.info[i].outside < MIN_FRAMES;

  // Behaviors with too few frames start out unselected, once, when the data first appear.
  let seeded = false;
  createEffect(() => {
    const d = ok();
    if (!d || seeded) return;
    seeded = true;
    setAurocSettings(
      'unselected',
      d.labels.filter((_, i) => d.info[i].during < MIN_FRAMES || d.info[i].outside < MIN_FRAMES),
    );
  });
  const toggle = (label: string) =>
    setAurocSettings(
      'unselected',
      aurocSettings.unselected.includes(label)
        ? aurocSettings.unselected.filter((l) => l !== label)
        : [...aurocSettings.unselected, label],
    );

  // The automatic minimum shift, worked out ahead of the run so it can be shown here.
  createEffect(() => {
    const d = ok();
    if (d && aurocSettings.shiftAuto && selected().length)
      estimateMinShift(aurocInput(d, [...aurocSettings.unselected]));
  });

  const eligible = createMemo(() => {
    const d = ok();
    if (!d) return [];
    const input = aurocInput(d, [...aurocSettings.unselected]);
    const { matched } = matchGroupsOf(input, aurocSettings.match.minFrames);
    return selected().map((label, i) => ({ label, matched: matched[i] }));
  });

  const runButton = () => (
    <Show
      when={!running()}
      fallback={
        <button class="btn-secondary" onClick={cancelAurocRun}>
          Cancel
        </button>
      }
    >
      <button
        class="btn-primary"
        disabled={!ok() || !selected().length}
        onClick={() => void runAuroc()}
      >
        {aurocOutcome() ? 'Run again' : 'Run analysis'}
      </button>
    </Show>
  );
  const nShuf = () => aurocSettings.nShuffles;
  const minP = () => 2 / (nShuf() + 1);

  return (
    <>
      <div class="cb-place-head">
        <div>
          <h2>auROC analysis</h2>
          <p>
            Identify cells with higher or lower activity during each behavior. auROC measures how
            consistently activity is higher during the behavior than outside it; time-shifted data
            are used to test significance.
          </p>
          <Show when={ok()}>
            <p class="cb-muted">
              {ok()!.cells} cells selected · Deconvolved events
              <Show when={ok()!.cellsMissing.length}>
                {' '}
                · {ok()!.cellsMissing.length} with missing neural values (not evaluated)
              </Show>
            </p>
          </Show>
        </div>
        <div class="cb-controls">
          <Show when={aurocOutcome()}>
            <button class="btn-secondary" onClick={() => setAurocShowResults(true)}>
              View results
            </button>
          </Show>
          {runButton()}
        </div>
      </div>
      <Show when={running()}>
        <progress class="cb-progress" value={running()!.done} max={running()!.total} />
        <div class="cb-muted">{running()!.step}</div>
      </Show>
      <Show when={error()}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ok()}>
        <div class="cb-empty">
          {(data() as { error: string }).error} auROC needs deconvolved neural data, neural
          timestamps and behavior annotations.
        </div>
      </Show>

      <Show when={ok()}>
        <details class="cb-notebox cb-place-method">
          <summary>How the analysis works</summary>
          <div class="cb-muted">
            <p>
              <strong>Compare activity:</strong> For each cell and behavior, auROC is the
              probability that a randomly chosen frame during the behavior has higher neural
              activity than a randomly chosen frame outside it. Frames outside the behavior include
              unlabeled frames. Excluded frames are left out of both groups.
            </p>
            <AurocScale />
            <p>
              <strong>Test significance:</strong> The cell’s neural data are shifted in time
              relative to behavior (wrapping around the end of the recording) and auROC is
              recalculated. This gives the values expected without the original alignment. The
              two-sided p-value compares the observed auROC with these values, then is adjusted for
              the number of behaviors tested per cell.
            </p>
            <p>
              <strong>Not evaluated:</strong> auROC is left undefined when a cell has a missing
              neural value among the included frames, or when a behavior has fewer than {MIN_FRAMES}{' '}
              included frames during or outside it. These results are not zero and not
              nonsignificant; they are left out of the counts of evaluated cells.
            </p>
            <p>
              <strong>Direction alone does not establish significance.</strong>
            </p>
          </div>
        </details>

        <section class="cb-setgroup">
          <h3>1 · Behaviors and included data</h3>
          <table class="cb-auroc-table">
            <thead>
              <tr>
                <th>Behavior</th>
                <th>Annotated duration (s)</th>
                <th>Frames during behavior</th>
                <th>Frames outside behavior</th>
                <th>Bouts</th>
              </tr>
            </thead>
            <tbody>
              <For each={ok()!.info}>
                {(b, i) => (
                  <tr>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={!aurocSettings.unselected.includes(b.label)}
                          onChange={() => toggle(b.label)}
                        />
                        <span
                          class="cb-dot"
                          style={{ background: tooFew(i()) ? '#999' : behaviorColor(i()) }}
                        />{' '}
                        {b.label}
                      </label>
                    </td>
                    <td>{b.duration.toFixed(1)}</td>
                    <td>{b.during.toLocaleString()}</td>
                    <td>{b.outside.toLocaleString()}</td>
                    <td>{b.bouts}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <For each={ok()!.info.filter((_, i) => tooFew(i))}>
            {(b) => (
              <p class="cb-muted">
                <span class="cb-pill cb-pill--warn">Insufficient data</span> {b.label}:{' '}
                {Math.min(b.during, b.outside)} frames; {MIN_FRAMES} required during and outside.
              </p>
            )}
          </For>
          <h4>Behavior timeline</h4>
          <Timeline data={ok()!} />
          <div class="cb-muted">Hatched: excluded frames · Gray: not tested</div>
          <HowToRead>
            <p>
              Each row represents a behavior; colored bars mark its bouts. Hatched bands show
              excluded frames. Check whether enough included data remain during and outside each
              behavior.
            </p>
          </HowToRead>
          <p class="cb-muted">
            Frame counts include only frames retained for analysis. Each behavior is compared with
            all other included frames, including unlabeled frames.
          </p>
          <Note>
            <p>
              Overlapping behaviors are tested independently: a frame in two behaviors counts as
              inside for both. Merging behaviors is done in annotation setup, not here.
            </p>
          </Note>
          <div class="cb-statbox">
            <div class="cb-setting__title">
              {ok()!
                .mask.reduce((a, b) => a + b, 0)
                .toLocaleString()}{' '}
              of {ok()!.frames.toLocaleString()} frames included in analysis
            </div>
            <div class="cb-muted">
              {ok()!.excluded.noPosition > 0
                ? `${ok()!.excluded.noPosition.toLocaleString()} frames without position excluded`
                : 'No frames without position'}
              {' · '}
              {prep.minSpeed > 0
                ? `${ok()!.excluded.slow.toLocaleString()} frames below ${prep.minSpeed} cm/s excluded`
                : 'No speed filter'}
              {' · '}
              <button class="cb-link" onClick={() => goToStep('prep')}>
                Edit frame selection
              </button>
            </div>
            <div class="cb-muted">
              Uses the frame selection from Preprocess. No additional filter is applied here.
            </div>
          </div>
          <div class="cb-muted">
            Neural signal: deconvolved events · Smoothing from Preprocess (Gaussian, σ ={' '}
            {prep.eventSigmaS} s)
          </div>
          <Show when={ok()!.cellsMissing.length}>
            <details class="cb-notebox">
              <summary>
                {ok()!.cellsMissing.length} of {ok()!.cells} cells cannot be evaluated
              </summary>
              <div class="cb-muted">
                <p>
                  These cells have a missing neural value in the included frames, so their auROC is
                  undefined. They are kept in the results as Not evaluated and are left out of the
                  evaluated-cell counts.
                </p>
                <p>
                  Cells:{' '}
                  {ok()!
                    .cellsMissing.map((c) => ok()!.cellIds[c] + 1)
                    .join(', ')}
                </p>
              </div>
            </details>
          </Show>
        </section>

        <section class="cb-setgroup">
          <h3>2 · Comparison method</h3>
          <div class="cb-setting">
            <div class="cb-setting__title">Method</div>
            <div class="cb-seg">
              <button
                classList={{ 'cb-seg__on': aurocSettings.method === 'circular' }}
                onClick={() => setAurocSettings('method', 'circular')}
              >
                Time-shifted data (circular shift)
              </button>
              <button
                classList={{ 'cb-seg__on': aurocSettings.method === 'speed' }}
                onClick={() => setAurocSettings('method', 'speed')}
              >
                Speed-matched time-shifted data
              </button>
            </div>
            <div class="cb-muted">
              Shift neural activity in time relative to behavior and recalculate auROC to estimate
              chance associations.
              {aurocSettings.method === 'speed' &&
                ' Only shifts that keep the speed distribution during each behavior similar to the original are used.'}
            </div>
          </div>
          <div class="cb-setting">
            <div class="cb-setting__title">Minimum shift</div>
            <div class="cb-controls">
              <For each={[true, false]}>
                {(a) => (
                  <label class="cb-radio">
                    <input
                      type="radio"
                      name="auroc-shift"
                      checked={aurocSettings.shiftAuto === a}
                      onChange={() => setAurocSettings('shiftAuto', a)}
                    />
                    {a ? 'Auto' : 'Manual'}
                  </label>
                )}
              </For>
              <Show when={aurocSettings.shiftAuto}>
                <span class="cb-pill">
                  {autoShift() ? `Using ${autoShift()!.minShiftS} s` : 'Working it out…'}
                </span>
              </Show>
              <Show when={!aurocSettings.shiftAuto}>
                <NumberBox k="minShiftS" label="" unit="s" step={0.5} min={0.5} />
              </Show>
            </div>
            <div class="cb-muted">
              Minimum time offset between neural activity and behavior in the shifted comparisons.
            </div>
          </div>
          <Show when={aurocSettings.method === 'speed'}>
            <div class="cb-setting">
              <div class="cb-setting__title">Balance measure</div>
              <div class="cb-seg">
                <button
                  classList={{ 'cb-seg__on': aurocSettings.match.statistic === 'ks' }}
                  onClick={() => setAurocSettings('match', 'statistic', 'ks')}
                >
                  KS distance
                </button>
                <button
                  classList={{ 'cb-seg__on': aurocSettings.match.statistic === 'mean' }}
                  onClick={() => setAurocSettings('match', 'statistic', 'mean')}
                >
                  Difference in means
                </button>
              </div>
            </div>
            <div class="cb-controls">
              <div class="cb-setting">
                <div class="cb-setting__title">Tolerance</div>
                <label
                  class="cb-prep-field"
                  classList={{ 'cb-prep-field--changed': aurocSettings.match.tolerance !== 0.1 }}
                >
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={aurocSettings.match.tolerance}
                    onInput={(e) =>
                      +e.currentTarget.value > 0 &&
                      setAurocSettings('match', 'tolerance', +e.currentTarget.value)
                    }
                  />
                </label>
              </div>
              <div class="cb-setting">
                <div class="cb-setting__title">Candidates per shift</div>
                <label
                  class="cb-prep-field"
                  classList={{ 'cb-prep-field--changed': aurocSettings.match.maxTries !== 20 }}
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={aurocSettings.match.maxTries}
                    onInput={(e) =>
                      +e.currentTarget.value >= 1 &&
                      setAurocSettings('match', 'maxTries', Math.round(+e.currentTarget.value))
                    }
                  />
                </label>
              </div>
            </div>
            <div class="cb-muted">
              KS distance, tolerance 0.10 and 20 candidates per shift are the framework’s starting
              settings, not validated standards. There is no cut-off for a low acceptance rate; the
              run stops if no shift can be matched, and does not fall back to unmatched shifts.
            </div>
            <Show when={!ok()!.speed}>
              <div class="cb-note">Speed matching needs a loaded position file.</div>
            </Show>
            <div class="cb-setting">
              <div class="cb-setting__title">Behaviors eligible for speed matching</div>
              <For each={eligible()}>
                {(e) => (
                  <div class="cb-muted">
                    {e.label}:{' '}
                    {e.matched
                      ? 'matched'
                      : `not matched (fewer than ${aurocSettings.match.minFrames} included frames)`}
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Note>
            <p>
              The neural data are shifted around the whole recording first, wrapping at its end, and
              the frame selection is applied afterwards, so excluded frames keep their time
              positions. The recording is treated as one continuous session.
            </p>
            <p>
              <em>Auto</em> sets the minimum shift to 3 times the longer of the neural and behavior
              autocorrelation times, between 5 s and a quarter of the recording.
            </p>
          </Note>
        </section>

        <section class="cb-setgroup">
          <h3>3 · Statistical settings</h3>
          <div class="cb-controls">
            <NumberBox k="nShuffles" label="Shuffles" step={100} min={1} />
            <NumberBox k="alpha" label="Significance level (α)" step={0.01} min={0.001} max={0.5} />
          </div>
          <div class="cb-setting">
            <div class="cb-setting__title">Correction method</div>
            <div class="cb-seg">
              <button
                classList={{ 'cb-seg__on': aurocSettings.correction === 'max_stat' }}
                onClick={() => setAurocSettings('correction', 'max_stat')}
              >
                Maximum statistic (max-stat)
              </button>
              <button
                classList={{ 'cb-seg__on': aurocSettings.correction === 'none' }}
                onClick={() => setAurocSettings('correction', 'none')}
              >
                None
              </button>
            </div>
          </div>
          <div class="cb-muted">
            {aurocSettings.correction === 'max_stat'
              ? `Corrects across the ${selected().length} selected behaviors within each cell. It does not correct across cells.`
              : 'No correction: p-values are not adjusted for the number of behaviors or cells tested.'}
          </div>
          <div class="cb-muted">
            Changing the behaviors included in a new analysis can change adjusted p-values and
            response classifications.
          </div>
          <div class="cb-muted">Two-sided · Detects higher or lower activity.</div>
          <div class="cb-muted">Minimum unadjusted p-value: approximately {minP().toFixed(3)}</div>
          <details class="cb-notebox">
            <summary>Advanced options (random seed)</summary>
            <NumberBox k="seed" label="Random seed" step={1} />
            <div class="cb-muted">
              The same seed, settings and data give the same shifts and results.
            </div>
          </details>
        </section>
      </Show>
    </>
  );
}

/** The auROC page: its settings, or after a run its results. */
export function AurocPanel(): JSX.Element {
  return (
    <Show when={aurocShowResults() && aurocOutcome()} keyed fallback={<AurocSetup />}>
      {(out) => <AurocResults out={out} onEdit={() => setAurocShowResults(false)} />}
    </Show>
  );
}
