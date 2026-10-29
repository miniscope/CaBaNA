import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { download } from '../../lib/export-figure.ts';
import { UnsupportedVersion } from '../../lib/results-load.ts';
import { runSource } from '../../lib/results-store.ts';
import {
  analysisLabel,
  openness,
  openResult,
  unavailableReason,
} from '../../lib/results-overview.ts';
import { active, blockers, refreshHistory, runAnalysis, type AnalysisId } from '../../lib/runs.ts';
import { Popover } from '../Popover.tsx';
import { RunDetailsBody } from './RunDetails.tsx';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Open a saved result on its analysis page; a browser-engine record opens its stored files. */
export function OpenResult(props: { record: RunRecord; onDone?: () => void }): JSX.Element {
  const [error, setError] = createSignal('');
  const how = () => openness(props.record);
  const open = async () => {
    setError('');
    const r = props.record;
    if (how().kind === 'full') {
      try {
        await runSource(r.run_id).manifest(); // refuses a result from a newer framework before leaving
      } catch (e) {
        if (e instanceof UnsupportedVersion) return setError(e.message);
        return setError(`Could not read this result: ${errorText(e)}`);
      }
    }
    openResult(r.analysis as AnalysisId, r.run_id);
  };
  const blocked = () => {
    const h = how();
    return h.kind === 'blocked' ? h.reason : undefined;
  };
  return (
    <span class="cb-ro">
      <Show
        when={how().kind !== 'files'}
        fallback={<StoredFiles record={props.record} onDone={props.onDone} />}
      >
        <button
          type="button"
          class="btn-primary btn-small"
          disabled={!!blocked()}
          title={blocked()}
          onClick={() => void open()}
        >
          Open
        </button>
      </Show>
      <Show when={error()}>
        <span class="cb-ro__err" role="alert">
          {error()}
        </span>
      </Show>
    </span>
  );
}

/** Summary and stored files of a browser-engine record (interactive plots need the data loaded). */
function StoredFiles(props: { record: RunRecord; onDone?: () => void }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal<string>();
  const [text] = createResource(
    () => (name() && bridgeReady() ? { id: props.record.run_id, file: name()! } : undefined),
    (k) => bridge.runFile(k.id, k.file).catch((e) => `Could not read the file: ${errorText(e)}`),
  );
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="btn-primary btn-small"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        Open
      </button>
      <Show when={open()}>
        <Popover anchor={btn} onClose={() => setOpen(false)} width={460} label="Stored result">
          <div class="cb-pop__head">
            <strong>{analysisLabel(props.record.analysis)}: summary and stored files</strong>
          </div>
          <p class="cb-muted">
            Saved by the browser engine. Interactive plots need the data loaded in the setup.
          </p>
          <Show
            when={bridgeReady()}
            fallback={<p class="cb-muted">Stored files need the Python engine.</p>}
          >
            <ul class="cb-ro__files">
              <For
                each={props.record.files ?? []}
                fallback={<li class="cb-muted">No stored files.</li>}
              >
                {(f) => (
                  <li>
                    <button type="button" class="cb-link" onClick={() => setName(f)}>
                      {f}
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={text()}>
              <pre class="cb-rd__pre">{text()}</pre>
            </Show>
          </Show>
        </Popover>
      </Show>
    </>
  );
}

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
    void runAnalysis(id(), r().scope);
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

/** Rerun with the current settings; unavailable with the reason written beside it. */
export function RerunButton(props: { record: RunRecord }): JSX.Element {
  const id = () => props.record.analysis as AnalysisId;
  const reason = () =>
    unavailableReason(bridgeReady(), bridgeReady() ? blockers(id()) : []) ??
    (active() ? 'A run is already in progress.' : undefined);
  return (
    <span class="cb-ro">
      <button
        type="button"
        class="btn-primary btn-small"
        disabled={!!reason()}
        title={reason()}
        onClick={() => void runAnalysis(id(), props.record.scope)}
      >
        Rerun
      </button>
      <Show when={reason()}>
        <span class="cb-muted cb-ro__why">{reason()}</span>
      </Show>
    </span>
  );
}
