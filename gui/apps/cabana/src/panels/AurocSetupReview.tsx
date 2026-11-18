// auROC setup: the stage list and review summary, the review stage, and the run stage.
import { type JSX } from 'solid-js';
import type { GuidedSection } from '../components/GuidedSetup.tsx';
import { RunChoice, SettingsSummary, type SummaryGroup } from '../components/GuidedReview.tsx';
import type { Guided } from '../lib/guided.ts';
import { aurocPlan, aurocSettings, type AurocData } from '../lib/auroc-run.ts';
import { frameSelection, percentOf } from '../lib/auroc-setup.ts';
import { shufflesFor } from '../lib/preview.ts';
import { prep } from '../lib/preprocess.ts';
import { ShuffleReach } from './parts.tsx';
import { ComparisonTimeline } from './AurocComparisonTimeline.tsx';
import { EngineNotice } from './results/EngineNotice.tsx';

/** What the stage list and the review summary read from the setup page. */
export interface AurocSetupView {
  ok: () => AurocData;
  pairMode: () => boolean;
  pair: () => number[];
  selected: () => string[];
  frames: () => NonNullable<ReturnType<typeof frameSelection>>;
  settingIssues: () => string[];
  framework: () => boolean;
  behaviorNames: () => string;
  smoothing: () => string;
  shiftText: () => string;
  methodText: () => string;
  correctionText: () => string;
}

export function aurocSections(v: AurocSetupView): GuidedSection[] {
  const { ok, pairMode, pair, selected, frames, settingIssues, methodText } = v;
  return [
    { id: 'type', title: 'Comparison type', summary: 'Labeled conditions' },
    {
      id: 'conditions',
      title: 'Conditions',
      summary: pairMode()
        ? `${ok()!.labels[pair()[0]]} against ${ok()!.labels[pair()[1]]}`
        : `${selected().length} of ${ok()!.labels.length} behaviors · all other eligible frames`,
      attention: selected().length ? undefined : 'select at least one behavior',
    },
    {
      id: 'frames',
      title: 'Frame selection',
      optional: true,
      summary: aurocSettings.speedFilter
        ? `Speed ≥ ${aurocSettings.minSpeed} cm/s · ${frames()!.kept.toLocaleString()} of ${frames()!.total.toLocaleString()} kept`
        : `Off · all ${frames()!.total.toLocaleString()} frames kept`,
      attention: aurocSettings.speedFilter && !frames()!.kept ? 'no frame is kept' : undefined,
    },
    {
      id: 'testing',
      title: 'Significance testing',
      summary: `${methodText()} · ${aurocSettings.nShuffles} shuffles · α ${aurocSettings.alpha}`,
      attention: settingIssues()[0],
    },
  ];
}

export function aurocSummary(v: AurocSetupView): SummaryGroup[] {
  const { ok, pairMode, pair, frames, framework, behaviorNames, smoothing } = v;
  const { shiftText, methodText, correctionText } = v;
  return [
    {
      title: 'Comparison',
      section: 'type',
      items: [
        { label: 'Type', value: 'Labeled conditions' },
        {
          label: 'Condition A',
          value: pairMode() ? ok()!.labels[pair()[0]] : behaviorNames(),
        },
        {
          label: 'Reference group',
          value: pairMode()
            ? `Another behavior: ${ok()!.labels[pair()[1]]}`
            : 'All other eligible frames',
        },
      ],
    },
    {
      title: 'Frame selection',
      section: 'frames',
      items: [
        {
          label: 'Speed filter',
          value: aurocSettings.speedFilter
            ? `Below ${aurocSettings.minSpeed} cm/s excluded`
            : 'Off',
        },
        {
          label: 'Frames kept',
          value: `${frames()!.kept.toLocaleString()} of ${frames()!.total.toLocaleString()} (${percentOf(frames()!.kept, frames()!.total)})`,
        },
      ],
    },
    {
      title: 'Significance testing',
      section: 'testing',
      items: [
        { label: 'Null method', value: methodText() },
        { label: 'Minimum shift', value: shiftText() },
        { label: 'Shuffles', value: aurocSettings.nShuffles.toLocaleString() },
        { label: 'Significance', value: `α ${aurocSettings.alpha}, two-sided` },
        { label: 'Correction', value: correctionText() },
        { label: 'Seed', value: String(aurocSettings.seed) },
      ],
    },
    {
      title: 'Data',
      items: [
        { label: 'Cells', value: `${ok()!.cells}` },
        { label: 'Neural input', value: `deconvolved events · ${Number(ok()!.fs.toFixed(2))} Hz` },
        { label: 'Smoothing', value: smoothing(), note: 'Preprocess' },
        { label: 'Label padding', value: `${prep.labelPadS} s`, note: 'Preprocess' },
        { label: 'Engine', value: framework() ? 'Framework' : 'Browser' },
      ],
    },
  ];
}

/** The review stage: the settings summary beside the comparison timeline and the run buttons. */
export function AurocReviewStage(props: {
  g: Guided;
  summary: () => SummaryGroup[];
  ok: () => AurocData;
  plan: () => NonNullable<ReturnType<typeof aurocPlan>>;
  pairMode: () => boolean;
  running: () => unknown;
  previewBlocked: () => string | undefined;
  blocked: () => string | undefined;
  start: (preview: boolean, engine?: 'browser') => void;
}): JSX.Element {
  const { g, summary, ok, plan, pairMode, running, previewBlocked, blocked, start } = props;
  return (
    <>
      <div class="cb-gs-review cb-au-review">
        <div class="cb-au-review__left">
          <SettingsSummary g={g} groups={summary()} />
        </div>
        <div class="cb-au-review__right">
          <ComparisonTimeline data={ok()!} plan={plan()!} pair={pairMode()} />
          <EngineNotice
            mode="auroc"
            busy={!!running()}
            onBrowserRun={() => start(false, 'browser')}
          />
          <RunChoice
            full={aurocSettings.nShuffles}
            preview={shufflesFor('preview', aurocSettings.nShuffles)}
            previewBlocked={previewBlocked()}
            blocked={blocked()}
            onPreview={() => start(true)}
            onFull={() => start(false)}
          />
          <ShuffleReach
            shuffles={aurocSettings.nShuffles}
            alpha={aurocSettings.alpha}
            preview={!previewBlocked()}
          />
        </div>
      </div>
    </>
  );
}
