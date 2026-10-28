import { createEffect, createMemo, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  cancelPethRun,
  DEFAULT_PETH_SETTINGS,
  estimateMinShift,
  pethData,
  pethOutcome,
  pethPlan,
  pethReports,
  pethRunIssue,
  pethSettings,
  pethShowResults,
  pethStatus,
  runPeth,
  setPethSettings,
  setPethShowResults,
  type PethData,
} from '../lib/peth-run.ts';
import { windowProblems, type OnsetReport } from '../lib/peth.ts';
import { pethChanges, pethSettingChanges } from '../lib/peth-view.ts';
import { prep } from '../lib/preprocess.ts';
import { goToStep } from '../lib/store.ts';
import { HowTo } from './AurocResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { PethResults } from './PethResults.tsx';
import { Dot } from './PethShared.tsx';
import { SettingsButton, SettingsSummary } from './PethSettings.tsx';
import { PethTimeline } from './PethTimeline.tsx';
import { PethWindow } from './PethWindow.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { createSize, PopButton } from './QcParts.tsx';

const D = DEFAULT_PETH_SETTINGS.params;
const p = () => pethSettings.params;

/** The timeline filling its box, redrawn when the box is resized. */
function FitTimeline(props: { data: PethData; reports: OnsetReport[] | undefined; ready: (b: number) => boolean }): JSX.Element {
  const [size, measure] = createSize();
  return (
    <div class="cb-as-tl" ref={measure}>
      <Show when={size().w > 0}>
        <PethTimeline data={props.data} reports={props.reports} ready={props.ready} w={size().w} h={size().h} />
      </Show>
    </div>
  );
}

