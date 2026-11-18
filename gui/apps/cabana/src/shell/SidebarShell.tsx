import { createSignal, For, Show, type Component, type JSX } from 'solid-js';
import { DashboardShell } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { openItem } from '../components/Requirements.tsx';
import { ANALYSES, analysisId } from '../lib/analyses.ts';
import { analysisSummary } from '../lib/analysis-list.ts';
import { ITEM_LABEL, statusDetail, type ItemId } from '../lib/readiness.ts';
import { currentItem, nextFor, statusOfItem } from '../lib/readiness-snapshot.ts';
import { startResultIndex } from '../lib/result-index.ts';
import { nothingLoaded } from '../lib/data-setup-view.ts';
import { goToStep, isProjectPage, sessionName, stepId } from '../lib/store.ts';
import { AnalyzeOverview } from '../panels/AnalyzeOverview.tsx';
import { About } from '../panels/projects/About.tsx';
import { NewSession } from '../panels/projects/NewSession.tsx';
import { ProjectLibrary } from '../panels/projects/ProjectLibrary.tsx';
import { Welcome } from '../panels/projects/Welcome.tsx';
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

/** One sidebar row: the page name with its current status in words underneath. */
function SideItem(props: {
  label: string;
  item?: ItemId;
  /** Status words for a row that is not one item (the Analysis page). */
  statusText?: string;
  on: boolean;
  /** Greyed and not clickable, with the reason as its status line. */
  disabled?: string;
  onClick: () => void;
}): JSX.Element {
  const st = () =>
    props.disabled
      ? { text: props.disabled, detail: props.disabled }
      : props.item
        ? statusOfItem(props.item)
        : props.statusText
          ? { text: props.statusText, detail: props.statusText }
          : undefined;
  return (
    <div class="cb-side" classList={{ 'cb-side--on': props.on, 'cb-side--off': !!props.disabled }}>
      <button
        type="button"
        class="cb-side__go"
        aria-disabled={props.disabled ? 'true' : undefined}
        aria-label={st() ? `${props.label}: ${st()!.text}` : props.label}
        aria-current={props.on ? 'page' : undefined}
        title={
          folded() ? props.label : props.item ? statusDetail(statusOfItem(props.item)) : st()?.text
        }
        onClick={() => !props.disabled && props.onClick()}
      >
        <span class="cb-side__name">{short(props.label)}</span>
        <Show when={st() && !folded()}>
          <span class="cb-side__status">{st()!.text}</span>
        </Show>
      </button>
    </div>
  );
}

const PAGES = [
  { id: 'new', label: '+ New Project', short: '+' },
  { id: 'library', label: 'Project Library', short: 'L' },
];

/**
 * The first sidebar row. On a project page it is highlighted with its menu open; inside a session
 * it is collapsed and a click toggles the menu.
 */
function ProjectsRow(): JSX.Element {
  const [menu, setMenu] = createSignal(false);
  const onPage = () => isProjectPage(stepId());
  const shown = () => onPage() || menu();
  const status = () => (nothingLoaded() ? 'No project open' : sessionName() || 'Open session');
  return (
    <>
      <div class="cb-side cb-side--proj" classList={{ 'cb-side--on': onPage() }}>
        <button
          type="button"
          class="cb-side__go"
          aria-expanded={shown()}
          aria-label={`Projects: ${status()}`}
          title={folded() ? 'Projects' : undefined}
          onClick={() => !onPage() && setMenu(!menu())}
        >
          <span class="cb-side__name">
            {short('Projects')}
            <Show when={!folded()}>
              <span class="cb-side__caret" aria-hidden="true">
                {shown() ? '▾' : '▸'}
              </span>
            </Show>
          </span>
          <Show when={!folded()}>
            <span class="cb-side__status">{status()}</span>
          </Show>
        </button>
      </div>
      <Show when={shown()}>
        <div class="cb-side__menu" role="menu" aria-label="Projects">
          <For each={PAGES}>
            {(p) => (
              <button
                type="button"
                role="menuitem"
                classList={{ 'cb-side__menu--on': stepId() === p.id }}
                title={folded() ? p.label : undefined}
                onClick={() => {
                  setMenu(false);
                  goToStep(p.id);
                }}
              >
                {folded() ? p.short : p.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="cb-side__rule" />
    </>
  );
}

const PROJECT_PANELS: Record<string, Component> = {
  welcome: Welcome,
  new: NewSession,
  library: ProjectLibrary,
  about: About,
};

/** The Next button and the optional pages, in the bottom action area of every page but Results. */
function Footer(): JSX.Element {
  const here = () => currentItem(stepId(), analysisId());
  const next = () => nextFor(here());
  const stuck = () => next().item === here();
  const optionalHint = () =>
    stepId() === 'data' && next().item !== 'viz' && statusOfItem('viz').kind !== 'needs_input';
  return (
    <Show when={stepId() !== 'results' && !isProjectPage(stepId())}>
      <div class="cb-foot">
        <span class="cb-foot__hint cb-muted">
          <Show
            when={next().blocked}
            fallback={
              <Show when={optionalHint()}>
                Optional:{' '}
                <button type="button" class="cb-link" onClick={() => goToStep('viz')}>
                  Data visualization
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
          {stuck() ? 'Next' : `Next: ${ITEM_LABEL[next().item]}`}
        </button>
      </div>
    </Show>
  );
}

/** One sidebar with every page always reachable; each item shows its status in words. */
export function SidebarShell(props: { steps: Step[] }): JSX.Element {
  startResultIndex();
  const panel = (): Component | undefined =>
    PROJECT_PANELS[stepId()] ??
    (stepId() === 'analyze_overview'
      ? AnalyzeOverview
      : (props.steps.find((s) => s.id === stepId()) ?? props.steps[0]).panel);
  // Steps are greyed while a project page is open with nothing loaded; with a session open they
  // stay reachable, and so does the page the user is on if its files were all removed.
  const locked = () => nothingLoaded() && isProjectPage(stepId());
  return (
    <DashboardShell header={<Header />}>
      <div class="cb-app" classList={{ 'cb-app--folded': folded() }}>
        <nav class="cb-sidebar" aria-label="Steps">
          <div class="cb-side__top">
            <button
              type="button"
              class="cb-ib cb-side__fold"
              aria-label={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
              title={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
              aria-expanded={!folded()}
              onClick={toggleFold}
            >
              {folded() ? 'Expand' : 'Collapse'}
            </button>
          </div>
          <ProjectsRow />
          <For each={props.steps}>
            {(s) => (
              <SideItem
                label={s.label}
                item={s.id === 'analyze' ? undefined : (s.id as ItemId)}
                statusText={
                  s.id === 'analyze'
                    ? analysisSummary(ANALYSES.map((a) => statusOfItem(a.id)))
                    : undefined
                }
                disabled={locked() ? 'Open a project first' : undefined}
                on={s.id === stepId() || (s.id === 'analyze' && stepId() === 'analyze_overview')}
                onClick={() => goToStep(s.id)}
              />
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
