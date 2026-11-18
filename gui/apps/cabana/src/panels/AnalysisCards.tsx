// The Analysis page: one card per analysis with its data, readiness and last run, a toggle for Run
// selected, an Actions menu (Configure settings, Preview, Previous results, Load configuration) and
// a Run button. Running goes through the existing batch (lib/analyze-batch.ts); nothing here
// changes what an analysis computes.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import { Pill } from '../components/Pill.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { dataChips, lastRunLine, readinessLine } from '../lib/analysis-cards.ts';
import { ANALYSIS_INFO, blockedReason, rowReason } from '../lib/analyze-view.ts';
import {
  ANALYSIS_ORDER,
  batchActive,
  cancelBatch,
  clearFinished,
  rowStates,
  startBatch,
} from '../lib/analyze-batch.ts';
import { aurocStatus, watchAurocRuns } from '../lib/auroc-run.ts';
import { queueOrder } from '../lib/batch-run.ts';
import { bridgeReady, bridgeState, connectBridge, START_COMMAND } from '../lib/bridge-status.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { pethStatus } from '../lib/peth-run.ts';
import { placeStatus, watchPlaceRuns } from '../lib/place-run.ts';
import { snapshot, statusOfItem } from '../lib/readiness-snapshot.ts';
import type { AnalysisItem, Status } from '../lib/readiness.ts';
import { formatWhen, listedRecords } from '../lib/results-overview.ts';
import { cachedRecords } from '../lib/results-store.ts';
import { active, history, refreshHistory } from '../lib/runs.ts';
import { analysisWindow, openAnalysisWindow, setAnalysisWindow } from '../lib/analysis-window.ts';
import { openItem } from '../components/Requirements.tsx';
import { forgetBrowserRecord } from '../lib/browser-records.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import { AnalysisConfigure } from './AnalysisConfigure.tsx';
import { AnalysisLoad } from './AnalysisLoad.tsx';
import { AnalysisPrevious } from './AnalysisPrevious.tsx';
import { AnalysisPreview } from './AnalysisPreview.tsx';
import { fitToWindow } from './QcPanel.tsx';

const label = (id: AnalysisItem) => ANALYSES.find((a) => a.id === id)!.label;

// Which cards Run selected runs. Kept outside the page, so it is remembered while the app is open.
const [included, setIncluded] = createSignal<ReadonlySet<AnalysisItem>>(new Set(ANALYSIS_ORDER));

/** What a running analysis is doing now, from the same state its own page shows. */
function runningStep(id: AnalysisItem): string {
  const s =
    id === 'place'
      ? placeStatus()
      : id === 'auroc'
        ? aurocStatus()
        : id === 'peth'
          ? pethStatus()
          : undefined;
  if (s) return s.kind === 'running' ? s.step : '';
  const a = active();
  return a?.id === id ? a.message : '';
}

function Toggle(props: {
  id: AnalysisItem;
  on: boolean;
  disabled: boolean;
  onChange: () => void;
}): JSX.Element {
  return (
    <label class="cb-ac__toggle" title="Include in Run selected">
      <input
        type="checkbox"
        role="switch"
        aria-label={`Include ${label(props.id)} in Run selected`}
        checked={props.on}
        disabled={props.disabled}
        onChange={() => props.onChange()}
      />
      <span class="cb-ac__track" />
    </label>
  );
}

/** The amber line shown while the Python engine is not running. */
function EngineBanner(): JSX.Element {
  const needing = () => ANALYSIS_ORDER.filter((id) => snapshot().frameworkEngine[id]).length;
  return (
    <Show when={bridgeState().kind === 'offline' && needing() > 0}>
      <div class="cb-ac__engine" role="status">
        <b>Python engine not running.</b>
        <span>
          {needing()} of {ANALYSIS_ORDER.length} analyses need it. Start it with{' '}
          <code>{START_COMMAND}</code>. Saved results stay available.
        </span>
        <span class="cb-spacer" />
        <button type="button" class="btn-secondary btn-small" onClick={() => void connectBridge()}>
          Retry
        </button>
      </div>
    </Show>
  );
}

