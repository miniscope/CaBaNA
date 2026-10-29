import { createSignal, For, Show, type Component, type JSX } from 'solid-js';
import { DashboardShell } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { StatusLegend, ToneIcon } from '../components/StatusBadge.tsx';
import { openItem } from '../components/Requirements.tsx';
import { ANALYSES, analysisId, setAnalysisId } from '../lib/analyses.ts';
import { ITEM_LABEL, statusDetail, TONE, type ItemId } from '../lib/readiness.ts';
import { currentItem, nextFor, statusOfItem, trackVisits } from '../lib/readiness-snapshot.ts';
import { goToStep, stepId } from '../lib/store.ts';
import { AnalyzeOverview } from '../panels/AnalyzeOverview.tsx';
import { InfoTip } from '../panels/InfoTip.tsx';
import type { Step } from './types.ts';

const FOLD_KEY = 'cabana-sidebar-folded';
const [folded, setFolded] = createSignal(
  (() => {
    try {
      return localStorage.getItem(FOLD_KEY) === '1';
    } catch {
      return false;
    }
  })(),
);
const toggleFold = () => {
  setFolded(!folded());
  try {
    localStorage.setItem(FOLD_KEY, folded() ? '1' : '0');
  } catch {
    // The choice just is not remembered.
  }
};
/** What a step button shows: its label, or its first letter when the sidebar is folded. */
const short = (label: string) => (folded() ? label.charAt(0) : label);

/** One sidebar row: the status icon (its own button, explaining the status) and the page button. */
function SideItem(props: {
  label: string;
  item?: ItemId;
  on: boolean;
  sub?: boolean;
  onClick: () => void;
}): JSX.Element {
  const st = () => (props.item ? statusOfItem(props.item) : undefined);
  return (
    <div class="cb-side" classList={{ 'cb-side--on': props.on, 'cb-side--sub': props.sub }}>
      <Show when={props.item} fallback={<span class="cb-side__mark" />}>
        <InfoTip
          class="cb-side__mark"
          label={`${props.label} status: ${st()!.text}`}
          icon={<ToneIcon tone={TONE[st()!.kind]} />}
        >
          <strong>{st()!.text}</strong>
          <div>{statusDetail(st()!)}</div>
        </InfoTip>
      </Show>
      <button
        type="button"
        class="cb-side__go"
        aria-label={st() ? `${props.label}: ${st()!.text}` : props.label}
        aria-current={props.on ? 'page' : undefined}
        title={folded() ? props.label : undefined}
        onClick={() => props.onClick()}
      >
        {short(props.label)}
      </button>
    </div>
  );
}

/** The Next button and the optional pages, in the bottom action area of every page but Results. */
function Footer(): JSX.Element {
  const here = () => currentItem(stepId(), analysisId());
  const next = () => nextFor(here());
  const stuck = () => next().item === here();
  const optionalHint = () =>
    ['load', 'setup'].includes(stepId()) && statusOfItem('viz').kind !== 'needs_input';
  return (
    <Show when={stepId() !== 'results'}>
      <div class="cb-foot">
        <span class="cb-foot__hint cb-muted">
          <Show
            when={next().blocked}
            fallback={
              <Show when={optionalHint()}>
                Optional:{' '}
                <button type="button" class="cb-link" onClick={() => goToStep('viz')}>
                  Data visualization
                </button>{' '}
                ·{' '}
                <button type="button" class="cb-link" onClick={() => goToStep('qc')}>
                  Data QC
                </button>
              </Show>
            }
          >
            {next().blocked}
          </Show>
        </span>
        <button
          type="button"
          class="btn-primary"
          disabled={stuck()}
          onClick={() => openItem(next().item)}
        >
          {stuck() ? 'Next' : `Next: ${ITEM_LABEL[next().item]}`} →
        </button>
      </div>
    </Show>
  );
}

/** One sidebar with every page always reachable; each item has a status icon on its left. */
export function SidebarShell(props: { steps: Step[] }): JSX.Element {
  trackVisits();
  const panel = (): Component | undefined =>
    stepId() === 'analyze_overview'
      ? AnalyzeOverview
      : (props.steps.find((s) => s.id === stepId()) ?? props.steps[0]).panel;
  return (
    <DashboardShell header={<Header />}>
      <div class="cb-app" classList={{ 'cb-app--folded': folded() }}>
        <nav class="cb-sidebar" aria-label="Steps">
          <div class="cb-side__top">
            <Show when={!folded()}>
              <span class="cb-side__title">Workflow</span>
              <StatusLegend />
            </Show>
            <button
              type="button"
              class="cb-ib cb-side__fold"
              aria-label={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
              title={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
              aria-expanded={!folded()}
              onClick={toggleFold}
            >
              {folded() ? '»' : '«'}
            </button>
          </div>
          <For each={props.steps}>
            {(s) => (
              <>
                <SideItem
                  label={s.label}
                  item={s.id === 'analyze' ? undefined : (s.id as ItemId)}
                  on={s.id === stepId() || (s.id === 'analyze' && stepId() === 'analyze_overview')}
                  onClick={() => goToStep(s.id === 'analyze' ? 'analyze_overview' : s.id)}
                />
                <Show when={s.id === 'analyze'}>
                  <For each={ANALYSES}>
                    {(a) => (
                      <SideItem
                        sub
                        label={a.label}
                        item={a.id}
                        on={stepId() === 'analyze' && analysisId() === a.id}
                        onClick={() => {
                          setAnalysisId(a.id);
                          goToStep('analyze');
                        }}
                      />
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
        </nav>
        <div class="cb-side-main">
          <div class="cb-body">{panel()?.({})}</div>
          <Footer />
        </div>
      </div>
    </DashboardShell>
  );
}
