import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import type { RunRecord } from '../lib/bridge-client.ts';
import { bridgeState } from '../lib/bridge-status.ts';
import {
  BROWSER_DECODING_ENGINE_TEXT,
  BROWSER_DECODING_RUN_LABEL,
  browserBlock,
  browserOutdated,
  browserRun,
  browserStatus,
  cancelBrowserDecoding,
  runBrowserDecoding,
  setShownEngine,
  shownEngine,
  type BrowserDecodingRun,
} from '../lib/decoding-browser.ts';
import {
  behaviorDecoding,
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
  decodeTarget,
  positionDecoding,
  PREVIEW_DECODING_SHUFFLES,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
  type DecodeTarget,
} from '../lib/decoding-settings.ts';
import { prep } from '../lib/preprocess.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import { cachedRecords, runSource } from '../lib/results-store.ts';
import type { ResultSource } from '../lib/results-load.ts';
import {
  active,
  cancelRun,
  compareToLatest,
  history,
  lastError,
  latest,
  runAnalysis,
  setLatest,
} from '../lib/runs.ts';
import { DecodingResults } from './DecodingResults.tsx';
import { RunProgress } from './results/EngineNotice.tsx';
import './decoding/persist.ts';
import {
  ChecksView,
  DecoderView,
  FoldsView,
  FramesView,
  InputLine,
  isStartingSettings,
  resetStartingSettings,
  SignificanceView,
} from './decoding/Setup.tsx';
import { canRun, checks, isPosition, runBlock } from './decoding/state.ts';
import { fitToWindow } from './QcPanel.tsx';
import { SavedRunBar } from './results/SavedRunBar.tsx';

type View = 'decoder' | 'frames' | 'folds' | 'significance' | 'checks';
const VIEWS: [View, string][] = [
  ['decoder', 'Target & decoder'],
  ['frames', 'Frames'],
  ['folds', 'Cross-validation'],
  ['significance', 'Significance'],
  ['checks', 'Checks'],
];
const TARGETS: [DecodeTarget, string][] = [
  ['position', 'Position'],
  ['behaviors', 'Behaviors'],
];

/** Copy the settings of a saved run into the setup (an explicit action; viewing never does it). */
function loadSettingsOf(rec: RunRecord): void {
  const saved = ((rec.gui.settings as { analysis?: Record<string, unknown> }).analysis ??
    {}) as Record<string, unknown>;
  const { type, ...rest } = saved;
  if (type === 'behaviors') {
    setBehaviorDecoding(
      reconcile({
        ...DEFAULT_BEHAVIOR_DECODING,
        ...rest,
        labels: [...((rest.labels as string[]) ?? [])],
      } as typeof DEFAULT_BEHAVIOR_DECODING),
    );
    setDecodeTarget('type', 'behaviors');
  } else {
    setPositionDecoding(
      reconcile({ ...DEFAULT_POSITION_DECODING, ...rest } as typeof DEFAULT_POSITION_DECODING),
    );
    setDecodeTarget('type', 'position');
  }
}

/** The record to show: the opened saved run, or the latest one. */
const shownRecord = (): RunRecord | undefined => {
  const id = openedRun('decoding');
  return (id ? history().find((r) => r.run_id === id) : undefined) ?? latest.decoding;
};

function Results(props: { onBack: () => void }): JSX.Element {
  const record = createMemo(shownRecord);
  const source = createMemo(() => (record() ? runSource(record()!.run_id) : undefined));
  const [match] = createResource(
    () =>
      [
        latest.decoding?.run_id,
        JSON.stringify([decodeTarget.type, positionDecoding, behaviorDecoding, prep]),
      ] as const,
    async () => compareToLatest('decoding'),
  );
  const older = () => !!openedRun('decoding') && record()?.run_id !== latest.decoding?.run_id;
  return (
    <div class="cb-place cb-dec-page">
      <div class="cb-place-head">
        <div>
          <h2>Decoding results</h2>
        </div>
        <div class="cb-controls">
          <button type="button" class="btn-secondary" onClick={() => props.onBack()}>
            Back to settings
          </button>
        </div>
      </div>
      <Show when={older() && record()}>
        {(r) => (
          <SavedRunBar
            analysis="decoding"
            record={r()}
            onLoadSettings={() => {
              loadSettingsOf(r());
              openRunOf('decoding', undefined);
              props.onBack();
            }}
          />
        )}
      </Show>
      <Show
        when={record() && source()}
        keyed
        fallback={
          <div class="cb-empty">No decoding result yet. Run the analysis from the settings.</div>
        }
      >
        {(src) => (
          <DecodingResults
            source={src}
            record={record()}
            match={older() ? undefined : match()}
            saved={older()}
          />
        )}
      </Show>
    </div>
  );
}

