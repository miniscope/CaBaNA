// The Decoding setup on the shared guided setup: Configure (target and data, decoder, train and
// test, significance), Review and preview (summary, engines, checks, Quick preview or full run) and
// Run. Same structure as Place cells.

import { Show, onCleanup, onMount, type JSX } from 'solid-js';
import { ConfigureBody, type ConfigureControl } from '../../components/ConfigureBody.tsx';
import { type GuidedSection } from '../../components/GuidedSetup.tsx';
import { RunChoice, SettingsSummary, type SummaryGroup } from '../../components/GuidedReview.tsx';
import { hasCapability } from '../../lib/bridge-status.ts';
import { decodeEvents } from '../../lib/decode-data.ts';
import {
  BROWSER_DECODING_RUN_LABEL,
  browserBlock,
  browserStatus,
  foldedTimes,
  runBrowserDecoding,
  setShownEngine,
} from '../../lib/decoding-browser.ts';
import { guided } from '../../lib/guided.ts';
import { prep } from '../../lib/preprocess.ts';
import { shufflesFor } from '../../lib/preview.ts';
import { active, runAnalysis } from '../../lib/runs.ts';
import { ShuffleReach } from '../parts.tsx';
import { fitToWindow } from '../QcPanel.tsx';
import { EngineSection } from './Engines.tsx';
import { gapBlock, type Request } from './engines.ts';
import { reviewGroups, sectionSummary } from './review.ts';
import {
  ChecksView,
  DecoderView,
  FoldsView,
  FramesView,
  InputLine,
  SignificanceView,
} from './Setup.tsx';
import { TargetCards } from './Target.tsx';
import { checks, decodeView, runBlock, shared } from './state.ts';

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
export function Method(): JSX.Element {
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

/** The Configure settings groups, or with `review` the Preview window's content. */
export function DecodingSetup(props: {
  configure?: ConfigureControl;
  /** The Preview window's content instead of the setting groups. */
  review?: boolean;
}): JSX.Element {
  const run = () => (active()?.id === 'decoding' ? active() : undefined);
  const c = () => checks();
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
    g.setStage('run'); // the Preview window closes when a run starts
    void runAnalysis('decoding', scope);
  };
  const startBrowser = () => {
    g.setStage('run');
    void runBrowserDecoding();
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
  onMount(() => root && onCleanup(fitToWindow(root)));

  const sectionBody = (id: string) => (
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
  );
  const configureView = (c: () => ConfigureControl) => (
    <div class="cb-dec-page">
      <ConfigureBody g={g} label="Decoding settings" sections={sections()} control={c()}>
        {sectionBody}
      </ConfigureBody>
    </div>
  );

  const reviewView = () => (
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
  );

  return (
    <Show
      when={props.review}
      fallback={<Show when={props.configure}>{(c) => configureView(c)}</Show>}
    >
      {reviewView()}
    </Show>
  );
}
