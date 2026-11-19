// What every analysis's Preview window shares: the shuffle field, Run preview, the result of the
// preview it started and its progress. The analysis supplies its settings, its limits and the
// text that explains how to read the preview.

import { createSignal, Show, type JSX } from 'solid-js';
import type { SummaryGroup } from '../components/GuidedReview.tsx';
import { NoPreview, PreviewLayout } from '../components/PreviewLayout.tsx';
import { rowStates } from '../lib/analyze-batch.ts';
import {
  askedShuffles,
  askShuffles,
  previewProblem,
  previewRecord,
  runPreview,
} from '../lib/preview-window.ts';
import { PREVIEW_SHUFFLES } from '../lib/preview.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { active } from '../lib/runs.ts';
import { PreviewResult } from './PreviewResult.tsx';

export const ENGINE_NEEDED = 'Previews with a chosen shuffle count need the Python engine.';

export function PreviewBody(props: {
  id: AnalysisItem;
  groups: SummaryGroup[];
  /** The full analysis's shuffle count; undefined for an analysis with no shuffle test. */
  full?: number;
  alpha?: number;
  /** Why a preview cannot run now. */
  blocked?: string;
  how: JSX.Element;
  empty?: JSX.Element;
  /** Under the result or empty state, on the left. */
  below?: JSX.Element;
}): JSX.Element {
  const [starting, setStarting] = createSignal(false);
  const running = () => starting() || rowStates()[props.id]?.kind === 'running';
  const progress = () => {
    const a = active();
    if (a?.id !== props.id) return undefined;
    return a.shuffles ? `${a.message} · ${a.shuffles[0]} of ${a.shuffles[1]} shuffles` : a.message;
  };
  const shuffles = () => Math.min(askedShuffles(props.id), props.full ?? PREVIEW_SHUFFLES);
  const run = async () => {
    setStarting(true);
    try {
      await runPreview(props.id, shuffles());
    } finally {
      setStarting(false);
    }
  };
  return (
    <PreviewLayout
      id={props.id}
      groups={props.groups}
      full={props.full}
      alpha={props.alpha}
      shuffles={shuffles()}
      onShuffles={(n) => askShuffles(props.id, n)}
      blocked={props.blocked}
      running={running()}
      ran={!!previewRecord(props.id)}
      onRun={() => void run()}
      how={props.how}
      status={
        <>
          <Show when={running() && progress()}>
            <p class="cb-pv-hint" role="status">
              {progress()}
            </p>
          </Show>
          <Show when={!running() && previewProblem(props.id)}>
            <p class="cb-pv-hint cb-warn" role="alert">
              {previewProblem(props.id)}
            </p>
          </Show>
        </>
      }
    >
      <Show when={previewRecord(props.id)} fallback={<NoPreview>{props.empty}</NoPreview>}>
        {(rec) => <PreviewResult record={rec()} />}
      </Show>
      {props.below}
    </PreviewLayout>
  );
}
