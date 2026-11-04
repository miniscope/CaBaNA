import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { arena, effectiveBin } from '../lib/arena.ts';
import { setAnalysisId } from '../lib/analyses.ts';
import { aurocChanges } from '../lib/auroc-view.ts';
import { pethChanges } from '../lib/peth-view.ts';
import { ANALYSIS_LABEL, DEPS, STEPS, usedBy, type StepId } from '../lib/prep-deps.ts';
import { PARAM_TIP, STEP_HELP } from '../lib/prep-help.ts';
import {
  frames,
  gapSummary,
  helpTab,
  isOn,
  labelRows,
  prepStep,
  prepWindow,
  runs,
  setHelpTab,
  setOn,
  setPrepStep,
  setValue,
  setWinFrom,
  setWinS,
  stepIssue,
  usedLine,
  usedList,
  winS,
  winStart,
} from '../lib/prep-view.ts';
import { prepSummary } from '../lib/prep-summary.ts';
import { placeChanges } from '../lib/place-ui.ts';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { positionOnNeural } from '../lib/prepared.ts';
import { preprocessYaml } from '../lib/session-config.ts';
import { frameTimes, goToStep } from '../lib/store.ts';
import { span } from '../lib/viz.ts';
import { InfoTip } from './InfoTip.tsx';
import { HelpDrawer, openHelp } from './PrepHelp.tsx';
import { PrepPlots } from './PrepPlots.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton, StatusIcon } from './QcParts.tsx';

/** What each preview tab holds, in the order shown. */
const GROUPS = {
  behavior: {
    label: 'Behavioral',
    optional: ['posSmooth', 'fillGaps', 'boutPad'],
    standard: ['positionOnFrames', 'speed', 'boutLabels'],
  },
  neural: { label: 'Neural', optional: ['eventSmooth', 'traceSmooth'], standard: [] },
} as const satisfies Record<string, { label: string; optional: StepId[]; standard: StepId[] }>;
type GroupId = keyof typeof GROUPS;
const viewsOf = (g: GroupId): StepId[] => [...GROUPS[g].optional, ...GROUPS[g].standard];
const groupOf = (s: StepId): GroupId => (viewsOf('neural').includes(s) ? 'neural' : 'behavior');

const toAnalysis = (id: keyof typeof DEPS) => {
  setAnalysisId(id);
  goToStep('analyze');
};

// ---- Settings column

function Fold(props: { title: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="cb-prep-fold">
      <button type="button" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span aria-hidden="true">{open() ? '▾' : '▸'}</span> {props.title}
      </button>
      <Show when={open()}>{props.children}</Show>
    </div>
  );
}

type FieldDef = {
  k: Exclude<keyof typeof PARAM_TIP, 'posMethod'>;
  label: string;
  unit: string;
  step: number;
};
const FIELDS: Partial<Record<StepId, FieldDef[]>> = {
  eventSmooth: [{ k: 'eventSigmaS', label: 'Width', unit: 's', step: 0.05 }],
  traceSmooth: [{ k: 'traceSigmaS', label: 'Width', unit: 's', step: 0.05 }],
  fillGaps: [{ k: 'fillGapS', label: 'Fill runs up to', unit: 's', step: 0.1 }],
  posSmooth: [{ k: 'posWindowS', label: 'Window', unit: 's', step: 0.05 }],
  boutPad: [{ k: 'labelPadS', label: 'Widen each bout by', unit: 's each side', step: 0.05 }],
  positionOnFrames: [{ k: 'maxGapS', label: 'Gap limit', unit: 's', step: 0.1 }],
  speed: [{ k: 'speedWindowS', label: 'Speed window', unit: 's', step: 0.05 }],
};

