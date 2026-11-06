import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { Requirements } from '../components/Requirements.tsx';
import { SectionList, StageBar, StageFooter } from '../components/GuidedSetup.tsx';
import { HowItWorks } from '../components/GuidedReview.tsx';
import { guided } from '../lib/guided.ts';
import { matchGroupsOf, MIN_FRAMES } from '../lib/auroc.ts';
import {
  aurocData,
  aurocPlan,
  aurocProgressText,
  pairIndexes,
  aurocOutcome,
  seedAurocSelection,
  aurocSettings,
  aurocSettingIssues,
  aurocShowResults,
  aurocStatus,
  AUROC_RANGES,
  autoShift,
  cancelAurocRun,
  DEFAULT_AUROC_SETTINGS,
  estimateMinShift,
  runAuroc,
  setAurocSettings,
  setAurocShowResults,
  watchAurocRuns,
  type AurocData,
} from '../lib/auroc-run.ts';
import { aurocChanges, aurocColor } from '../lib/auroc-view.ts';
import { countOf, frameSelection, groupCounts } from '../lib/auroc-setup.ts';
import { engineFor, frameworkReady, startRunTracking } from '../lib/engine.ts';
import { prep } from '../lib/preprocess.ts';
import { InfoTip } from './InfoTip.tsx';
import { inRange, rangeText } from '../lib/ranges.ts';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton } from './QcParts.tsx';
import { AurocFramesSection } from './AurocSetupFrames.tsx';
import { AurocConditionsSection } from './AurocSetupConditions.tsx';
import { AurocTestingSection } from './AurocSetupTesting.tsx';
import { AurocMethodText, AurocTypeSection } from './AurocSetupFields.tsx';
import {
  AurocReviewStage,
  AurocRunStage,
  aurocSections,
  aurocSummary,
  type AurocSetupView,
} from './AurocSetupReview.tsx';
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
        aria-label="auROC scale from 0 (lower neural values during the behavior) to 1 (higher)"
      >
        <For each={stops}>{(v) => <span style={{ background: aurocColor(v) }} />}</For>
      </div>
      <div class="cb-auroc-scale__ends">
        <span>
          <b class="cb-auroc-low">Below 0.5</b>
          Lower neural values during behavior
        </span>
        <span>
          <b>0.5</b>No tendency
        </span>
        <span>
          <b class="cb-auroc-high">Above 0.5</b>Higher neural values during behavior
        </span>
      </div>
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