export function AnalysisCards(): JSX.Element {
  const [saved, setSaved] = createSignal<RunRecord[]>([]);
  const [listLoaded, setListLoaded] = createSignal(false);

  onMount(() => {
    clearFinished();
    // These two start with their own pages; the cards need the same live status.
    watchPlaceRuns();
    watchAurocRuns();
    void cachedRecords().then(setSaved);
  });
  createEffect(() => {
    if (bridgeReady())
      void refreshHistory().then(
        () => setListLoaded(true),
        () => setListLoaded(false),
      );
    else setListLoaded(false);
  });
  const records = () => listedRecords(bridgeReady() && listLoaded(), history(), saved());
  const lastRun = (id: AnalysisItem) =>
    records()
      .filter((r) => r.analysis === id)
      .sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];

  const status = (id: AnalysisItem) => statusOfItem(id);
  /** Why Run selected skips this analysis, or undefined when it would run it. */
  const skipped = (id: AnalysisItem) => {
    const s = status(id);
    return blockedReason(s, rowReason(s).text);
  };
  const queue = createMemo(() =>
    queueOrder(ANALYSIS_ORDER, included()).filter((id) => !skipped(id)),
  );
  const toggle = (id: AnalysisItem) => {
    const next = new Set(included());
    if (!next.delete(id)) next.add(id);
    setIncluded(next);
  };
  const busy = () => batchActive() || !!active();
  const done = () => ANALYSIS_ORDER.filter((id) => rowStates()[id]?.kind === 'done').length;
  const current = () => ANALYSIS_ORDER.find((id) => rowStates()[id]?.kind === 'running');
  const total = () =>
    ANALYSIS_ORDER.filter((id) => rowStates()[id] && rowStates()[id]!.kind !== 'skipped').length;

  /** The page that fixes what is missing, when the analysis needs input. */
  const fix = (id: AnalysisItem) =>
    status(id).kind === 'needs_input' ? rowReason(status(id)).link : undefined;

  /** Why this card's own Run is unavailable, or undefined. */
  const runBlock = (id: AnalysisItem) => {
    const s = status(id);
    return blockedReason(s, rowReason(s).text, {
      rerun: true,
      otherRunActive: !!active() && s.kind !== 'running',
    });
  };

  /** The readiness line, or the batch's word for this card while a batch is going. */
  function lineOf(id: AnalysisItem): {
    text: string;
    tone: 'ok' | 'flag' | 'bad';
    progress?: Status;
  } {
    const state = rowStates()[id];
    const s = status(id);
    switch (state?.kind) {
      case 'waiting':
        return { text: 'Waiting for the earlier analyses to finish.', tone: 'flag' };
      case 'running':
        return {
          text: runningStep(id) || 'Preparing the run.',
          tone: 'ok',
          progress: s.kind === 'running' ? s : undefined,
        };
      case 'failed':
        return { text: `Failed: ${state.message}`, tone: 'bad' };
      case 'cancelled':
        return { text: 'Cancelled before it finished.', tone: 'flag' };
      case 'skipped':
        return { text: `Skipped: ${state.reason}`, tone: 'flag' };
      default:
        if (s.kind === 'running')
          return { text: runningStep(id) || 'Running', tone: 'ok', progress: s };
        return readinessLine(s);
    }
  }

  const afterDelete = (r: RunRecord) => {
    const id = r.analysis as AnalysisItem;
    if (openedRun(id) === r.run_id) openRunOf(id, undefined);
    void forgetBrowserRecord(r.run_id).then(() => cachedRecords().then(setSaved));
  };
  const closeWindow = () => setAnalysisWindow(undefined);

  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  return (
    <div class="cb-panel cb-panel--wide cb-ac" ref={root}>
      <div class="cb-ac__head">
        <div>
          <h2>Analysis</h2>
          <p class="cb-muted">
            Choose the analyses to run and set them up from each card's Actions.
          </p>
        </div>
        <div class="cb-ac__run">
          <Show
            when={batchActive()}
            fallback={
              <button
                type="button"
                class="btn-primary"
                disabled={!queue().length || busy()}
                title={
                  queue().length
                    ? 'Run the switched-on analyses that are ready, one after another'
                    : 'Switch on an analysis that is ready to run'
                }
                onClick={() => void startBatch(queue())}
              >
                Run selected ({queue().length})
              </button>
            }
          >
            <span class="cb-muted" role="status">
              {current() ? `Running ${label(current()!)}` : 'Finishing'} (
              {done() + (current() ? 1 : 0)} of {total()})
            </span>
            <button type="button" class="btn-secondary" onClick={cancelBatch}>
              Cancel batch
            </button>
          </Show>
        </div>
      </div>
      <EngineBanner />

      <div class="cb-ac__grid">
        <For each={ANALYSIS_ORDER}>
          {(id) => {
            const line = () => lineOf(id);
            const rec = () => lastRun(id);
            const block = () => runBlock(id);
            return (
              <section class="cb-ac__card" aria-label={label(id)} data-analysis={id}>
                <div class="cb-ac__top">
                  <h3>{label(id)}</h3>
                  <Toggle
                    id={id}
                    on={included().has(id)}
                    disabled={batchActive()}
                    onChange={() => toggle(id)}
                  />
                </div>
                <p class="cb-muted cb-ac__does">{ANALYSIS_INFO[id].does}</p>
                <div class="cb-ac__chips">
                  <For each={dataChips(snapshot(), id)}>
                    {(c) => (
                      <Pill tone={c.have ? 'ok' : 'flag'}>
                        {c.have ? '✓ ' : 'Missing: '}
                        {c.label}
                      </Pill>
                    )}
                  </For>
                </div>
                <div class="cb-ac__state">
                  <span class="cb-ac__ready" data-tone={line().tone}>
                    {line().text}
                    <Show when={fix(id)}>
                      {(f) => (
                        <>
                          {' '}
                          <button type="button" class="cb-link" onClick={() => openItem(f().item)}>
                            Open {f().label}
                          </button>
                        </>
                      )}
                    </Show>
                  </span>
                  <Show when={line().progress?.progress !== undefined}>
                    <progress
                      class="cb-ac__bar"
                      max="1"
                      value={line().progress!.progress}
                      aria-label={`${label(id)} progress`}
                    />
                  </Show>
                  <span class="cb-muted cb-ac__last">
                    {lastRunLine(
                      rec(),
                      rec() ? formatWhen(rec()!.finished_utc ?? rec()!.created_utc) : '',
                    )}
                  </span>
                </div>
                <div class="cb-ac__foot">
                  <ActionsMenu
                    items={[
                      {
                        kind: 'action',
                        label: 'Configure settings',
                        onSelect: () => openAnalysisWindow(id, 'configure'),
                      },
                      {
                        kind: 'action',
                        label: 'Preview',
                        onSelect: () => openAnalysisWindow(id, 'preview'),
                      },
                      {
                        kind: 'action',
                        label: 'Previous results',
                        onSelect: () => openAnalysisWindow(id, 'previous'),
                      },
                      {
                        kind: 'action',
                        label: 'Load configuration',
                        onSelect: () => openAnalysisWindow(id, 'load'),
                      },
                    ]}
                  />
                  <span class="cb-spacer" />
                  <button
                    type="button"
                    class="btn-primary cb-ac__go"
                    disabled={!!block() || batchActive()}
                    title={block() ?? 'Run the full analysis'}
                    onClick={() => void startBatch([id], { rerun: true })}
                  >
                    Run
                  </button>
                </div>
              </section>
            );
          }}
        </For>
        <div class="cb-ac__card cb-ac__card--new">
          <h3>New analysis</h3>
          <p class="cb-muted">
            Custom analyses are not available yet. They need a way to add analyses to the framework.
          </p>
        </div>
      </div>

      <Show when={analysisWindow()}>
        {(w) => (
          <Switch>
            <Match when={w().kind === 'configure'}>
              <AnalysisConfigure id={w().id} before={w().before} onClose={closeWindow} />
            </Match>
            <Match when={w().kind === 'preview'}>
              <AnalysisPreview id={w().id} onClose={closeWindow} />
            </Match>
            <Match when={w().kind === 'previous'}>
              <AnalysisPrevious
                id={w().id}
                records={records()}
                onDeleted={afterDelete}
                onClose={closeWindow}
              />
            </Match>
            <Match when={w().kind === 'load'}>
              <AnalysisLoad id={w().id} records={records()} onClose={closeWindow} />
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
}