/** A number box. Optional steps take only values above 0 here; the switch turns them off. */
function Field(props: { f: FieldDef; zeroOk: boolean }): JSX.Element {
  const { k } = props.f;
  const dflt = DEFAULT_PREP[k];
  return (
    <div class="cb-prep-set__field">
      <label classList={{ 'cb-prep-field--changed': prep[k] !== dflt }}>
        {props.f.label}{' '}
        <input
          type="number"
          min={props.zeroOk ? 0 : 0.01}
          step={props.f.step}
          value={prep[k]}
          onInput={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (props.zeroOk ? v >= 0 : v > 0) setValue(k, v);
          }}
          onChange={(e) => (e.currentTarget.value = String(prep[k]))}
        />{' '}
        {props.f.unit}
      </label>
      <InfoTip label={`About ${props.f.label.toLowerCase()}`}>{PARAM_TIP[k]}</InfoTip>
      <span class="cb-muted">
        Default {dflt} {props.f.unit.replace(' each side', '')}
        {dflt === 0 ? ' (off)' : ''}
      </span>
    </div>
  );
}

/** Selects a step in the preview column. */
function PreviewLink(props: { id: StepId }): JSX.Element {
  return (
    <button
      type="button"
      class="cb-link"
      aria-current={prepStep() === props.id ? 'true' : undefined}
      onClick={() => setPrepStep(props.id)}
    >
      {prepStep() === props.id ? 'Previewing' : 'Preview'}
    </button>
  );
}

/** "Used by" text of a step. Nothing in DEPS reads it only for trace smoothing, which says "yet". */
const usedText = (id: StepId) =>
  usedBy(id).length ? usedLine(id) : 'Not used by any analysis yet';