/** A number box; an out-of-range value is kept and marked, and the run says why it is blocked. */
export function NumInput(props: {
  k: NumKey;
  step: number;
  unit?: string;
  label?: string;
}): JSX.Element {
  const r = () => AUROC_RANGES[props.k];
  const bad = () => !inRange(aurocSettings[props.k], r());
  return (
    <label
      class="cb-prep-field"
      classList={{ 'cb-prep-field--changed': changed(props.k), 'cb-pe-bad': bad() }}
    >
      <input
        type="number"
        aria-label={props.label}
        aria-invalid={bad() || undefined}
        title={bad() ? `${r().name}: ${rangeText(r())}` : undefined}
        min={r().min}
        max={r().max}
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

const SECTIONS = ['type', 'conditions', 'frames', 'testing'];
// Kept outside the page so the open stage and section survive a visit to the results.
const g = guided('auroc', 'type');

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
  // The same plan the run uses, so the counts on this page are the run's counts.
  const plan = createMemo(() =>
    ok()
      ? aurocPlan(ok()!, { ...aurocSettings, unselected: [...aurocSettings.unselected] })
      : undefined,
  );
  const selected = () => plan()?.labels ?? [];
  const pairMode = () => aurocSettings.compare === 'behavior' && ok()!.labels.length >= 2;
  const pair = () => pairIndexes(ok()!, aurocSettings);
  const eligible = () => countOf(ok()!.mask);
  const counts = createMemo(() => (plan() ? groupCounts(plan()!, eligible()) : []));
  const frames = createMemo(() => (ok() ? frameSelection(ok()!) : undefined));
  const tooFew = (i: number) =>
    ok()!.info[i].during < MIN_FRAMES || ok()!.info[i].outside < MIN_FRAMES;

  // Behaviors with too few frames, and behaviors not marked measured, start out unselected, once,
  // when the data first appear. Every behavior stays in the list.
  let seeded = false;
  createEffect(() => {
    const d = ok();
    if (!d || seeded) return;
    seeded = true;
    seedAurocSelection(d);
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

  const matchEligible = createMemo(() => {
    if (!plan()) return [];
    const { matched } = matchGroupsOf(plan()!.input, aurocSettings.match.minFrames);
    return selected().map((label, i) => ({ label, matched: matched[i] }));
  });

  /** What the table shows for one behavior: its frame counts and whether they are enough. */
  const rowCounts = (i: number) => {
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
  let advBtn!: HTMLButtonElement;
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  const settingIssues = () => aurocSettingIssues(aurocSettings);
  const framework = () => engineFor('auroc') === 'framework';
  const previewBlocked = () =>
    !framework()
      ? 'Needs the framework engine. Against another behavior, auROC runs on the browser engine, and Quick preview runs only on the framework engine.'
      : !frameworkReady()
        ? 'Needs the framework engine, which is not connected.'
        : undefined;
  const blocked = () =>
    running()
      ? 'A run is in progress.'
      : !ok()
        ? 'Load the data auROC needs to run.'
        : !selected().length
          ? 'Select at least one behavior to run.'
          : settingIssues().length
            ? settingIssues()[0]
            : framework() && !frameworkReady()
              ? 'The framework engine is not connected. Use the browser engine button above, or connect the bridge.'
              : undefined;
  const start = (preview: boolean, engine?: 'browser') => {
    g.setStage('run');
    void runAuroc({ ...(preview ? { preview: true } : {}), ...(engine ? { engine } : {}) });
  };

  const status = () => {
    const s = running();
    if (s) return `${s.step}${aurocProgressText(s) ? ` (${aurocProgressText(s)})` : '…'}`;
    if (!ok()) return 'Needs data';
    return blocked() ? 'Needs attention' : 'Ready to run';
  };
  const behaviorNames = () => selected().join(', ') || 'none selected';
  const smoothing = () => (prep.eventSigmaS ? `Gaussian σ = ${prep.eventSigmaS} s` : 'none');
  const minP = () => 2 / (aurocSettings.nShuffles + 1);
  const shiftText = () =>
    aurocSettings.shiftAuto
      ? autoShift()
        ? `Auto, ${autoShift()!.minShiftS} s`
        : 'Auto'
      : `${aurocSettings.minShiftS} s`;
  const methodText = () =>
    aurocSettings.method === 'speed' ? 'Speed-matched circular shift' : 'Circular shift';
  const correctionText = () => (aurocSettings.correction === 'max_stat' ? 'Max-stat' : 'None');

  // Past the empty state these always hold data, which the section components rely on.
  const okData = ok as () => AurocData;
  const framesData = frames as AurocSetupView['frames'];
  const view: AurocSetupView = {
    ok: okData,
    pairMode,
    pair,
    selected,
    frames: framesData,
    settingIssues,
    framework,
    behaviorNames,
    smoothing,
    shiftText,
    methodText,
    correctionText,
  };
  const sections = () => aurocSections(view);
  const summary = () => aurocSummary(view);

  return (
    <div class="cb-place cb-gs cb-au" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>
            auROC analysis
            <InfoTip label="About the auROC analysis">
              Identifies cells with higher or lower neural events during a behavior than in a
              reference group of frames.
            </InfoTip>
            <HowItWorks title="How the auROC analysis works">
              <div class="cb-muted">
                <AurocMethodText />
              </div>
            </HowItWorks>
          </h2>
        </div>
        <div class="cb-place-head__side">
          <span class="cb-place-method__status">
            <i classList={{ 'cb-dot--ok': !!ok() && !blocked() }} /> {status()}
          </span>
          <Show when={ok()}>
            <span class="cb-muted">{ok()!.cells} cells</span>
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
                <p>
                  Cells:{' '}
                  {ok()!
                    .cellsMissing.map((c) => ok()!.cellIds[c] + 1)
                    .join(', ')}
                </p>
              </PopButton>
            </Show>
          </Show>
        </div>
        <div class="cb-controls">
          <Show when={aurocOutcome()}>
            <button class="btn-secondary" onClick={() => setAurocShowResults(true)}>
              {aurocChanges().length ? 'View results (earlier settings)' : 'View results'}
            </button>
          </Show>
        </div>
      </div>

      <StageBar
        g={g}
        done={{
          configure: SECTIONS.every((id) => g.reviewed(id)),
          review: !!aurocOutcome() && aurocOutcome()!.record?.scope === 'preview',
          run: !!aurocOutcome() && aurocOutcome()!.record?.scope !== 'preview',
        }}
      />
      <Show when={error() && g.stage() !== 'run'}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ok()}>
        <div class="cb-empty">
          {(data() as { error: string }).error} auROC needs deconvolved neural data, neural
          timestamps and behavior annotations.
          <Show when={aurocSettings.speedFilter}>
            <div>
              <button class="btn-secondary" onClick={() => setAurocSettings('speedFilter', false)}>
                Turn off the speed filter
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={ok() && g.stage() === 'configure'}>
        <SectionList g={g} label="auROC settings" sections={sections()}>
          {(id) => (
            <>
              <Show when={id === 'type'}>
                <AurocTypeSection />
              </Show>

              <Show when={id === 'conditions'}>
                <AurocConditionsSection
                  ok={okData}
                  pairMode={pairMode}
                  pair={pair}
                  counts={counts}
                  eligible={eligible}
                  rowCounts={rowCounts}
                  tooFew={tooFew}
                  insufficient={insufficient}
                  toggle={toggle}
                />
              </Show>

              <Show when={id === 'frames'}>
                <AurocFramesSection frames={framesData} />
              </Show>

              <Show when={id === 'testing'}>
                <AurocTestingSection
                  ok={okData}
                  selected={selected}
                  minP={minP}
                  openAdvanced={() => setAdvanced(true)}
                  advancedButton={(el: HTMLButtonElement) => (advBtn = el)}
                />
              </Show>
            </>
          )}
        </SectionList>
      </Show>

      <Show when={ok() && g.stage() === 'review'}>
        <AurocReviewStage
          g={g}
          summary={summary}
          ok={okData}
          plan={plan as () => NonNullable<ReturnType<typeof aurocPlan>>}
          pairMode={pairMode}
          running={running}
          previewBlocked={previewBlocked}
          blocked={blocked}
          start={start}
        />
      </Show>

      <Show when={ok() && g.stage() === 'run'}>
        <AurocRunStage running={running()} error={error()} />
      </Show>

      <StageFooter
        g={g}
        status={
          <span>
            <i classList={{ 'cb-dot--ok': !!ok() && !blocked() }} /> {status()}
          </span>
        }
        actions={
          <Show when={running()}>
            <button class="btn-secondary" onClick={cancelAurocRun}>
              Cancel
            </button>
          </Show>
        }
      />

      <Show when={ok() && advanced()}>
        <Modal
          title="Advanced options"
          onClose={() => {
            setAdvanced(false);
            advBtn?.focus();
          }}
        >
          <div class="cb-as-adv-body">
            <NumberBox k="seed" label="Random seed" step={1}>
              Controls the random shifts so the same analysis can be reproduced: the same seed,
              settings and data give the same shifts and results.
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
                KS distance, tolerance 0.10 and 20 candidates per shift are the framework’s starting
                settings, not validated standards. There is no cut-off for a low acceptance rate;
                the run stops if no shift can be matched, and does not fall back to unmatched
                shifts.
              </p>
              <Title text="Behaviors eligible for speed matching">
                Behaviors with enough included frames for speed matching.
              </Title>
              <For each={matchEligible()}>
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
    </div>
  );
}

/** The auROC page: its settings, or after a run its results. */
export function AurocPanel(): JSX.Element {
  startRunTracking();
  watchAurocRuns();
  return (
    <>
      <Requirements analysis="auroc" />
      <Show when={aurocShowResults() && aurocOutcome()} keyed fallback={<AurocSetup />}>
        {(out) => <AurocResults out={out} onEdit={() => setAurocShowResults(false)} />}
      </Show>
    </>
  );
}
