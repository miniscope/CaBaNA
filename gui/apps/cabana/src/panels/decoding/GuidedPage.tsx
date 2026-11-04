// The Decoding setup on the shared guided setup: Configure (target and data, decoder, train and
// test, significance), Review and preview (summary, engines, checks, Quick preview or full run) and
// Run. Same structure as Place cells.

import { createResource, Show, onCleanup, onMount, type JSX } from 'solid-js';
import {
  SectionList,
  StageBar,
  StageFooter,
  type GuidedSection,
} from '../../components/GuidedSetup.tsx';
import {
  HowItWorks,
  RunChoice,
  SettingsSummary,
  type SummaryGroup,
} from '../../components/GuidedReview.tsx';
import { MetricCards } from '../../components/MetricCards.tsx';
import { hasCapability } from '../../lib/bridge-status.ts';
import { decodeEvents } from '../../lib/decode-data.ts';
import {
  BROWSER_DECODING_RUN_LABEL,
  browserBlock,
  browserOutdated,
  browserRun,
  browserStatus,
  cancelBrowserDecoding,
  foldedTimes,
  runBrowserDecoding,
  setShownEngine,
  shownEngine,
} from '../../lib/decoding-browser.ts';
import { decodeTarget, behaviorDecoding, positionDecoding } from '../../lib/decoding-settings.ts';
import { guided } from '../../lib/guided.ts';
import { prep } from '../../lib/preprocess.ts';
import { executedShuffles, preliminaryText, shufflesFor } from '../../lib/preview.ts';
import {
  active,
  cancelRun,
  compareToLatest,
  lastError,
  latest,
  runAnalysis,
} from '../../lib/runs.ts';
import { InfoTip } from '../InfoTip.tsx';
import { ShuffleReach } from '../parts.tsx';
import { fitToWindow } from '../QcPanel.tsx';
import { RunProgress } from '../results/EngineNotice.tsx';
import { Unavailable } from '../results/FrameworkNotice.tsx';
import { EngineSection } from './Engines.tsx';
import { gapBlock, type Request } from './engines.ts';
import { reviewGroups, runCards, sectionSummary, type LastRun } from './review.ts';
import {
  ChecksView,
  DecoderView,
  FoldsView,
  FramesView,
  InputLine,
  isStartingSettings,
  resetStartingSettings,
  SignificanceView,
} from './Setup.tsx';
import { TargetCards } from './Target.tsx';
import { checks, decodeView, isPosition, runBlock, shared } from './state.ts';

const SECTIONS = ['target', 'decoder', 'folds', 'significance'];
// Kept outside the page so the open stage and section survive a visit to the results.
const g = guided('decoding', 'target');

const request = (): Request => {
  const v = decodeView();
  return {
    target: v.target,
    decoder: v.decoder,
    mode: v.mode,
    overlap: v.overlap,
    foldGapS: v.foldGapS,
  };
};

const previewCount = () => shufflesFor('preview', shared().shuffles);

/** The method in a few paragraphs, and where it comes from. */
function Method(): JSX.Element {
  return (
    <div class="cb-muted">
      <p>
        Decoding predicts the target (position, or which behavior is occurring) in held-out blocks
        of time from the unsmoothed deconvolved events of all accepted cells together. The decoder
        is fitted on the training blocks only and scored on the held-out block, in turn for every
        block (blocked cross-validation; random frame-by-frame splits are never used).
      </p>
      <p>
        A training/test separation leaves out training frames next to each test block, because
        neighboring frames are nearly identical. A larger separation lowers, but does not remove,
        dependence between training and test data.
      </p>
      <p>
        Significance comes from a label-shuffle test: the target labels are cut into blocks and the
        blocks permuted, which keeps the slow drift of the labels, and the whole cross-validated
        decode is repeated for every shuffle. The smallest possible p is 1 / (shuffles + 1).
      </p>
      <p>
        The Bayesian decoder's Gaussian likelihood is based on the decoder of Shuman et al. 2020
        (Nature Neuroscience); CaBaNA's implementation and defaults, such as the window, can differ
        from the paper. The Poisson likelihood treats cells as independent Poisson counters (Zhang
        et al. 1998, Journal of Neurophysiology). Logistic regression is a standard regularized
        classifier.
      </p>
    </div>
  );
}