/** One optional step: switch, title, its values inline, and what uses it. */
function OptionRow(props: { id: StepId }): JSX.Element {
  const on = () => isOn(props.id);
  const changed = () => STEPS[props.id].keys.some((k) => prep[k] !== DEFAULT_PREP[k]);
  const reset = () => STEPS[props.id].keys.forEach((k) => setPrep(k, DEFAULT_PREP[k]));
  return (
    <div class="cb-pp-row" classList={{ 'cb-pp-row--shown': prepStep() === props.id }}>
      <div class="cb-pp-row__head">
        <button
          type="button"
          role="switch"
          class="cb-prep-switch"
          aria-checked={on()}
          aria-label={`${STEPS[props.id].label}: ${on() ? 'on' : 'off'}`}
          onClick={() => {
            setOn(props.id, !on());
            setPrepStep(props.id);
          }}
        >
          <span aria-hidden="true" />
          {on() ? 'On' : 'Off'}
        </button>
        <strong>{STEPS[props.id].label}</strong>
        <PreviewLink id={props.id} />
      </div>
      <div class="cb-muted">{STEP_HELP[props.id]?.short}</div>
      <div class="cb-pp-row__used">{usedText(props.id)}</div>
      <Show when={on()}>
        <div class="cb-pp-row__set" onFocusIn={() => setPrepStep(props.id)}>
          <Show when={props.id === 'posSmooth'}>
            <div class="cb-prep-set__field">
              <label>
                Method{' '}
                <select
                  value={prep.posMethod}
                  onChange={(e) =>
                    setPrep('posMethod', e.currentTarget.value as 'median' | 'gaussian')
                  }
                >
                  <option value="median">Median</option>
                  <option value="gaussian">Gaussian</option>
                </select>
              </label>
              <InfoTip label="About method">{PARAM_TIP.posMethod}</InfoTip>
              <span class="cb-muted">Default {DEFAULT_PREP.posMethod}</span>
            </div>
          </Show>
          <For each={FIELDS[props.id]}>{(f) => <Field f={f} zeroOk={false} />}</For>
          <Show when={changed()}>
            <button class="cb-link" onClick={reset}>
              Reset
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** A standard step: information only, no switch. */
function StandardRow(props: { id: StepId }): JSX.Element {
  return (
    <div class="cb-pp-std" classList={{ 'cb-pp-row--shown': prepStep() === props.id }}>
      <span class="cb-pp-std__dot" aria-hidden="true" />
      <div>
        <strong>{STEPS[props.id].label}</strong>
        <span class="cb-muted"> {STEP_HELP[props.id]?.short}</span>
        <div class="cb-pp-row__used">{usedText(props.id)}</div>
      </div>
      <PreviewLink id={props.id} />
    </div>
  );
}

function SectionHead(props: { title: string; note: string }): JSX.Element {
  return (
    <header class="cb-pp-sec__head">
      <h3>{props.title}</h3>
      <span class="cb-muted">{props.note}</span>
    </header>
  );
}

function Settings(): JSX.Element {
  const std = GROUPS.behavior.standard;
  return (
    <div class="cb-pp-settings">
      <section class="cb-pp-sec" aria-label="Behavioral preprocessing">
        <SectionHead title="Behavioral" note="Position tracking and behavior labels." />
        <For each={GROUPS.behavior.optional}>{(s) => <OptionRow id={s} />}</For>
      </section>
      <section class="cb-pp-sec" aria-label="Neural preprocessing">
        <SectionHead title="Neural" note="Deconvolved events and traces." />
        <For each={GROUPS.neural.optional}>{(s) => <OptionRow id={s} />}</For>
      </section>
      <section class="cb-pp-sec" aria-label="Standard preparation">
        <SectionHead title="Standard" note="Automatically performed as needed for analysis." />
        <For each={std}>{(s) => <StandardRow id={s} />}</For>
        <Fold title="Advanced">
          <div class="cb-pp-row__set">
            <For each={std.flatMap((s) => FIELDS[s] ?? [])}>
              {(f) => <Field f={f} zeroOk={true} />}
            </For>
          </div>
        </Fold>
      </section>
      <Fold title="Analysis settings (edited in each analysis)">
        <div class="cb-prep-ro">
          <div>
            <b>Speed filter</b> {prep.minSpeed} cm/s <span class="cb-prep-tag">shared</span>
            <div class="cb-muted">{usedList('speedFilter')}</div>
          </div>
          <div>
            <b>Spatial bins</b> {effectiveBin()} cm
            <div class="cb-muted">min time per bin {arena.minOccupancy} s</div>
          </div>
          <div class="cb-muted">
            Edit in each analysis's setup:{' '}
            <For each={usedBy('speedFilter')}>
              {(u, i) => (
                <>
                  {i() > 0 && ', '}
                  <button class="cb-link" onClick={() => toAnalysis(u.id)}>
                    {u.label}
                  </button>
                </>
              )}
            </For>
          </div>
        </div>
      </Fold>
    </div>
  );
}

// ---- Preview controls, impact and out-of-date lines

function PreviewBar(props: { step: StepId }): JSX.Element {
  const gap = () => props.step === 'fillGaps';
  const centers = () => {
    const t = frameTimes();
    return t ? runs().map((r) => t[Math.min(t.length - 1, r.start + Math.floor(r.len / 2))]) : [];
  };
  // After a jump, compare against the gap jumped to: the window may be pinned at a session edge.
  const [jump, setJump] = createSignal<{ at: number; c: number }>();
  const ref = () => {
    const j = jump();
    return j && Math.abs(j.at - winStart()) < 1e-6 ? j.c : winStart() + winS() / 2;
  };
  const prev = () => [...centers()].reverse().find((c) => c < ref() - 0.01);
  const next = () => centers().find((c) => c > ref() + 0.01);
  const go = (c: number | undefined) => {
    if (c === undefined) return;
    setWinFrom(c - winS() / 2);
    setJump({ at: winStart(), c });
  };
  const shift = (d: number) => setWinFrom(winStart() + d * winS());
  const [t0, t1] = [() => span()[0], () => span()[1]];
  return (
    <div class="cb-prep-bar">
      <strong>Preview</strong>
      <label class="cb-prep-bar__win">
        Window{' '}
        <select value={winS()} onChange={(e) => setWinS(+e.currentTarget.value)}>
          <For each={[10, 20, 60]}>{(s) => <option value={s}>{s} s</option>}</For>
        </select>
      </label>
      <button
        class="btn-secondary btn-small"
        disabled={gap() ? prev() === undefined : winStart() <= t0()}
        onClick={() => (gap() ? go(prev()) : shift(-1))}
      >
        {gap() ? 'Previous gap' : 'Previous'}
      </button>
      <button
        class="btn-secondary btn-small"
        disabled={gap() ? next() === undefined : prepWindow()[1] >= t1()}
        onClick={() => (gap() ? go(next()) : shift(1))}
      >
        {gap() ? 'Next gap' : 'Next'}
      </button>
      <span class="cb-muted">
        {prepWindow()[0].toFixed(0)} to {prepWindow()[1].toFixed(0)} s
      </span>
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Impact(props: { step: StepId }): JSX.Element {
  const share = (n: number) => ((100 * n) / (frameTimes()?.length || 1)).toFixed(1);
  const g = gapSummary;
  const padded = () => props.step === 'boutPad';
  const labelTotals = () => ({
    scored: labelRows().reduce((s, r) => s + r.nScored, 0),
    after: labelRows().reduce((s, r) => s + (padded() ? r.nPadded : r.nScored), 0),
  });
  return (
    <>
      <Show when={props.step === 'fillGaps' && positionOnNeural()}>
        <span>
          {plural(g().filled.n, 'run')} filled ({plural(g().filled.frames, 'frame')}) · {g().long.n}{' '}
          stay missing · {g().edge.n} at session edges
        </span>
        <PopButton
          label="Details"
          title="Missing position"
          button="Details"
          class="cb-link"
          width={320}
        >
          <ul class="cb-prep-details">
            <li>
              Filled: {plural(g().filled.n, 'run')}, {plural(g().filled.frames, 'frame')}, up to{' '}
              {prep.fillGapS} s each.
            </li>
            <li>
              Longer than the limit: {plural(g().long.n, 'run')}, {plural(g().long.frames, 'frame')}
              .
            </li>
            <li>
              At the session start or end: {plural(g().edge.n, 'run')},{' '}
              {plural(g().edge.frames, 'frame')}.
            </li>
          </ul>
        </PopButton>
      </Show>
      <Show when={['posSmooth', 'speed', 'positionOnFrames'].includes(props.step) && frames()}>
        <span>
          {frames()!.pct.toFixed(1)}% of neural frames have position
          {prep.minSpeed > 0 ? `, speed ≥ ${prep.minSpeed} cm/s` : ''}
        </span>
      </Show>
      <Show when={(padded() || props.step === 'boutLabels') && labelRows().length}>
        <span>
          {plural(labelRows().length, 'behavior')}: {labelTotals().scored} frames as scored
          {padded() ? ` → ${labelTotals().after} as frame labels` : ''}
        </span>
        <PopButton
          label="Details"
          title="Frames per behavior"
          button="Details"
          class="cb-link"
          width={420}
        >
          <table class="cb-stats">
            <thead>
              <tr>
                <th>Behavior</th>
                <th>As scored</th>
                <Show when={padded()}>
                  <th>As labels</th>
                </Show>
                <th>Share of session</th>
              </tr>
            </thead>
            <tbody>
              <For each={labelRows()}>
                {(r) => (
                  <tr>
                    <td>{r.label}</td>
                    <td>{r.nScored}</td>
                    <Show when={padded()}>
                      <td>{r.nPadded}</td>
                    </Show>
                    <td>{share(padded() ? r.nPadded : r.nScored)}%</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </PopButton>
      </Show>
    </>
  );
}

// Decoding and Population mark their own results out of date (engine.ts), so they have no entry here.
const CHANGES: Partial<Record<keyof typeof DEPS, () => string[]>> = {
  place: placeChanges,
  auroc: aurocChanges,
  peth: pethChanges,
};

function OutOfDate(props: { step: StepId }): JSX.Element {
  const stale = () => usedBy(props.step).filter((u) => CHANGES[u.id]?.().length);
  return (
    <For each={stale()}>
      {(u) => (
        <span
          class="cb-prep-stale"
          title={`Changed since the last run: ${CHANGES[u.id]?.().join(', ')}`}
        >
          <StatusIcon status="warn" />
          {ANALYSIS_LABEL[u.id]} results are out of date
          <button class="cb-link" onClick={() => toAnalysis(u.id)}>
            Open {ANALYSIS_LABEL[u.id]}
          </button>
        </span>
      )}
    </For>
  );
}

// ---- Page

const POSITION_VIEWS: StepId[] = ['posSmooth', 'fillGaps', 'positionOnFrames', 'speed'];

/** Counts for the position views: before is the position as put on the neural frames. */
function Summary(): JSX.Element {
  const s = createMemo(() => {
    const p = positionOnNeural();
    return p ? prepSummary(p) : undefined;
  });
  const speed = (v: number | undefined) => (v === undefined ? 'none' : `${v.toFixed(1)} cm/s`);
  return (
    <Show when={s()}>
      {(d) => (
        <div class="cb-pp-summary" aria-label="Preview summary">
          <strong>Summary</strong>
          <span>
            Frames filled: {d().framesFilled} of {d().frames}
          </span>
          <span>
            Frames with position: {d().validBefore} before, {d().validAfter} after
          </span>
          <span>
            Peak speed: {speed(d().peakSpeedBefore)} without position smoothing,{' '}
            {speed(d().peakSpeedAfter)} with it
          </span>
        </div>
      )}
    </Show>
  );
}

export function PreprocessPanel(): JSX.Element {
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  onCleanup(() => setHelpTab(undefined));
  createEffect(on(prepStep, () => setHelpTab(undefined), { defer: true }));
  const step = prepStep;
  const group = () => groupOf(step());
  const download = () => {
    const url = URL.createObjectURL(new Blob([preprocessYaml()], { type: 'text/yaml' }));
    Object.assign(document.createElement('a'), { href: url, download: 'preprocess.yaml' }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div class="cb-prep" ref={root}>
      <div class="cb-prep__top">
        <h2>Preprocess</h2>
        <span class="cb-muted">
          Prepare behavioral and neural data for analysis: smooth, fill gaps and adjust behavior
          label timing. Every optional step can stay off, and loaded files stay unchanged.
        </span>
      </div>
      <div class="cb-pp-body">
        <Settings />
        <main class="cb-prep__main cb-pp-preview">
          <div class="cb-pp-tabs" role="tablist" aria-label="Preview data type">
            <For each={Object.keys(GROUPS) as GroupId[]}>
              {(g) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={group() === g}
                  classList={{ 'cb-pp-tab--on': group() === g }}
                  onClick={() => group() !== g && setPrepStep(viewsOf(g)[0])}
                >
                  {GROUPS[g].label}
                </button>
              )}
            </For>
            <label class="cb-pp-view">
              View{' '}
              <select value={step()} onChange={(e) => setPrepStep(e.currentTarget.value as StepId)}>
                <For each={viewsOf(group())}>
                  {(s) => <option value={s}>{STEPS[s].label}</option>}
                </For>
              </select>
            </label>
            <span class="cb-muted">Previews update as settings change.</span>
          </div>
          <p class="cb-prep__used">
            {STEP_HELP[step()]?.short} {usedText(step())}.{' '}
            <button
              class="cb-link"
              aria-haspopup="dialog"
              aria-expanded={helpTab() !== undefined}
              onClick={() => openHelp('about')}
            >
              About this step
            </button>
          </p>
          <PreviewBar step={step()} />
          <Show
            when={!stepIssue(step())}
            fallback={<div class="cb-empty cb-prep__empty">{stepIssue(step())}</div>}
          >
            <div class="cb-prep__plots">
              <PrepPlots step={step()} />
            </div>
          </Show>
          <div class="cb-prep__impact">
            <Show when={!stepIssue(step())}>
              <Show when={POSITION_VIEWS.includes(step())}>
                <Summary />
              </Show>
              <Impact step={step()} />
            </Show>
            <OutOfDate step={step()} />
          </div>
          <Show when={helpTab()}>
            <HelpDrawer step={step()} />
          </Show>
        </main>
      </div>
      <div class="cb-prep__foot">
        <span class="cb-muted">Preprocessing is optional. Every optional step can stay off.</span>
        <button class="btn-secondary" onClick={download}>
          Download preprocess.yaml
        </button>
      </div>
    </div>
  );
}
