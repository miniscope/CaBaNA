import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { matchGroupsOf, MIN_FRAMES } from '../lib/auroc.ts';
import {
  aurocData,
  aurocPlan,
  pairIndexes,
  aurocOutcome,
  aurocSettings,
  aurocShowResults,
  aurocStatus,
  autoShift,
  autoShiftError,
  cancelAurocRun,
  DEFAULT_AUROC_SETTINGS,
  estimateMinShift,
  runAuroc,
  setAurocSettings,
  setAurocShowResults,
  type AurocData,
} from '../lib/auroc-run.ts';
import { aurocChanges, aurocColor } from '../lib/auroc-view.ts';
import { prep } from '../lib/preprocess.ts';
import { annotationResults, goToStep } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { createSize, PopButton } from './QcParts.tsx';
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
 * axis share one scale (seconds to pixels), so a bar always sits at its own time. It is drawn at the
 * given pixel size, so text keeps its size and the rows share the height.
 */
let nextHatch = 1;
function Timeline(props: { data: AurocData; w: number; h: number }): JSX.Element {
  const hatch = `cb-hatch-${nextHatch++}`;
  const [R, T] = [10, 6];
  const d = () => props.data;
  const n = () => d().labels.length;
  const L = Math.min(220, 16 + 7 * Math.max(...props.data.labels.map((l) => l.length)));
  const ROW = () => Math.min(36, Math.max(14, Math.floor((props.h - T - 38) / n())));
  const H = () => Math.max(props.h, T + n() * ROW() + 38);
  const dur = () => d().frames / d().fs;
  const x = (s: number) => L + (s / dur()) * (props.w - L - R);
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
  const axisY = () => T + n() * ROW();
  return (
    <svg
      class="cb-auroc-timeline"
      style={{ width: `${props.w}px`, height: `${H()}px` }}
      viewBox={`0 0 ${props.w} ${H()}`}
      role="img"
      aria-label="Behavior bouts over time; hatched bands are excluded frames"
    >
      <defs>
        <pattern
          id={hatch}
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
                y={T + i() * ROW() + ROW() / 2 + 4}
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
                    y={T + i() * ROW() + 3}
                    width={Math.max(2, x(e.stop) - x(e.start))}
                    height={ROW() - 6}
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
            height={n() * ROW()}
            fill={`url(#${hatch})`}
            opacity="0.6"
          />
        )}
      </For>
      <line x1={L} x2={props.w - R} y1={axisY()} y2={axisY()} stroke="#999" />
      <For each={ticks()}>
        {(s) => (
          <text x={x(s)} y={axisY() + 15} text-anchor="middle" font-size="11" fill="currentColor">
            {s}
          </text>
        )}
      </For>
      <text x={(L + props.w - R) / 2} y={axisY() + 30} text-anchor="middle" font-size="11" fill="currentColor">
        Time (s)
      </text>
    </svg>
  );
}

/** The timeline filling its box, redrawn when the box is resized. */
function FitTimeline(props: { data: AurocData }): JSX.Element {
  const [size, measure] = createSize();
  return (
    <div class="cb-as-tl" ref={measure}>
      <Show when={size().w > 0}>
        <Timeline data={props.data} w={size().w} h={size().h} />
      </Show>
    </div>
  );
}