/** Excluded onsets by reason, for every behavior; the same table opens from each count. */
function Exclusions(props: { data: PethData; reports: OnsetReport[] }): JSX.Element {
  return (
    <>
      <table class="cb-auroc-table cb-pe-tbl">
        <thead>
          <tr>
            <th>Behavior</th>
            <th class="cb-as-num">Bout shorter than {p().minDurationS} s</th>
            <th class="cb-as-num">Gap under {p().minGapS} s</th>
            <th class="cb-as-num">Onset outside selected frames</th>
            <th class="cb-as-num">Window beyond session</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.data.labels}>
            {(l, b) => (
              <tr>
                <td>{l}</td>
                <td class="cb-as-num">{props.reports[b()].short}</td>
                <td class="cb-as-num">{props.reports[b()].gap}</td>
                <td class="cb-as-num">{props.reports[b()].outside}</td>
                <td class="cb-as-num">{props.reports[b()].edge}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="cb-muted">
        Checked in this order; each onset is counted once, under the first reason. The gap is measured from the end of
        the previous bout of the same behavior, including excluded bouts. PETH uses every frame, so no onset is
        outside the selected frames.
      </p>
    </>
  );
}

function PethSetup(): JSX.Element {
  const data = createMemo(() => pethData());
  const ok = () => {
    const x = data();
    return 'error' in x ? undefined : x;
  };
  const running = () => {
    const s = pethStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const error = () => {
    const s = pethStatus();
    return s.kind === 'error' ? s.message : undefined;
  };
  const reports = createMemo(() => (ok() ? pethReports(ok()!, p()) : undefined));
  const nOnsets = (b: number) => reports()?.[b].onsets.length ?? 0;
  const ready = (b: number) => nOnsets(b) >= p().minEvents;
  const chosen = (b: number) => ready(b) && !pethSettings.unselected.includes(ok()!.labels[b]);
  const readyBehaviors = () => ok()!.labels.flatMap((_, b) => (chosen(b) ? [b] : []));
  const included = () => readyBehaviors().reduce((n, b) => n + nOnsets(b), 0);
  const notEvaluated = () => ok()!.labels.filter((_, b) => !ready(b));
  const issue = () => (ok() ? pethRunIssue(ok()!, pethSettings, reports()) : undefined);
  const toggle = (label: string) =>
    setPethSettings(
      'unselected',
      pethSettings.unselected.includes(label)
        ? pethSettings.unselected.filter((l) => l !== label)
        : [...pethSettings.unselected, label],
    );

  // The automatic minimum shift, worked out ahead of the run so it can be shown here.
  createEffect(() => {
    const d = ok();
    const r = reports();
    if (d && r && pethSettings.test === 'circular' && pethSettings.shiftAuto && !issue())
      estimateMinShift(pethPlan(d, { params: p(), unselected: [...pethSettings.unselected] }, r).input);
  });

  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const changes = () => [...pethChanges(), ...pethSettingChanges()];

  return (
    <div class="cb-place cb-as cb-pe-setup" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>PETH analysis</h2>
          <p class="cb-muted">
            <Show when={ok()} fallback="Peri-event time histograms: neural data aligned to behavior onsets.">
              Smoothed deconvolved trace ({prep.eventSigmaS ? `event smoothing σ ${prep.eventSigmaS} s` : 'no event smoothing'},{' '}
              <button class="cb-link" onClick={() => goToStep('prep')}>
                Preprocess
              </button>
              ) aligned to behavior onsets
            </Show>
          </p>
        </div>
        <Show when={ok()}>
          <div class="cb-place-head__side">
            <span>
              {ok()!.cells} cells · {ok()!.labels.length} behaviors · {+ok()!.fs.toFixed(2)} Hz
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
                  These cells have a non-finite neural value somewhere in the session, so the response is undefined
                  for every behavior. They are kept in the results as Not evaluated and are left out of the counts of
                  evaluated cells.
                </p>
                <p>Cells: {ok()!.cellsMissing.map((c) => ok()!.cellIds[c] + 1).join(', ')}</p>
              </PopButton>
            </Show>
          </div>
        </Show>
        <div class="cb-controls">
          <Show when={pethOutcome()}>
            <button class="btn-secondary" onClick={() => setPethShowResults(true)}>
              {changes().length ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>
      <Show when={pethOutcome() && changes().length}>
        <div class="cb-muted">Changed since the last run: {changes().join(', ')}. Run again to update.</div>
      </Show>
      <Show when={error()}>
        <div class="cb-note">{error()}</div>
      </Show>
      <Show when={!ok()}>
        <div class="cb-empty">
          {(data() as { error: string }).error} PETH needs deconvolved neural data, neural timestamps and behavior
          annotations.
        </div>
      </Show>

      <Show when={ok()}>
        <div class="cb-pe-body">
          <section class="cb-setgroup cb-pe-left">
            <h3>1 · Behavior onsets</h3>
            <div class="cb-pe-mins">
              <div class="cb-pe-min">
                <span class="cb-pe-small">
                Minimum bout duration
                <InfoTip label="About the minimum bout duration">
                  Bouts shorter than this do not give an onset. Onsets are the first frame of each bout of the
                  annotated behavior, without label padding.
                </InfoTip>
                </span>
                <NumField label="Minimum bout duration (s)" value={p().minDurationS} def={D.minDurationS} min={0} step={0.1} unit="s" onSet={(v) => setPethSettings('params', 'minDurationS', v)} />
              </div>
              <div class="cb-pe-min">
                <span class="cb-pe-small">
                Min. gap after previous bout
                <InfoTip label="About the minimum gap">
                  A bout that starts sooner than this after the end of the previous bout of the same behavior is not
                  used, so windows are less likely to contain the previous bout. 0 turns it off.
                </InfoTip>
                </span>
                <NumField label="Minimum gap (s)" value={p().minGapS} def={D.minGapS} min={0} step={0.1} unit="s" onSet={(v) => setPethSettings('params', 'minGapS', v)} />
              </div>
              <div class="cb-pe-min">
                <span class="cb-pe-small">
                Minimum onsets per behavior
                <InfoTip label="About the minimum onsets">
                  A behavior with fewer included onsets is not evaluated: it has no curves, p-values or labels.
                </InfoTip>
                </span>
                <NumField label="Minimum onsets per behavior" value={p().minEvents} def={D.minEvents} min={1} step={1} onSet={(v) => setPethSettings('params', 'minEvents', Math.max(1, Math.round(v)))} />
              </div>
            </div>
            <div class="cb-pe-tablewrap">
              <table class="cb-auroc-table cb-as-tbl cb-pe-tbl">
                <thead>
                  <tr>
                    <th aria-label="Selected" />
                    <th>Behavior</th>
                    <th class="cb-as-num">Bouts</th>
                    <th class="cb-as-num">Included onsets</th>
                    <th class="cb-as-num">Excluded onsets</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={ok()!.info}>
                    {(b, i) => (
                      <tr classList={{ 'cb-muted': !ready(i()) }}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${b.label}`}
                            disabled={!ready(i())}
                            checked={chosen(i())}
                            onChange={() => toggle(b.label)}
                          />
                        </td>
                        <td>
                          <Dot label={b.label} muted={!ready(i())} /> {b.label}
                        </td>
                        <td class="cb-as-num">{b.bouts}</td>
                        <td class="cb-as-num">{reports() ? nOnsets(i()) : '–'}</td>
                        <td class="cb-as-num">
                          <Show when={reports()} fallback="–">
                            <PopButton
                              label={`Excluded onsets of ${b.label}, by reason`}
                              title="Excluded onsets by reason"
                              width={560}
                              class="cb-link"
                              button={b.bouts - nOnsets(i())}
                            >
                              <Exclusions data={ok()!} reports={reports()!} />
                            </PopButton>
                          </Show>
                        </td>
                        <td>
                          <Show when={reports()} fallback="–">
                            <Show
                              when={ready(i())}
                              fallback={`Not evaluated: ${nOnsets(i())} onset${nOnsets(i()) === 1 ? '' : 's'}, minimum ${p().minEvents}`}
                            >
                              <Show
                                when={chosen(i())}
                                fallback={<span>Left out of the run</span>}
                              >
                                <span class="cb-pill cb-pill--good">✓ Ready</span>
                              </Show>
                            </Show>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="cb-muted cb-pe-small">Click an excluded count for the reasons.</div>
            <div class="cb-plot__head cb-pe-tlhead">
              <h4>Session timeline</h4>
              <HowTo title="Session timeline">
                <p>
                  Each row is one behavior. Bars are annotated bouts; circles mark bout starts (onsets). Filled
                  circles are included onsets; open red circles were excluded by the settings above. Gray rows have
                  too few onsets to be evaluated.
                </p>
                <p>
                  No frame selection is applied to PETH: every frame is used, so every onset whose window lies inside
                  the session has the same full window.
                </p>
              </HowTo>
              <span class="cb-plot__legend">
                <span>
                  <span class="cb-pe-swatch" /> Bout
                </span>
                <span>● Included onset</span>
                <span class="cb-pe-hollow">○</span> Excluded onset
              </span>
            </div>
            <div class="cb-pe-tl">
              <FitTimeline data={ok()!} reports={reports()} ready={(b) => !reports() || ready(b)} />
            </div>
            <div class="cb-muted cb-pe-small">
              All frames are used: no frame selection is applied, and a window may contain any frame.
            </div>
          </section>

          <section class="cb-setgroup cb-pe-right">
            <h3>2 · Analysis window</h3>
            <PethWindow fs={ok()!.fs} />
            <div class="cb-pe-sub">
              <div class="cb-pe-small">
                <h4>Display settings</h4>{' '}
                <span class="cb-muted">
                  These change only the displayed curves. The test always compares the baseline and response
                  intervals above, unbinned.
                </span>
              </div>
              <div class="cb-pe-inline">
                <span class="cb-pe-inline cb-pe-small">
                  Bin size
                  <NumField label="Bin size (s)" value={p().binS ?? 0} def={D.binS ?? 0} min={0.001} step={0.05} unit="s" bad={windowProblems(p(), ok()!.fs).some((m) => m.startsWith('Bin'))} onSet={(v) => setPethSettings('params', 'binS', v)} />
                </span>
                <label class="cb-as-check cb-pe-small">
                  <input
                    type="checkbox"
                    checked={p().baselineSubtract}
                    onChange={(e) => setPethSettings('params', 'baselineSubtract', e.currentTarget.checked)}
                  />
                  Subtract each onset's baseline
                </label>
              </div>
            </div>
            <div class="cb-pe-sub cb-pe-sig">
              <div>
                <h4>Significance testing</h4>
                <SettingsSummary />
              </div>
              <SettingsButton />
            </div>
          </section>
        </div>

        <div class="cb-pe-foot">
          <span class="cb-pe-warn">
            Choose the windows before inspecting results; changing them afterward biases which cells respond.
          </span>
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
              <Show
                when={reports()}
                fallback={<span class="cb-muted">Fix the analysis window to run.</span>}
              >
                <Show when={issue()}>
                  <span class="cb-muted">{issue()}</span>{' '}
                </Show>
                <b>
                  {readyBehaviors().length} behavior{readyBehaviors().length === 1 ? '' : 's'} ready
                </b>{' '}
                · <b>{included()} onsets</b> included
                <Show when={notEvaluated().length}> · {notEvaluated().join(', ')} not evaluated</Show>
              </Show>
            </Show>
          </span>
          <Show
            when={!running()}
            fallback={
              <button class="btn-secondary" onClick={cancelPethRun}>
                Cancel
              </button>
            }
          >
            <button class="btn-primary" disabled={!!issue()} onClick={() => void runPeth()}>
              {pethOutcome() ? 'Run again' : 'Run analysis'} ▶
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The PETH page: its settings, or after a run its results. */
export function PethPanel(): JSX.Element {
  return (
    <Show when={pethShowResults() && pethOutcome()} keyed fallback={<PethSetup />}>
      {(out) => <PethResults out={out} onEdit={() => setPethShowResults(false)} />}
    </Show>
  );
}
