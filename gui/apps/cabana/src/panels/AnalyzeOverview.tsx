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
import { StatusBadge } from '../components/StatusBadge.tsx';
import { openItem } from '../components/Requirements.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import {
  ANALYSIS_INFO,
  badge,
  blockedReason,
  dashboardStatus,
  fixLinks,
  recentResults,
  rowReason,
} from '../lib/analyze-view.ts';
import {
  ANALYSIS_ORDER,
  batchActive,
  cancelBatch,
  clearFinished,
  rowStates,
  startBatch,
} from '../lib/analyze-batch.ts';
import { watchAurocRuns, aurocStatus } from '../lib/auroc-run.ts';
import { queueOrder } from '../lib/batch-run.ts';
import { bridgeReady } from '../lib/bridge-status.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { PREVIEW_TEXT } from '../lib/preview.ts';
import { pethStatus } from '../lib/peth-run.ts';
import { placeStatus, watchPlaceRuns } from '../lib/place-run.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { ITEM_LABEL, type AnalysisItem, type Status } from '../lib/readiness.ts';
import { formatWhen, goToAnalysis, listedRecords, openResult } from '../lib/results-overview.ts';
import { cachedRecords } from '../lib/results-store.ts';
import { active, history, refreshHistory } from '../lib/runs.ts';
import { experiment } from '../lib/store.ts';
import { fitToWindow } from './QcPanel.tsx';

const label = (id: AnalysisItem) => ANALYSES.find((a) => a.id === id)!.label;

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