/** A browser-engine result: the same results page, with the engine named above it. */
function BrowserResults(props: { run: BrowserDecodingRun; onBack: () => void }): JSX.Element {
  const r = () => props.run;
  return (
    <div class="cb-place cb-dec-page">
      <div class="cb-place-head">
        <div>
          <h2>Decoding results</h2>
        </div>
        <div class="cb-controls">
          <Show when={browserOutdated()}>
            <span class="cb-badge cb-badge--warn">Results are outdated</span>
          </Show>
          <button type="button" class="btn-secondary" onClick={() => props.onBack()}>
            Back to settings
          </button>
        </div>
      </div>
      <div class="cb-note" role="status">
        <b>Browser engine.</b> {BROWSER_DECODING_ENGINE_TEXT}. {r().shuffles.toLocaleString()}{' '}
        shuffles, {r().seconds.toFixed(0)} s.{' '}
        <Show when={r().overallP !== null}>
          Overall {r().overallName} against the shuffled null: p = {r().overallP!.toFixed(4)}.
        </Show>
        <ul>
          <For each={r().notes}>{(n) => <li>{n}</li>}</For>
        </ul>
      </div>
      <DecodingResults source={r().source} />
    </div>
  );
}

/** Test-only route: `?decoding_fixture=<name>` shows a framework test fixture, bannered as such. */
function FixtureResults(props: { name: string }): JSX.Element {
  const [src] = createResource(async (): Promise<ResultSource | undefined> => {
    if (!import.meta.env.DEV) return undefined;
    return (await import('./decoding/fixture.ts')).browserFixture(props.name);
  });
  return (
    <div class="cb-place cb-dec-page">
      <Show when={src()} fallback={<div class="cb-empty">Fixture "{props.name}" not found.</div>}>
        {(s) => <DecodingResults source={s()} fixture={props.name} />}
      </Show>
    </div>
  );
}

