import { createSignal, For, onCleanup, Show, type Component, type JSX } from 'solid-js';
import { DashboardShell } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { openItem } from '../components/Requirements.tsx';
import { ANALYSES, analysisId, analysisPageOpen } from '../lib/analyses.ts';
import { analysisSummary } from '../lib/analysis-list.ts';
import { ITEM_LABEL, statusDetail, type ItemId, type NextStep } from '../lib/readiness.ts';
import { currentItem, nextFor, statusOfItem } from '../lib/readiness-snapshot.ts';
import { startResultIndex } from '../lib/result-index.ts';
import { nothingLoaded } from '../lib/data-setup-view.ts';
import { READOUT_HINT, readout } from '../lib/viz-tracks.ts';
import { guardExample, isExample } from '../lib/example-session.ts';
import { goToStep, isProjectPage, sessionName, stepId } from '../lib/store.ts';
import { About } from '../panels/projects/About.tsx';
import { NewSession } from '../panels/projects/NewSession.tsx';
import { ProjectLibrary } from '../panels/projects/ProjectLibrary.tsx';
import { Welcome } from '../panels/projects/Welcome.tsx';
import type { Step } from './types.ts';

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
        title={props.item ? statusDetail(statusOfItem(props.item)) : st()?.text}
        onClick={() => !props.disabled && props.onClick()}
      >
        <span class="cb-side__name">{props.label}</span>
        <Show when={st()}>
          <span class="cb-side__status">{st()!.text}</span>
        </Show>
      </button>
    </div>
  );
}

const PAGES = [
  { id: 'new', label: '+ New Project' },
  { id: 'library', label: 'Project Library' },
];
/** How long the Projects menu stays after the pointer leaves it, so a slight overshoot is forgiven. */
const MENU_CLOSE_MS = 300;

/**
 * The first sidebar row. Its menu opens on hover (or a click, for touch and keyboard) and floats
 * over the rows below; it closes shortly after the pointer leaves, on Escape, or when focus moves
 * away. The line under the row says what is open.
 */
function ProjectsRow(): JSX.Element {
  const [menu, setMenu] = createSignal(false);
  let timer: number | undefined;
  let wrap!: HTMLDivElement;
  const show = () => {
    clearTimeout(timer);
    setMenu(true);
  };
  const hide = () => {
    clearTimeout(timer);
    setMenu(false);
  };
  onCleanup(() => clearTimeout(timer));
  const onPage = () => isProjectPage(stepId());
  const status = () =>
    nothingLoaded()
      ? 'No project open'
      : isExample()
        ? 'Example data · Unsaved'
        : sessionName() || 'Untitled project';
  return (
    <>
      <div
        ref={wrap}
        class="cb-side__projwrap"
        onPointerEnter={show}
        onPointerLeave={() => {
          clearTimeout(timer);
          timer = window.setTimeout(() => setMenu(false), MENU_CLOSE_MS);
        }}
        onFocusOut={(e) => !wrap.contains(e.relatedTarget as Node | null) && hide()}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
      >
        <div class="cb-side cb-side--proj" classList={{ 'cb-side--on': onPage() }}>
          <button
            type="button"
            class="cb-side__go"
            aria-haspopup="menu"
            aria-expanded={menu()}
            aria-label={`Projects: ${status()}`}
            onClick={() => (menu() ? hide() : show())}
          >
            <span class="cb-side__name">
              Projects
              <span class="cb-side__caret" aria-hidden="true">
                {menu() ? '▾' : '▸'}
              </span>
            </span>
            <span class="cb-side__status">{status()}</span>
          </button>
        </div>
        <Show when={menu()}>
          <div class="cb-side__menu" role="menu" aria-label="Projects">
            <For each={PAGES}>
              {(p) => (
                <button
                  type="button"
                  role="menuitem"
                  classList={{ 'cb-side__menu--on': stepId() === p.id }}
                  onClick={() => {
                    hide();
                    guardExample(() => goToStep(p.id));
                  }}
                >
                  {p.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
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
  // The Analysis cards page leads to Results; an analysis's own results page keeps its usual next.
  const onCards = () => stepId() === 'analyze' && !analysisPageOpen();
  const next = (): NextStep => (onCards() ? { item: 'results' } : nextFor(here()));
  const stuck = () => !onCards() && next().item === here();
  const optionalHint = () =>
    stepId() === 'data' && next().item !== 'viz' && statusOfItem('viz').kind !== 'needs_input';
  return (
    <Show when={stepId() !== 'results' && !isProjectPage(stepId())}>
      <div class="cb-foot">
        <span class="cb-foot__hint cb-muted">
          <Show when={stepId() !== 'viz'} fallback={readout() ?? READOUT_HINT}>
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
    (props.steps.find((s) => s.id === stepId()) ?? props.steps[0]).panel;
  // Steps are greyed while a project page is open with nothing loaded; with a session open they
  // stay reachable, and so does the page the user is on if its files were all removed.
  const locked = () => nothingLoaded() && isProjectPage(stepId());
  return (
    <DashboardShell header={<Header />}>
      <div class="cb-app">
        <nav class="cb-sidebar" aria-label="Steps">
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
                on={s.id === stepId()}
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
