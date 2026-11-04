import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import type { RunRecord } from '../lib/bridge-client.ts';
import { bridgeState } from '../lib/bridge-status.ts';
import {
  BROWSER_DECODING_ENGINE_TEXT,
  browserOutdated,
  browserRun,
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
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
} from '../lib/decoding-settings.ts';
import { prep } from '../lib/preprocess.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import { cachedRecords, runSource } from '../lib/results-store.ts';
import type { ResultSource } from '../lib/results-load.ts';
import { compareToLatest, history, latest, setLatest } from '../lib/runs.ts';
import { DecodingResults } from './DecodingResults.tsx';
import { DecodingSetup } from './decoding/GuidedPage.tsx';
import { SavedRunBar } from './results/SavedRunBar.tsx';

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

const savedSettings = (rec: RunRecord) =>
  ((rec.gui.settings as { analysis?: Record<string, unknown> }).analysis ?? {}) as Record<
    string,
    unknown
  >;
/** "Position decoding" or "Behavior decoding (logistic regression)", from a run's saved settings. */
const subtitle = (saved: Record<string, unknown>) =>
  saved.type === 'behaviors'
    ? `Behavior decoding, ${saved.decoder === 'logistic' ? 'logistic regression' : 'Bayesian'}`
    : 'Position decoding, Bayesian';

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
          <Show when={record()}>
            <p class="cb-muted">{subtitle(savedSettings(record()!))}</p>
          </Show>
        </div>
        <div class="cb-controls">
          <button type="button" class="btn-secondary" onClick={() => props.onBack()}>
            Edit setup
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
          <p class="cb-muted">{subtitle(r().settings)}</p>
        </div>
        <div class="cb-controls">
          <Show when={browserOutdated()}>
            <span class="cb-badge cb-badge--warn">Results are outdated</span>
          </Show>
          <button type="button" class="btn-secondary" onClick={() => props.onBack()}>
            Edit setup
          </button>
        </div>
      </div>
      <div class="cb-note" role="status">
        <b>Engine:</b> {BROWSER_DECODING_ENGINE_TEXT}. {r().shuffles.toLocaleString()} shuffles,{' '}
        {r().seconds.toFixed(0)} s.{' '}
        <Show when={r().overallP !== null}>
          Overall {r().overallName} against the shuffled null: p = {r().overallP!.toFixed(4)}.
        </Show>
        <ul>
          <For each={r().notes}>{(n) => <li>{n}</li>}</For>
        </ul>
      </div>
      <DecodingResults
        source={r().source}
        overallTested
        overallP={r().overallP}
        settings={r().settings}
        engine="browser"
      />
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
      <Show when={results()} fallback={<DecodingSetup onResults={open} />}>
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