/** Analyze: the five analyses with status and reasons, Run selected, recent results and links. */
export function AnalyzeOverview(): JSX.Element {
  const [checked, setChecked] = createSignal<ReadonlySet<AnalysisItem>>(new Set());
  const [preview, setPreview] = createSignal(false);
  const [saved, setSaved] = createSignal<RunRecord[]>([]);
  const [listLoaded, setListLoaded] = createSignal(false);

  onMount(() => {
    clearFinished();
    // Their own pages start these; the dashboard needs the same live status and saved results.
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
  /** Why the box cannot be checked, or undefined. */
  const uncheckable = (id: AnalysisItem) => {
    const s = status(id);
    return blockedReason(s, rowReason(s).text);
  };
  const eligible = () => ANALYSIS_ORDER.filter((id) => !uncheckable(id));
  const queue = createMemo(() =>
    queueOrder(ANALYSIS_ORDER, checked()).filter((id) => eligible().includes(id)),
  );
  const toggle = (id: AnalysisItem) => {
    const next = new Set(checked());
    if (!next.delete(id)) next.add(id);
    setChecked(next);
  };
  const allChecked = () => eligible().length > 0 && eligible().every((id) => checked().has(id));
  const toggleAll = () => setChecked(new Set<AnalysisItem>(allChecked() ? [] : eligible()));
  const busy = () => batchActive() || !!active();
  const done = () => ANALYSIS_ORDER.filter((id) => rowStates()[id]?.kind === 'done').length;
  const current = () => ANALYSIS_ORDER.find((id) => rowStates()[id]?.kind === 'running');
  const total = () =>
    ANALYSIS_ORDER.filter((id) => !['skipped'].includes(rowStates()[id]?.kind ?? 'skipped')).length;

  /** The badge and the line under it: the batch state first, else the analysis's own status. */
  function shown(id: AnalysisItem): {
    status: Status;
    note: string;
    fix?: ReturnType<typeof rowReason>['link'];
  } {
    const state = rowStates()[id];
    const real = dashboardStatus(status(id));
    switch (state?.kind) {
      case 'waiting':
        return {
          status: badge('not_started', 'Waiting'),
          note: 'Waiting for the earlier analyses to finish.',
        };
      case 'running':
        return {
          status: real.kind === 'running' ? real : badge('running', 'Starting'),
          note: runningStep(id) || 'Preparing the run.',
        };
      case 'failed':
        return { status: badge('failed', 'Failed'), note: state.message };
      case 'cancelled':
        return { status: badge('not_started', 'Cancelled'), note: 'Cancelled before it finished.' };
      case 'skipped':
        return { status: real, note: `Skipped: ${state.reason}` };
      default: {
        if (real.kind === 'running') return { status: real, note: runningStep(id) };
        const r = rowReason(status(id));
        return { status: real, note: r.text, fix: r.link };
      }
    }
  }

  const recent = () => recentResults(records());
  const links = () => fixLinks(Object.fromEntries(ANALYSIS_ORDER.map((id) => [id, status(id)])));
  /** Only worth saying when the experiment type narrows the list. */
  const suggested = (id: AnalysisItem) =>
    experiment().recommended.length < ANALYSIS_ORDER.length &&
    experiment().recommended.includes(id);

  // The page fills the window; the analysis list and the side panel scroll inside it.
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-panel cb-panel--wide cb-an" ref={root}>
      <div class="cb-an__head">
        <div>
          <h2>Analyze</h2>
          <p class="cb-muted">
            Run, monitor and open analyses. Each analysis keeps its own settings and results.
          </p>
        </div>
        <div class="cb-an__run">
          <Show when={!batchActive()}>
            <label
              class="cb-an__preview"
              title={`${PREVIEW_TEXT}; results are marked Preliminary. Applies to analyses on the Python engine; PETH and browser-engine runs ignore it.`}
            >
              <input
                type="checkbox"
                checked={preview()}
                onChange={(e) => setPreview(e.currentTarget.checked)}
              />
              Quick preview
            </label>
          </Show>
          <Show
            when={batchActive()}
            fallback={
              <button
                type="button"
                class="btn-primary"
                disabled={!queue().length || busy()}
                onClick={() => void startBatch(queue(), { preview: preview() })}
              >
                Run selected{queue().length ? ` (${queue().length})` : ''}
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

      <div class="cb-an__grid">
        <section class="cb-an__card" aria-label="Analyses">
          <div class="cb-an__row cb-an__row--head">
            <input
              type="checkbox"
              aria-label="Select every analysis that can run"
              checked={allChecked()}
              disabled={!eligible().length || batchActive()}
              onChange={toggleAll}
            />
            <span>Analysis</span>
            <span>Status</span>
            <span>Last run</span>
            <span />
          </div>
          <For each={ANALYSIS_ORDER}>
            {(id) => {
              const view = () => shown(id);
              const rec = () => lastRun(id);
              const rowBlock = () => {
                const s = status(id);
                return blockedReason(s, rowReason(s).text, {
                  rerun: true,
                  otherRunActive: !!active() && s.kind !== 'running',
                });
              };
              return (
                <div class="cb-an__row" data-analysis={id}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${label(id)}`}
                    title={uncheckable(id) ?? ''}
                    checked={checked().has(id)}
                    disabled={!!uncheckable(id) || batchActive()}
                    onChange={() => toggle(id)}
                  />
                  <div class="cb-an__name">
                    <button type="button" class="cb-link" onClick={() => goToAnalysis(id)}>
                      {label(id)}
                    </button>
                    <Show when={suggested(id)}>
                      <span class="cb-muted"> · suggested</span>
                    </Show>
                    <span class="cb-an__does">{ANALYSIS_INFO[id].does}</span>
                    <span class="cb-an__needs">Needs: {ANALYSIS_INFO[id].needs}</span>
                  </div>
                  <div class="cb-an__status">
                    <StatusBadge status={view().status} />
                    <Show when={view().status.progress !== undefined}>
                      <progress
                        class="cb-an__bar"
                        max="1"
                        value={view().status.progress}
                        aria-label={`${label(id)} progress`}
                      />
                    </Show>
                    <span
                      class="cb-an__note"
                      classList={{ 'cb-an__note--bad': rowStates()[id]?.kind === 'failed' }}
                    >
                      {view().note}
                      <Show when={view().fix}>
                        {(fix) => (
                          <>
                            {' '}
                            <button
                              type="button"
                              class="cb-link"
                              onClick={() => openItem(fix().item)}
                            >
                              Open {fix().label}
                            </button>
                          </>
                        )}
                      </Show>
                    </span>
                  </div>
                  <span class="cb-an__last cb-muted">
                    {rec() ? formatWhen(rec()!.finished_utc ?? rec()!.created_utc) : '—'}
                  </span>
                  <div class="cb-an__act">
                    <button
                      type="button"
                      class="btn-secondary"
                      disabled={!!rowBlock() || batchActive()}
                      title={rowBlock() ?? ''}
                      onClick={() => void startBatch([id], { preview: preview(), rerun: true })}
                    >
                      Run
                    </button>
                    <button type="button" class="btn-secondary" onClick={() => goToAnalysis(id)}>
                      Configure
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </section>

        <aside class="cb-an__side">
          <section class="cb-an__card" aria-label="Recent results">
            <h3>Recent results</h3>
            <Show when={recent().length} fallback={<p class="cb-muted">No runs yet.</p>}>
              <ul class="cb-an__recent">
                <For each={recent()}>
                  {(r) => (
                    <li>
                      <div>
                        <strong>{label(r.record.analysis as AnalysisItem)}</strong>
                        <span class="cb-muted">
                          {formatWhen(r.record.finished_utc ?? r.record.created_utc)}
                        </span>
                      </div>
                      <StatusBadge status={r.status} />
                      <button
                        type="button"
                        class="cb-link"
                        onClick={() =>
                          r.openable
                            ? openResult(r.record.analysis as AnalysisItem, r.record.run_id)
                            : goToAnalysis(r.record.analysis as AnalysisItem)
                        }
                      >
                        {r.openable ? 'Open result' : 'Open page'}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
          <section class="cb-an__card" aria-label="Quick links">
            <h3>Quick links</h3>
            <ul class="cb-an__links">
              <li>
                <button type="button" class="cb-link" onClick={() => openItem('results')}>
                  Results
                </button>
                <span class="cb-muted"> · every saved result and earlier run</span>
              </li>
              <For each={links()}>
                {(l) => (
                  <li>
                    <button type="button" class="cb-link" onClick={() => openItem(l.item)}>
                      {ITEM_LABEL[l.item]}
                    </button>
                    <span class="cb-muted"> · needed by {l.forAnalyses.join(', ')}</span>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