/** Settings to a Run stage summary: progress while running, the last run's cards, a link to results. */
function RunStage(props: {
  last?: LastRun;
  preliminaryLabel?: string;
  onResults: () => void;
  failure?: string;
}): JSX.Element {
  const run = () => (active()?.id === 'decoding' ? active() : undefined);
  const b = () => {
    const s = browserStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const browserFailure = () => {
    const s = browserStatus();
    return s.kind === 'error' ? s.message : undefined;
  };
  return (
    <div class="cb-gs-run">
      <Show when={run()}>
        {(r) => (
          <div>
            <p>{r().message}</p>
            <Show when={r().shuffles}>
              <progress class="cb-progress" value={r().shuffles![0]} max={r().shuffles![1]} />
            </Show>
          </div>
        )}
      </Show>
      <Show when={b()}>
        {(r) => (
          <div>
            <p>{r().step}</p>
            <RunProgress done={r().done} total={r().total} />
          </div>
        )}
      </Show>
      <Show when={props.failure ?? browserFailure()}>
        {(m) => (
          <div class="cb-note" role="alert">
            The run could not start or failed: {m()}
          </div>
        )}
      </Show>
      <Show
        when={!run() && !b() && props.last}
        fallback={
          <Show when={!run() && !b() && !props.failure && !browserFailure()}>
            <p class="cb-muted">
              No run yet. Choose Quick preview or the full analysis in Review and preview.
            </p>
          </Show>
        }
      >
        {(l) => (
          <>
            <h3>
              Last run
              <Show when={l().preliminary}>
                <span class="cb-badge cb-badge--warn">{props.preliminaryLabel}</span>
              </Show>
              <Show when={l().outdated}>
                <span class="cb-badge cb-badge--warn">Results are outdated</span>
              </Show>
            </h3>
            <MetricCards label="Last run" cards={runCards(l())} />
            <div class="cb-controls">
              <button type="button" class="btn-primary" onClick={() => props.onResults()}>
                {l().outdated ? 'Open previous results' : 'Open results'}
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

export function DecodingSetup(props: { onResults: () => void }): JSX.Element {
  const run = () => (active()?.id === 'decoding' ? active() : undefined);
  const c = () => checks();
  const [match] = createResource(
    () =>
      [
        latest.decoding?.run_id,
        JSON.stringify([decodeTarget.type, positionDecoding, behaviorDecoding, prep]),
      ] as const,
    async () => compareToLatest('decoding'),
  );
  const failure = () => (lastError()?.id === 'decoding' ? lastError()!.message : undefined);
  const frameworkRunning = () => !c().engineOff;
  // The browser engine is offered, as its own labeled action, when the Python engine cannot run.
  const browserOffered = () => c().engineOff || c().framework.length > 0;
  const browserRunning = () => browserStatus().kind === 'running';
  const problems = () => c().needsInput.length + c().framework.length + (c().engineOff ? 1 : 0);
  const blocked = () => (run() || browserRunning() ? 'A run is in progress.' : runBlock());
  const previewBlocked = () =>
    frameworkRunning() ? undefined : 'Needs the Python framework, which is not running.';

  const startFramework = (scope: 'full' | 'preview') => {
    setShownEngine('framework');
    g.setStage('run');
    void runAnalysis('decoding', scope).then(() => props.onResults());
  };
  const startBrowser = () => {
    g.setStage('run');
    void runBrowserDecoding().then((ok) => ok && props.onResults());
  };

  const last = (): LastRun | undefined => {
    const r = browserRun();
    if (shownEngine() === 'browser' && r)
      return {
        engine: 'browser',
        preliminary: false,
        shuffles: r.shuffles,
        // A browser run is refused with a separation set, so it ran with none.
        foldGapS: 0,
        outdated: browserOutdated(),
      };
    const f = latest.decoding;
    if (!f || f.status === 'failed') return undefined;
    const saved = (f.gui.settings as { analysis?: { foldGapS?: number } }).analysis;
    return {
      engine: 'framework',
      preliminary: f.scope === 'preview',
      shuffles: executedShuffles(f),
      foldGapS: saved?.foldGapS,
      outdated: match()?.matches === false,
    };
  };
  const status = () => {
    const r = run();
    if (r) return r.message;
    if (browserRunning()) return (browserStatus() as { step: string }).step;
    if (blocked()) return 'Needs attention';
    return 'Ready to run';
  };
  const dataFacts = () => {
    const e = decodeEvents();
    return {
      cells: 'error' in e ? undefined : e.cells,
      frames: foldedTimes()?.times.length,
      speedCmS: prep.minSpeed,
    };
  };
  const summary = (): SummaryGroup[] => reviewGroups(decodeView(), dataFacts());

  const sections = (): GuidedSection[] =>
    [
      ['target', 'Target and data'],
      ['decoder', 'Decoder'],
      ['folds', 'Train and test'],
      ['significance', 'Significance'],
    ].map(([id, title]) => ({
      id,
      title,
      summary: sectionSummary(id, decodeView()),
      attention:
        id === 'target'
          ? c().needsInput[0]
          : id === 'folds' && !c().engineOff
            ? gapBlock('framework', shared().foldGapS, hasCapability) || undefined
            : undefined,
    }));

  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  return (
    <div class="cb-place cb-gs cb-dec-page" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>
            Decoding analysis
            <InfoTip label="About decoding">
              Predicts {isPosition() ? 'position' : 'behavior'} from the events of all cells
              together, on held-out blocks of time.
            </InfoTip>
            <HowItWorks title="How decoding works">
              <Method />
            </HowItWorks>
          </h2>
        </div>
        <div class="cb-controls">
          <Show when={!isStartingSettings()}>
            <button
              type="button"
              class="btn-secondary"
              onClick={resetStartingSettings}
              title="Reset the settings of this target to their starting values"
            >
              Starting settings
            </button>
          </Show>
          <Show when={last()}>
            <button type="button" class="btn-secondary" onClick={() => props.onResults()}>
              {last()!.outdated ? 'View previous results' : 'View results'}
            </button>
          </Show>
        </div>
      </div>

      <StageBar
        g={g}
        done={{
          configure: SECTIONS.every((id) => g.reviewed(id)),
          review: last()?.preliminary === true,
          run: last() !== undefined && !last()!.preliminary,
        }}
      />

      <Show when={g.stage() === 'configure'}>
        <SectionList g={g} label="Decoding settings" sections={sections()}>
          {(id) => (
            <>
              <Show when={id === 'target'}>
                <h3 class="cb-dg-h">What would you like to predict?</h3>
                <TargetCards />
                <InputLine />
                <FramesView />
              </Show>
              <Show when={id === 'decoder'}>
                <DecoderView />
              </Show>
              <Show when={id === 'folds'}>
                <FoldsView />
              </Show>
              <Show when={id === 'significance'}>
                <SignificanceView />
              </Show>
            </>
          )}
        </SectionList>
      </Show>

      <Show when={g.stage() === 'review'}>
        <div class="cb-gs-review">
          <SettingsSummary g={g} groups={summary()} />
          <EngineSection
            request={request()}
            frameworkRunning={frameworkRunning()}
            browserOffered={browserOffered()}
            browserBlock={browserBlock()}
            busy={!!run() || browserRunning()}
            onBrowserRun={startBrowser}
            runLabel={BROWSER_DECODING_RUN_LABEL}
          />
          <Show when={problems()}>
            <div class="cb-dg-checks">
              <ChecksView />
            </div>
          </Show>
          <RunChoice
            full={shared().shuffles}
            preview={previewCount()}
            previewBlocked={previewBlocked()}
            blocked={blocked()}
            onPreview={() => startFramework('preview')}
            onFull={() => startFramework('full')}
          />
          <ShuffleReach shuffles={shared().shuffles} alpha={shared().alpha} />
        </div>
      </Show>

      <Show when={g.stage() === 'run'}>
        <RunStage
          last={last()}
          preliminaryLabel={latest.decoding ? preliminaryText(latest.decoding) : 'Preliminary'}
          failure={failure()}
          onResults={props.onResults}
        />
      </Show>

      <StageFooter
        g={g}
        status={
          <span>
            <i classList={{ 'cb-dot--ok': !blocked() && !run() }} /> {status()}
            <Show when={problems() > 0 && g.stage() !== 'review'}>
              {' · '}
              <button type="button" class="cb-link" onClick={() => g.setStage('review')}>
                {problems()} to check in Review
              </button>
            </Show>
          </span>
        }
        actions={
          <Show when={run() || browserRunning()}>
            <button
              type="button"
              class="btn-secondary"
              onClick={() => (run() ? void cancelRun() : cancelBrowserDecoding())}
            >
              Cancel
            </button>
          </Show>
        }
      />
    </div>
  );
}
