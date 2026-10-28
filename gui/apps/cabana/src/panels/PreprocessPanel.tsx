import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { arena, effectiveBin } from '../lib/arena.ts';
import { setAnalysisId } from '../lib/analyses.ts';
import { aurocChanges } from '../lib/auroc-view.ts';
import { pethChanges } from '../lib/peth-view.ts';
import { ANALYSIS_LABEL, STEPS, usedBy, type StepId } from '../lib/prep-deps.ts';
import { PARAM_TIP, STEP_HELP } from '../lib/prep-help.ts';
import {
  frames,
  gapSummary,
  helpTab,
  isOn,
  labelRows,
  numKey,
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
import { placeChanges } from '../lib/place-ui.ts';
import { DEFAULT_PREP, prep, setPrep } from '../lib/preprocess.ts';
import { positionOnNeural } from '../lib/prepared.ts';
import { preprocessYaml } from '../lib/session-config.ts';
import { frameTimes, goToStep, layout } from '../lib/store.ts';
import { span } from '../lib/viz.ts';
import { InfoTip } from './InfoTip.tsx';
import { HelpDrawer, openHelp } from './PrepHelp.tsx';
import { PrepPlots } from './PrepPlots.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton, StatusIcon } from './QcParts.tsx';

const stepsOf = (kind: 'optional' | 'automatic') =>
  (Object.keys(STEPS) as StepId[]).filter((s) => STEPS[s].kind === kind);

const AUTO_LINE: Partial<Record<StepId, () => string>> = {
  positionOnFrames: () => `gaps over ${prep.maxGapS} s stay missing`,
  speed: () => `${prep.speedWindowS} s window`,
  boutLabels: () => 'one label per neural frame',
};

const toAnalysis = (id: 'place' | 'auroc' | 'peth') => {
  setAnalysisId(id);
  goToStep('analyze');
};

// ---- Navigator

function StepRow(props: { id: StepId }): JSX.Element {
  const on = () => prepStep() === props.id;
  const optional = () => STEPS[props.id].kind === 'optional';
  return (
    <li>
      <button
        type="button"
        class="cb-prep-row"
        classList={{ 'cb-prep-row--on': on() }}
        aria-current={on() ? 'true' : undefined}
        onClick={() => setPrepStep(props.id)}
      >
        <Show when={optional()}>
          <span
            class="cb-prep-dot"
            classList={{ 'cb-prep-dot--on': isOn(props.id) }}
            aria-hidden="true"
          />
        </Show>
        <span class="cb-prep-row__text">
          <span class="cb-prep-row__name">{STEPS[props.id].label}</span>
          <span class="cb-muted">
            {optional() ? (isOn(props.id) ? 'On' : 'Off') : AUTO_LINE[props.id]?.()}
          </span>
        </span>
      </button>
    </li>
  );
}

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

function Navigator(): JSX.Element {
  const onSteps = () => stepsOf('optional').filter(isOn);
  const atDefault = () =>
    onSteps().some(
      (s) => DEFAULT_PREP[numKey(s)] > 0 && prep[numKey(s)] === DEFAULT_PREP[numKey(s)],
    );
  return (
    <nav class="cb-prep__nav" aria-label="Preprocessing steps">
      <h3 class="cb-prep__label">Optional steps</h3>
      <ul>
        <For each={stepsOf('optional')}>{(s) => <StepRow id={s} />}</For>
      </ul>
      <Fold title="Automatic preparation">
        <ul>
          <For each={stepsOf('automatic')}>{(s) => <StepRow id={s} />}</For>
        </ul>
      </Fold>
      <Fold title="Analysis-specific settings">
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
      <div class="cb-prep__count cb-muted">
        {onSteps().length} optional {onSteps().length === 1 ? 'step' : 'steps'} on
        {atDefault() ? ' (software defaults)' : ''}
      </div>
    </nav>
  );
}

// ---- Settings

type FieldDef = {
  k: Exclude<keyof typeof PARAM_TIP, 'posMethod'>;
  label: string;
  unit: string;
  step: number;
};
const FIELDS: Partial<Record<StepId, FieldDef[]>> = {
  eventSmooth: [{ k: 'eventSigmaS', label: 'Width', unit: 's', step: 0.05 }],
  fillGaps: [{ k: 'fillGapS', label: 'Fill runs up to', unit: 's', step: 0.1 }],
  posSmooth: [{ k: 'posWindowS', label: 'Window', unit: 's', step: 0.05 }],
  boutPad: [{ k: 'labelPadS', label: 'Widen each bout by', unit: 's each side', step: 0.05 }],
  positionOnFrames: [{ k: 'maxGapS', label: 'Gap limit', unit: 's', step: 0.1 }],
  speed: [{ k: 'speedWindowS', label: 'Window', unit: 's', step: 0.05 }],
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

function Settings(props: { step: StepId }): JSX.Element {
  const optional = () => STEPS[props.step].kind === 'optional';
  const changed = () => STEPS[props.step].keys.some((k) => prep[k] !== DEFAULT_PREP[k]);
  const reset = () => STEPS[props.step].keys.forEach((k) => setPrep(k, DEFAULT_PREP[k]));
  return (
    <div class="cb-prep-set">
      <Show
        when={!optional() || isOn(props.step)}
        fallback={<span class="cb-muted">Off. Turn on to set the value.</span>}
      >
        <Show when={props.step === 'posSmooth'}>
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
        <For each={FIELDS[props.step]}>{(f) => <Field f={f} zeroOk={!optional()} />}</For>
        <Show when={changed()}>
          <button class="cb-link" onClick={reset}>
            Reset
          </button>
        </Show>
      </Show>
      <Show when={!(FIELDS[props.step] ?? []).length}>
        <span class="cb-muted">No settings. Padding is set under Bout padding.</span>
      </Show>
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
      <span class="cb-muted">Live</span>
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

const CHANGES = { place: placeChanges, auroc: aurocChanges, peth: pethChanges };

function OutOfDate(props: { step: StepId }): JSX.Element {
  const stale = () => usedBy(props.step).filter((u) => CHANGES[u.id]().length);
  return (
    <For each={stale()}>
      {(u) => (
        <span
          class="cb-prep-stale"
          title={`Changed since the last run: ${CHANGES[u.id]().join(', ')}`}
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

export function PreprocessPanel(): JSX.Element {
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  onCleanup(() => setHelpTab(undefined));
  createEffect(on(prepStep, () => setHelpTab(undefined), { defer: true }));
  const step = prepStep;
  const optional = () => STEPS[step()].kind === 'optional';
  const download = () => {
    const url = URL.createObjectURL(new Blob([preprocessYaml()], { type: 'text/yaml' }));
    Object.assign(document.createElement('a'), { href: url, download: 'preprocess.yaml' }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div class="cb-prep" ref={root}>
      <div class="cb-prep__top">
        <h2>Preprocess</h2>
        <span class="cb-muted">Optional changes before analysis. Loaded files stay unchanged.</span>
        <span class="cb-prep__rel">
          Analysis relevance
          <InfoTip label="About analysis relevance">
            The "Used by" lines come from what each analysis reads. Turning a step on affects only
            the analyses that use it.
          </InfoTip>
        </span>
      </div>
      <div class="cb-prep__body">
        <Navigator />
        <main class="cb-prep__main">
          <div class="cb-prep__head">
            <h3>{STEPS[step()].label}</h3>
            <Show when={optional()} fallback={<span class="cb-muted">Always on</span>}>
              <button
                type="button"
                role="switch"
                class="cb-prep-switch"
                aria-checked={isOn(step())}
                aria-label={`${STEPS[step()].label}: ${isOn(step()) ? 'on' : 'off'}`}
                onClick={() => setOn(step(), !isOn(step()))}
              >
                <span aria-hidden="true" />
                {isOn(step()) ? 'On' : 'Off'}
              </button>
            </Show>
          </div>
          <p class="cb-prep__short">{STEP_HELP[step()]?.short}</p>
          <p class="cb-prep__used">
            {usedLine(step())}.{' '}
            <button
              class="cb-link"
              aria-haspopup="dialog"
              aria-expanded={helpTab() !== undefined}
              onClick={() => openHelp('about')}
            >
              About this step
            </button>
          </p>
          <Settings step={step()} />
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
        <Show when={layout() === 'sidebar'}>
          <button class="btn-primary" onClick={() => goToStep('analyze')}>
            Continue to Analyze →
          </button>
        </Show>
      </div>
    </div>
  );
}