function Setup(props: { onResults: () => void }): JSX.Element {
  const [view, setView] = createSignal<View>('decoder');
  const run = () => (active()?.id === 'decoding' ? active() : undefined);
  const block = () => runBlock();
  const c = () => checks();
  const problems = () => c().needsInput.length + c().framework.length + (c().engineOff ? 1 : 0);
  const [match] = createResource(
    () =>
      [
        latest.decoding?.run_id,
        JSON.stringify([decodeTarget.type, positionDecoding, behaviorDecoding, prep]),
      ] as const,
    async () => compareToLatest('decoding'),
  );
  const failure = () => (lastError()?.id === 'decoding' ? lastError()!.message : undefined);
  // The browser engine is offered, as its own labeled action, when the Python engine cannot run.
  const browserOffered = () => c().engineOff || c().framework.length > 0;
  const browserRunning = () => browserStatus().kind === 'running';
  const browserFailure = () => {
    const b = browserStatus();
    return b.kind === 'error' ? b.message : undefined;
  };
  const hasResults = () => !!(latest.decoding || browserRun());
  const onBrowserRun = () => void runBrowserDecoding().then((ok) => ok && props.onResults());
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const status = () => {
    if (shownEngine() === 'browser' && browserRun())
      return browserOutdated() ? 'Results are outdated' : '';
    const r = latest.decoding;
    if (!r) return '';
    if (r.status === 'failed') return 'Last run failed';
    if (r.status === 'cancelled' || r.status === 'partial') return 'Last run incomplete';
    return match()?.matches === false ? 'Results are outdated' : '';
  };
  return (
    <div class="cb-place cb-dec-page cb-dec-setup" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>Decoding</h2>
          <p class="cb-muted">
            Predict {isPosition() ? 'position' : 'behavior'} from the events of all cells together,
            on held-out blocks of time.
          </p>
        </div>
        <div class="cb-dec-target">
          <span class="cb-dec-target__label">Target</span>
          <div class="cb-seg" role="group" aria-label="Decoding target">
            <For each={TARGETS}>
              {([t, label]) => (
                <button
                  type="button"
                  classList={{ 'cb-seg__on': decodeTarget.type === t }}
                  aria-pressed={decodeTarget.type === t}
                  onClick={() => setDecodeTarget('type', t)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="cb-controls">
          <Show when={status()}>
            <span class="cb-badge cb-badge--warn">{status()}</span>
          </Show>
          <Show when={hasResults()}>
            <button type="button" class="btn-secondary" onClick={() => props.onResults()}>
              {(shownEngine() === 'browser' ? browserOutdated() : match()?.matches === false)
                ? 'View previous results'
                : 'View results'}
            </button>
          </Show>
        </div>
      </div>
      <InputLine />
      <div class="cb-dec-body">
        <nav class="cb-dec-nav" aria-label="Decoding settings views">
          <For each={VIEWS}>
            {([id, label]) => (
              <button
                type="button"
                classList={{ 'cb-dec-nav__on': view() === id }}
                aria-current={view() === id ? 'page' : undefined}
                onClick={() => setView(id)}
              >
                {label}
                <Show when={id === 'checks' && problems()}>
                  <span class="cb-badge cb-badge--warn">{problems()}</span>
                </Show>
              </button>
            )}
          </For>
          <button
            type="button"
            class="btn-secondary cb-dec-nav__reset"
            disabled={isStartingSettings()}
            onClick={resetStartingSettings}
            title="Reset the settings of this target to their starting values"
          >
            Starting settings
          </button>
        </nav>
        <div class="cb-dec-view">
          <Show when={view() === 'decoder'}>
            <DecoderView />
          </Show>
          <Show when={view() === 'frames'}>
            <FramesView />
          </Show>
          <Show when={view() === 'folds'}>
            <FoldsView />
          </Show>
          <Show when={view() === 'significance'}>
            <SignificanceView />
          </Show>
          <Show when={view() === 'checks'}>
            <ChecksView />
          </Show>
        </div>
      </div>
      <Show when={failure()}>
        <div class="cb-note" role="alert">
          The run could not start or failed: {failure()}
        </div>
      </Show>
      <Show when={browserOffered()}>
        <div class="cb-note" role="status">
          <Show
            when={browserRunning()}
            fallback={
              <>
                <button
                  type="button"
                  class="btn-secondary"
                  disabled={!!run() || browserBlock() !== ''}
                  title="Runs the TypeScript port in this browser. Random draws differ from the framework, so p-values differ slightly. The fold gap setting is not applied."
                  onClick={onBrowserRun}
                >
                  {BROWSER_DECODING_RUN_LABEL}
                </button>{' '}
                <Show when={browserBlock()}>
                  <span class="cb-dec-block">{browserBlock()}</span>
                </Show>
              </>
            }
          >
            {(() => {
              const b = browserStatus() as Extract<
                ReturnType<typeof browserStatus>,
                { kind: 'running' }
              >;
              return (
                <>
                  <RunProgress done={b.done} total={b.total} />
                  <span class="cb-muted">{b.step}</span>{' '}
                  <button type="button" class="btn-secondary" onClick={cancelBrowserDecoding}>
                    Cancel
                  </button>
                </>
              );
            })()}
          </Show>
          <Show when={browserFailure()}>
            <p role="alert">The browser run failed: {browserFailure()}</p>
          </Show>
        </div>
      </Show>
      <div class="cb-pe-foot cb-dec-foot">
        <span class="cb-pe-foot__text">
          <Show
            when={!run()}
            fallback={
              <>
                <Show when={run()!.shuffles}>
                  <progress
                    class="cb-progress"
                    value={run()!.shuffles![0]}
                    max={run()!.shuffles![1]}
                  />
                </Show>
                <span class="cb-muted">{run()!.message}</span>
              </>
            }
          >
            <Show
              when={block()}
              fallback={
                <span class="cb-muted">
                  Ready: {isPosition() ? 'position' : 'behavior'} decoding with{' '}
                  {(isPosition() ? positionDecoding : behaviorDecoding).shuffles.toLocaleString()}{' '}
                  shuffles.
                </span>
              }
            >
              <span class="cb-dec-block" role="status">
                {block()}
              </span>
              <button type="button" class="cb-link" onClick={() => setView('checks')}>
                See Checks
              </button>
            </Show>
          </Show>
        </span>
        <Show
          when={!run()}
          fallback={
            <button type="button" class="btn-secondary" onClick={() => void cancelRun()}>
              Cancel
            </button>
          }
        >
          <button
            type="button"
            class="btn-secondary"
            disabled={!canRun() || browserRunning()}
            title={`${PREVIEW_DECODING_SHUFFLES} shuffles, labeled Preliminary`}
            onClick={() => {
              setShownEngine('framework');
              void runAnalysis('decoding', 'preview').then(() => props.onResults());
            }}
          >
            Quick preview ({PREVIEW_DECODING_SHUFFLES} shuffles)
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={!canRun() || browserRunning()}
            onClick={() => {
              setShownEngine('framework');
              void runAnalysis('decoding', 'full').then(() => props.onResults());
            }}
          >
            {latest.decoding ? 'Run again' : 'Run analysis'} ▶
          </button>
        </Show>
      </div>
    </div>
  );
}

/** The Decoding page: settings in named views, and the results of a saved or just finished run. */
export function DecodingPanel(): JSX.Element {
  const [results, setResults] = createSignal(false);
  const fixture = new URLSearchParams(window.location.search).get('decoding_fixture');
  // A run that ended without results (failed before saving) stays on the settings page.
  const open = () =>
    setResults(
      shownEngine() === 'browser'
        ? !!browserRun()
        : !!latest.decoding && latest.decoding.status !== 'failed',
    );
  // Without the engine, the newest saved decoding result comes from this browser's copy.
  onMount(async () => {
    if (!latest.decoding && bridgeState().kind !== 'ready') {
      const saved = (await cachedRecords()).filter((r) => r.analysis === 'decoding').at(-1);
      if (saved) setLatest('decoding', saved);
    }
  });
  createEffect(
    on(
      () => openedRun('decoding'),
      (id) => {
        if (!id) return;
        setShownEngine('framework');
        setResults(true);
      },
    ),
  );
  return (
    <Show when={!(import.meta.env.DEV && fixture)} fallback={<FixtureResults name={fixture!} />}>
      <Show when={results()} fallback={<Setup onResults={open} />}>
        <Show
          when={shownEngine() === 'browser' && browserRun()}
          fallback={<Results onBack={() => setResults(false)} />}
        >
          {(run) => <BrowserResults run={run()} onBack={() => setResults(false)} />}
        </Show>
      </Show>
    </Show>
  );
}