/** A dialog over the page. Escape or a click on the backdrop closes it; Tab stays inside. */
function Modal(props: {
  title: string;
  onClose: () => void;
  big?: boolean;
  children: JSX.Element;
}): JSX.Element {
  let box!: HTMLDivElement;
  let close!: HTMLButtonElement;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return props.onClose();
    if (e.key !== 'Tab') return;
    const f = [
      ...box.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]'),
    ].filter((el) => !(el as HTMLButtonElement).disabled);
    if (!f.length) return;
    const [first, last] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  onMount(() => {
    close.focus();
    document.addEventListener('keydown', key);
  });
  onCleanup(() => document.removeEventListener('keydown', key));
  return (
    <Portal>
      <div class="cb-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div
          ref={box}
          class="cb-overlay__box"
          classList={{ 'cb-as-modal': !props.big }}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
        >
          <div class="cb-plot__head">
            <h3>{props.title}</h3>
            <button
              ref={close}
              type="button"
              class="cb-ib cb-as-close"
              aria-label="Close"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

/** Whether the setting differs from its starting value, to highlight the box. */
const changed = (k: 'nShuffles' | 'alpha' | 'seed' | 'minShiftS' | 'minSpeed') =>
  aurocSettings[k] !== DEFAULT_AUROC_SETTINGS[k];

/** A setting's name with its explanation in a tooltip. */
const Title = (props: { text: string; children: JSX.Element }): JSX.Element => (
  <div class="cb-setting__title">
    {props.text}
    <InfoTip label={`About ${props.text.toLowerCase()}`}>{props.children}</InfoTip>
  </div>
);

type NumKey = 'nShuffles' | 'alpha' | 'seed' | 'minShiftS' | 'minSpeed';

function NumInput(props: {
  k: NumKey;
  step: number;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
}): JSX.Element {
  return (
    <label class="cb-prep-field" classList={{ 'cb-prep-field--changed': changed(props.k) }}>
      <input
        type="number"
        aria-label={props.label}
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
  );
}

function NumberBox(props: {
  k: NumKey;
  step: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-setting">
      <Title text={props.label}>{props.children}</Title>
      <NumInput {...props} />
    </div>
  );
}

const PER_PAGE = 8;

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
    return s.kind === 'error' ? s.message : undefined;
  };
  const plan = createMemo(() =>
    ok()
      ? aurocPlan(ok()!, { ...aurocSettings, unselected: [...aurocSettings.unselected] })
      : undefined,
  );
  const selected = () => plan()?.labels ?? [];
  const pairMode = () => aurocSettings.compare === 'behavior' && ok()!.labels.length >= 2;
  const pair = () => pairIndexes(ok()!, aurocSettings);
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
    if (d && aurocSettings.shiftAuto && selected().length) estimateMinShift(plan()!.input);
  });

  const eligible = createMemo(() => {
    if (!plan()) return [];
    const { matched } = matchGroupsOf(plan()!.input, aurocSettings.match.minFrames);
    return selected().map((label, i) => ({ label, matched: matched[i] }));
  });

  const [page, setPage] = createSignal(0);
  const nPages = () => Math.max(1, Math.ceil((ok()?.labels.length ?? 0) / PER_PAGE));
  const first = () => Math.min(page(), nPages() - 1) * PER_PAGE;
  const rows = () => (ok()?.info ?? []).map((b, i) => ({ b, i })).slice(first(), first() + PER_PAGE);

  /** What the table shows for one behavior: its frame counts and whether they are enough. */
  const counts = (i: number) => {
    if (!pairMode()) return { n: ok()!.info[i], enough: !tooFew(i) };
    if (i !== pair()[0]) return undefined;
    const n = plan()!.info[0];
    return { n, enough: Math.min(n.during, n.outside) >= MIN_FRAMES };
  };
  const insufficient = () =>
    pairMode()
      ? plan()!.info.filter((b) => Math.min(b.during, b.outside) < MIN_FRAMES)
      : ok()!.info.filter((_, i) => tooFew(i));

  const [advanced, setAdvanced] = createSignal(false);
  const [big, setBig] = createSignal(false);
  let advBtn!: HTMLButtonElement;
  let bigBtn!: HTMLButtonElement;
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

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
  const runStatus = () =>
    !ok()
      ? 'Load the data auROC needs to run.'
      : !selected().length
        ? 'Select at least one behavior to run.'
        : `${selected().length} behavior${selected().length === 1 ? '' : 's'} selected · ready to run`;
  const minP = () => 2 / (aurocSettings.nShuffles + 1);
  const included = () => ok()!.mask.reduce((a, b) => a + b, 0);
  const smoothing = () => (prep.eventSigmaS ? `Gaussian σ = ${prep.eventSigmaS} s` : 'none');

  return (
    <div class="cb-place cb-as" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>auROC analysis</h2>
          <p class="cb-muted">
            Identify cells with higher or lower neural events during each behavior.
          </p>
        </div>
        <Show when={ok()}>
          <div class="cb-place-head__side">
            <span>
              {ok()!.cells} cells ·{' '}
              {pairMode()
                ? `${ok()!.labels[pair()[0]]} against ${ok()!.labels[pair()[1]]}`
                : `${selected().length} of ${ok()!.labels.length} behaviors selected`}
            </span>
            <Show when={ok()!.cellsMissing.length}>
              <PopButton
                label="Cells that cannot be evaluated"
                title="Cells that cannot be evaluated"
                width={380}
                class="cb-link"
                button={`${ok()!.cellsMissing.length} of ${ok()!.cells} cells cannot be evaluated`}
              >
                <p>
                  These cells have a missing neural value in the included frames, so their auROC is
                  undefined. They are kept in the results as Not evaluated and are left out of the
                  evaluated-cell counts.
                </p>
                <p>Cells: {ok()!.cellsMissing.map((c) => ok()!.cellIds[c] + 1).join(', ')}</p>
              </PopButton>
            </Show>
          </div>
        </Show>
        <div class="cb-controls">
          <Show when={aurocOutcome()}>
            <button class="btn-secondary" onClick={() => setAurocShowResults(true)}>
              {aurocChanges().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>
      <Show when={aurocOutcome() && aurocChanges().length}>
        <div class="cb-muted">
          Changed since the last run: {aurocChanges().join(', ')}. Run again to update.
        </div>
      </Show>
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
        <div class="cb-as-body">
          <div class="cb-as-left">
            <section class="cb-setgroup cb-as-sec">
              <h3>1 · Comparison</h3>
              <div class="cb-setting">
                <Title text="Compare with">
                  Choose the reference frames used to compare neural activity with frames labeled
                  as the selected behavior. Against another behavior, the comparison group is that
                  behavior's frames only; frames in neither behavior, and frames in both, are left
                  out. Excluded frames are left out of both groups.
                </Title>
                <select
                  aria-label="Compare with"
                  value={pairMode() ? 'behavior' : 'rest'}
                  onChange={(e) =>
                    setAurocSettings('compare', e.currentTarget.value as 'rest' | 'behavior')
                  }
                >
                  <option value="rest">All other included frames</option>
                  <option value="behavior" disabled={ok()!.labels.length < 2}>
                    Another behavior
                  </option>
                </select>
                <Show when={!pairMode()}>
                  <div class="cb-muted">
                    Uses included frames outside the selected behavior, including unlabeled frames
                    and frames labeled with other behaviors.
                  </div>
                </Show>
              </div>
              <Show when={pairMode()}>
                <div class="cb-controls">
                  <For each={[0, 1]}>
                    {(k) => (
                      <label class="cb-prep-field">
                        {k === 0 ? 'Behavior' : 'against'}{' '}
                        <select
                          value={ok()!.labels[pair()[k]]}
                          onChange={(e) =>
                            setAurocSettings(k === 0 ? 'pairA' : 'pairB', e.currentTarget.value)
                          }
                        >
                          <For each={ok()!.labels}>
                            {(l, i) => (
                              <option
                                value={l}
                                selected={i() === pair()[k]}
                                disabled={i() === pair()[1 - k]}
                              >
                                {l}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                    )}
                  </For>
                </div>
                <div class="cb-muted">
                  auROC above 0.5 means higher neural events during {ok()!.labels[pair()[0]]} than
                  during {ok()!.labels[pair()[1]]}.
                </div>
              </Show>
            </section>

            <section class="cb-setgroup cb-as-sec">
              <h3>2 · Frame selection</h3>
              <label class="cb-as-check">
                <input
                  type="checkbox"
                  checked={aurocSettings.speedFilter}
                  onChange={(e) => setAurocSettings('speedFilter', e.currentTarget.checked)}
                />
                Exclude frames below a minimum speed
                <InfoTip label="About the speed filter">
                  Excludes slow frames before the behavior and reference groups are formed, in both
                  alike. This is different from speed matching, which does not change the groups:
                  it only limits which circular shifts are used for the comparison distribution.
                  Frames with no speed value cannot be checked against the threshold, so they are
                  excluded too and counted as "Missing speed". Off: auROC does not use position and
                  keeps every frame. This value is auROC's own; it does not change Preprocess or
                  Place cells.
                </InfoTip>
              </label>
              <div class="cb-as-check">
                Minimum speed:
                <NumInput k="minSpeed" step={0.5} unit="cm/s" label="Minimum speed" />
              </div>
              <Show
                when={
                  aurocSettings.speedFilter &&
                  !(Number.isFinite(aurocSettings.minSpeed) && aurocSettings.minSpeed >= 0)
                }
              >
                <div class="cb-warn">Enter a minimum speed of 0 cm/s or more.</div>
              </Show>
              <div class="cb-muted">
                Off by default. Needs a loaded position file; frames with missing speed are excluded
                when it is on.
              </div>
            </section>

            <section class="cb-setgroup cb-as-sec">
              <h3>3 · Significance testing</h3>
              <div class="cb-as-stack">
                <Title text="Null method">
                  Creates a comparison distribution to estimate how often a response this strong
                  could occur by chance. The neural data are shifted around the whole recording
                  first, wrapping at its end, and the frame selection is applied afterwards, so
                  excluded frames keep their time positions. The recording is treated as one
                  continuous session.
                </Title>
                <select
                  aria-label="Null method"
                  value={aurocSettings.method}
                  onChange={(e) =>
                    setAurocSettings('method', e.currentTarget.value as 'circular' | 'speed')
                  }
                >
                  <option value="circular">Time-shifted data (circular shift)</option>
                  <option value="speed">Speed-matched time-shifted data</option>
                </select>
                <div class="cb-muted">
                  Circular shift: shifts the deconvolved neural trace in time relative to the
                  behavior labels, wrapping the end of the trace to the beginning. Repeating this
                  gives a comparison distribution that keeps the temporal structure of the shifted
                  trace.
                  {aurocSettings.method === 'speed' &&
                    ' Speed-matched: only shifts that keep the speed distribution during each behavior similar to the original are used.'}
                </div>
                <Show when={aurocSettings.method === 'speed' && !ok()!.speed}>
                  <div class="cb-note">Speed matching needs a loaded position file.</div>
                </Show>
                <Show when={aurocSettings.method === 'speed'}>
        <div class="cb-as-stack">
          <Title text="Balance measure">
            How the speed distributions of the shifted and original frames are compared.
          </Title>
          <select
            aria-label="Balance measure"
            value={aurocSettings.match.statistic}
            onChange={(e) =>
              setAurocSettings('match', 'statistic', e.currentTarget.value as 'ks' | 'mean')
            }
          >
            <option value="ks">KS distance</option>
            <option value="mean">Difference in means</option>
          </select>
        </div>
        <div class="cb-setting">
          <Title text="Tolerance">
            The largest balance-measure value at which a shift is accepted as matched.
          </Title>
          <label
            class="cb-prep-field"
            classList={{ 'cb-prep-field--changed': aurocSettings.match.tolerance !== 0.1 }}
          >
            <input
              type="number"
              aria-label="Tolerance"
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
                  <button class="cb-link" onClick={() => setAdvanced(true)}>
                    More speed-matching settings
                  </button>
                </Show>
              </div>
              <div class="cb-setting">
                <Title text="Minimum shift">
                  The smallest time shift allowed when generating shuffled data. Larger shifts
                  help prevent a shuffle from staying too close to the original alignment. Auto
                  sets it to 3 times the longer of the neural and behavior autocorrelation times,
                  between 5 s and a quarter of the recording.
                </Title>
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
                  <Show
                    when={aurocSettings.shiftAuto}
                    fallback={
                      <NumInput k="minShiftS" label="Minimum shift (s)" unit="s" step={0.5} min={0.5} />
                    }
                  >
                    <Show
                      when={!autoShiftError()}
                      fallback={
                        <span class="cb-warn">
                          Could not be calculated ({autoShiftError()}). Choose Manual.
                        </span>
                      }
                    >
                      <Show when={autoShift()} fallback={<span class="cb-muted">Calculating…</span>}>
                        <span class="cb-pill">{autoShift()!.minShiftS} s</span>
                        <span class="cb-muted">{autoShift()!.note}</span>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </div>
              <div class="cb-as-pair">
                <NumberBox k="nShuffles" label="Shuffles" step={100} min={1}>
                  Number of shifted datasets used to estimate significance. More shuffles provide
                  finer p-value resolution but take longer. Smallest possible unadjusted p-value:
                  approximately {minP().toFixed(3)}.
                </NumberBox>
                <NumberBox k="alpha" label="α" step={0.01} min={0.001} max={0.5}>
                  The significance threshold used to classify a result as significant. The test is
                  two-sided: it detects higher or lower neural events.
                </NumberBox>
              </div>
              <div class="cb-setting">
                <Title text="Multiple-comparison correction">
                  Testing many behaviors or cells increases the chance of finding a significant
                  result by chance. Correction helps account for multiple tests, within the scope
                  shown below the menu.
                </Title>
                <select
                  aria-label="Multiple-comparison correction"
                  value={aurocSettings.correction}
                  onChange={(e) =>
                    setAurocSettings('correction', e.currentTarget.value as 'none' | 'max_stat')
                  }
                >
                  <option value="max_stat">Max-stat</option>
                  <option value="none">None</option>
                </select>
                <div class="cb-as-scope">
                  {aurocSettings.correction === 'max_stat'
                    ? `Accounts for testing the ${selected().length} selected behaviors within each cell. It does not correct for testing multiple cells. Adjusted p-values can change when the selected behaviors change.`
                    : 'No correction: p-values are not adjusted for the number of behaviors or cells tested.'}
                </div>
              </div>
            </section>

            <button
              ref={advBtn}
              type="button"
              class="btn-secondary cb-as-adv"
              aria-haspopup="dialog"
              onClick={() => setAdvanced(true)}
            >
              <span>Advanced options…</span>
              <span class="cb-muted">seed {aurocSettings.seed}</span>
            </button>
          </div>

          <div class="cb-as-right">
            <section class="cb-plot cb-plot--table cb-as-table">
              <div class="cb-plot__head">
                <h3>4 · Behaviors</h3>
                <InfoTip label="About behaviors">
                  Frame counts include only frames retained for analysis. Overlapping behaviors are
                  tested independently: a frame in two behaviors counts as inside for both. Merging
                  behaviors is done in annotation setup, not here.
                </InfoTip>
                <span class="cb-as-spacer" />
                <Show when={!pairMode()}>
                  <button
                    class="btn-secondary btn-small"
                    onClick={() => setAurocSettings('unselected', [])}
                  >
                    Select all
                  </button>
                  <button
                    class="btn-secondary btn-small"
                    onClick={() => setAurocSettings('unselected', [...ok()!.labels])}
                  >
                    Clear
                  </button>
                </Show>
              </div>
              <table class="cb-auroc-table cb-as-tbl">
                <thead>
                  <tr>
                    <th aria-label="Selected" />
                    <th>Behavior</th>
                    <th class="cb-as-num">Annotated (s)</th>
                    <th class="cb-as-num">Bouts</th>
                    <th class="cb-as-num">Behavior frames</th>
                    <th class="cb-as-num">Reference frames</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows()}>
                    {({ b, i }) => {
                      const c = () => counts(i);
                      return (
                        <tr classList={{ 'cb-muted': pairMode() && !pair().includes(i) }}>
                          <td>
                            <Show when={!pairMode()}>
                              <input
                                type="checkbox"
                                aria-label={`Include ${b.label}`}
                                checked={!aurocSettings.unselected.includes(b.label)}
                                onChange={() => toggle(b.label)}
                              />
                            </Show>
                          </td>
                          <td>
                            <span
                              class="cb-dot"
                              style={{ background: tooFew(i) ? '#999' : behaviorColor(i) }}
                            />{' '}
                            {b.label}
                          </td>
                          <td class="cb-as-num">{b.duration.toFixed(1)}</td>
                          <td class="cb-as-num">{b.bouts}</td>
                          <td class="cb-as-num">{c() ? c()!.n.during.toLocaleString() : '–'}</td>
                          <td class="cb-as-num">{c() ? c()!.n.outside.toLocaleString() : '–'}</td>
                          <td>
                            <Show
                              when={c()}
                              fallback={
                                <span class="cb-muted">
                                  {pairMode() && i === pair()[1] ? 'Reference' : '–'}
                                </span>
                              }
                            >
                              <Show
                                when={c()!.enough}
                                fallback={<span class="cb-pill cb-pill--warn">Insufficient data</span>}
                              >
                                <span class="cb-pill cb-pill--good">OK</span>
                              </Show>
                            </Show>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
              <div class="cb-pager">
                <span class="cb-muted">
                  <Show
                    when={insufficient().length}
                    fallback={`${MIN_FRAMES} frames required during and outside each behavior.`}
                  >
                    {insufficient()
                      .map(
                        (b) =>
                          `${b.label}: ${Math.min(b.during, b.outside)} frames; ${MIN_FRAMES} required during and outside`,
                      )
                      .join(' · ')}
                  </Show>
                </span>
                <Show when={nPages() > 1}>
                  <span>
                    {first() + 1}–{Math.min(first() + PER_PAGE, ok()!.labels.length)} of{' '}
                    {ok()!.labels.length}
                  </span>
                  <button
                    class="btn-secondary btn-small"
                    aria-label="Previous behaviors"
                    disabled={first() === 0}
                    onClick={() => setPage(Math.max(0, page() - 1))}
                  >
                    ‹
                  </button>
                  <button
                    class="btn-secondary btn-small"
                    aria-label="Next behaviors"
                    disabled={first() + PER_PAGE >= ok()!.labels.length}
                    onClick={() => setPage(Math.min(nPages() - 1, page() + 1))}
                  >
                    ›
                  </button>
                </Show>
              </div>
            </section>

            <div class="cb-as-groups">
              <div class="cb-as-group">
                <b>Behavior group</b>
                <span class="cb-muted">
                  {pairMode() ? `Frames in ${ok()!.labels[pair()[0]]} only` : 'Frames annotated with the behavior'}{' '}
                  (label padding {prep.labelPadS} s)
                </span>
              </div>
              <span aria-hidden="true">⟷</span>
              <div class="cb-as-group">
                <b>Reference group</b>
                <span class="cb-muted">
                  {pairMode()
                    ? `Frames in ${ok()!.labels[pair()[1]]} only`
                    : 'All other included frames, including unlabeled'}
                </span>
              </div>
              <div class="cb-as-incl">
                <b>
                  {included().toLocaleString()} / {ok()!.frames.toLocaleString()}
                </b>{' '}
                frames included
                <PopButton
                  label="View exclusions"
                  title="Excluded frames"
                  width={340}
                  class="cb-link"
                  button="View exclusions"
                >
                  <p>
                    {ok()!.excluded.minSpeed !== undefined
                      ? `${ok()!.excluded.missingSpeed.toLocaleString()} frames with missing speed and ${ok()!.excluded.slow.toLocaleString()} frames below ${ok()!.excluded.minSpeed} cm/s excluded`
                      : 'No speed filter · Every frame is kept'}
                  </p>
                  <p>
                    auROC does not use position, so every frame is kept unless the speed filter is
                    chosen. Frames with missing speed cannot be checked against the threshold and
                    are excluded when it is on. Each frame is counted once, under the first reason
                    it meets.
                  </p>
                </PopButton>
              </div>
            </div>

            <section class="cb-plot cb-as-timeline">
              <div class="cb-plot__head">
                <h3>5 · Behavior timeline</h3>
                <PopButton
                  label="How to read this plot"
                  title="How to read: behavior timeline"
                  width={400}
                  class="cb-link"
                  button="How to read this plot"
                >
                  <p>
                    Each row represents a behavior; colored bars mark its bouts. Hatched bands show
                    excluded frames. Check whether enough included data remain during and outside
                    each behavior.
                  </p>
                </PopButton>
                <span class="cb-plot__legend">Hatched: excluded frames · Gray: not tested</span>
                <button
                  ref={bigBtn}
                  type="button"
                  class="cb-ib"
                  aria-label="Expand behavior timeline"
                  title="Expand plot"
                  onClick={() => setBig(true)}
                >
                  ⤢
                </button>
              </div>
              <div class="cb-plot__body">
                <FitTimeline data={ok()!} />
              </div>
            </section>
          </div>
        </div>

        <div class="cb-place-foot cb-muted cb-as-foot">
          <span>
            Neural input: deconvolved events · {ok()!.cells} cells · {Number(ok()!.fs.toFixed(2))} Hz
          </span>
          <span>
            Preprocess: smoothing {smoothing()} · label padding {prep.labelPadS} s · {' '}
            <button class="cb-link" onClick={() => goToStep('prep')}>
              Go to Preprocess
            </button>
          </span>
          <PopButton
            label="How this analysis works"
            title="How this analysis works"
            width={520}
            class="cb-link cb-as-how"
            button="How this analysis works"
          >
            <p>
              auROC measures how consistently neural events are higher during one group of frames
              than another: a behavior against all other frames, or against a second behavior.
              Time-shifted data are used to test significance.
            </p>
            <p>
              <strong>Compare neural events:</strong> For each cell, auROC is the probability that
              a randomly chosen frame during the behavior has higher neural activity than a
              randomly chosen frame in the comparison group. Against all other frames, the
              comparison group is every frame outside the behavior, including unlabeled frames.
              Against another behavior, it is that behavior's frames only; frames in neither
              behavior, and frames in both, are left out. Frames excluded in Preprocess are left
              out of both groups.
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
              neural value among the included frames, or when either group has fewer than{' '}
              {MIN_FRAMES} included frames. These results are not zero and not nonsignificant; they
              are left out of the counts of evaluated cells.
            </p>
            <p>
              <strong>Direction alone does not establish significance.</strong>
            </p>
          </PopButton>
        </div>

        <Show when={advanced()}>
          <Modal
            title="Advanced options"
            onClose={() => {
              setAdvanced(false);
              advBtn.focus();
            }}
          >
            <div class="cb-as-adv-body">
              <NumberBox k="seed" label="Random seed" step={1}>
                Controls the random shifts so the same analysis can be reproduced: the same seed, settings and data give the same shifts and results.
              </NumberBox>
              <Show
                when={aurocSettings.method === 'speed'}
                fallback={
                  <p class="cb-muted">
                    Speed-matching settings appear here when the null method is speed-matched.
                  </p>
                }
              >
                <h4>Speed matching</h4>
                <p class="cb-muted">Balance measure and tolerance are set next to the null method.</p>
                <div class="cb-setting">
                  <Title text="Candidates per shift">
                    The most candidate shifts tried when looking for one that matches.
                  </Title>
                  <label
                    class="cb-prep-field"
                    classList={{ 'cb-prep-field--changed': aurocSettings.match.maxTries !== 20 }}
                  >
                    <input
                      type="number"
                      aria-label="Candidates per shift"
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
                <p class="cb-muted">
                  KS distance, tolerance 0.10 and 20 candidates per shift are the framework’s
                  starting settings, not validated standards. There is no cut-off for a low
                  acceptance rate; the run stops if no shift can be matched, and does not fall back
                  to unmatched shifts.
                </p>
                <Show when={!ok()!.speed}>
                  <div class="cb-note">Speed matching needs a loaded position file.</div>
                </Show>
                <Title text="Behaviors eligible for speed matching">
                  Behaviors with enough included frames for speed matching.
                </Title>
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
              </Show>
            </div>
          </Modal>
        </Show>
        <Show when={big()}>
          <Modal
            big
            title="Behavior timeline"
            onClose={() => {
              setBig(false);
              bigBtn.focus();
            }}
          >
            <div class="cb-plot__body">
              <FitTimeline data={ok()!} />
            </div>
          </Modal>
        </Show>
      </Show>
      <div class="cb-pe-foot">
        <span class="cb-pe-foot__text">
          <Show when={running()} fallback={<span class="cb-muted">{runStatus()}</span>}>
            <progress class="cb-progress" value={running()!.done} max={running()!.total} />
            <span class="cb-muted">{running()!.step}</span>
          </Show>
        </span>
        {runButton()}
      </div>
    </div>
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
