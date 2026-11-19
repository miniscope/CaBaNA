import { createResource, createSignal, Show, type JSX } from 'solid-js';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { download } from '../../lib/export-figure.ts';
import { executedShuffles } from '../../lib/preview.ts';
import { analysisLabel, unavailableReason } from '../../lib/results-overview.ts';
import { active, blockers, refreshHistory, runAnalysis, type AnalysisId } from '../../lib/runs.ts';
import { Popover } from '../Popover.tsx';
import { RunDetailsBody } from './RunDetails.tsx';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type View = 'menu' | 'details';

/** Rerun, Export bundle, Result details and Delete. Delete asks first and waits for a finished run. */
export function ResultActions(props: {
  record: RunRecord;
  /** Called after a deletion so the page can refresh its lists. */
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<View>('menu');
  const [confirming, setConfirming] = createSignal(false);
  const [error, setError] = createSignal('');
  let btn!: HTMLButtonElement;
  const r = () => props.record;
  const id = () => r().analysis as AnalysisId;
  const running = () =>
    active()?.id === id() || r().status === 'queued' || r().status === 'running';
  const needsEngine = (extra: string[] = []) => unavailableReason(bridgeReady(), extra);
  const rerunReason = () =>
    needsEngine(
      running() ? ['A run is already in progress.'] : bridgeReady() ? blockers(id()) : [],
    );
  const close = () => {
    setOpen(false);
    setView('menu');
    setConfirming(false);
    setError('');
  };
  const attempt = async (work: () => Promise<void>) => {
    setError('');
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const rerun = () => {
    close();
    // A preview reruns at the shuffle count it used.
    void runAnalysis(id(), r().scope, {
      shuffles: r().scope === 'preview' ? executedShuffles(r()) : undefined,
    });
  };
  const exportBundle = () =>
    attempt(async () => {
      download(
        `${r().analysis}-${r().run_id}.zip`,
        await bridge.bundle(r().run_id),
        'application/zip',
      );
      close();
    });
  const remove = () =>
    attempt(async () => {
      await bridge.remove(r().run_id);
      await refreshHistory();
      close();
      props.onDeleted(r());
    });
  const [pipeline] = createResource(
    () => (view() === 'details' && bridgeReady() && r().pipeline_file ? r().run_id : undefined),
    (runId) => bridge.runFile(runId, r().pipeline_file!).catch(() => undefined),
  );
  const Item = (p: {
    label: string;
    note?: string;
    reason?: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      type="button"
      role="menuitem"
      class="cb-xm__item"
      classList={{ 'cb-xm__item--danger': p.danger }}
      disabled={!!p.reason}
      onClick={() => p.onClick()}
    >
      <span>{p.label}</span>
      <span class="cb-muted">{p.reason ?? p.note}</span>
    </button>
  );
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="btn-secondary btn-small cb-ra__btn"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`More actions for ${analysisLabel(r().analysis)}`}
        onClick={() => (open() ? close() : setOpen(true))}
      >
        ⋯
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={close}
          width={view() === 'details' ? 560 : 290}
          label="Result actions"
        >
          <Show
            when={view() === 'menu'}
            fallback={
              <>
                <div class="cb-pop__head">
                  <strong>Result details</strong>
                  <button type="button" class="cb-link" onClick={() => setView('menu')}>
                    Back
                  </button>
                </div>
                <RunDetailsBody record={r()} pipeline={pipeline()} />
              </>
            }
          >
            <div class="cb-xm" role="menu">
              <Item
                label="Rerun"
                note="Runs again with the current settings"
                reason={rerunReason()}
                onClick={rerun}
              />
              <Item
                label="Export bundle"
                note="Zip with settings, pipeline and results"
                reason={needsEngine()}
                onClick={() => void exportBundle()}
              />
              <Item label="Result details" onClick={() => setView('details')} />
              <Show
                when={confirming()}
                fallback={
                  <Item
                    label="Delete"
                    danger
                    reason={running() ? 'Wait for the run to finish.' : needsEngine()}
                    onClick={() => setConfirming(true)}
                  />
                }
              >
                <div class="cb-xm__confirm" role="alertdialog" aria-label="Confirm delete">
                  <span>Delete this saved result? This cannot be undone.</span>
                  <span class="cb-xm__confirm-btns">
                    <button
                      type="button"
                      class="btn-secondary btn-small"
                      onClick={() => setConfirming(false)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      class="btn-primary btn-small cb-btn-danger"
                      onClick={() => void remove()}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              </Show>
              <Show when={error()}>
                <p class="cb-xm__err" role="alert">
                  {error()}
                </p>
              </Show>
            </div>
          </Show>
        </Popover>
      </Show>
    </>
  );
}
