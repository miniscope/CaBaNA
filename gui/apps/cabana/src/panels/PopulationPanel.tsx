import {
  createEffect,
  createMemo,
  createResource,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { SectionList, StageBar, StageFooter } from '../components/GuidedSetup.tsx';
import { HowItWorks } from '../components/GuidedReview.tsx';
import { Requirements } from '../components/Requirements.tsx';
import { bridgeState } from '../lib/bridge-status.ts';
import { guided } from '../lib/guided.ts';
import {
  POPULATION_METHODS,
  populationSettingIssues,
  populationSettings as s,
} from '../lib/population-settings.ts';
import { prep } from '../lib/preprocess.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import {
  active,
  blockers,
  cancelRun,
  compareToLatest,
  history,
  latest,
  refreshHistory,
  runAnalysis,
} from '../lib/runs.ts';
import { rejected } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { PopulationResults } from './PopulationResults.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { neuralSummary, readiness, syncLabels } from './population/data.ts';
import { METHOD_NAME, MethodsSection } from './population/MethodsSection.tsx';
import { ReviewStage } from './population/ReviewStage.tsx';
import { RunStage } from './population/RunStage.tsx';
import { HowPopulationWorks, populationSections } from './population/SetupSummary.tsx';
import { StatsSection } from './population/StatsSection.tsx';
import { TargetSection } from './population/TargetSection.tsx';
import { setShowResults, showResults } from './population/view-store.ts';

const g = guided('population', 'target');
const SECTIONS = ['target', 'methods', 'stats'];

function PopulationSetup(): JSX.Element {
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const n = neuralSummary;
  const engineOff = () => bridgeState().kind !== 'ready';
  const running = () => (active()?.id === 'population' ? active() : undefined);
  const failed = () => (latest.population?.status === 'failed' ? latest.population : undefined);
  const issues = createMemo(() => {
    const own = blockers('population').filter((b) => b !== 'Python engine not running.');
    const notReady = POPULATION_METHODS.filter(
      (m) => s.methods[m.id] && !readiness()[m.id].ready,
    ).map((m) => `${METHOD_NAME[m.id]}: ${readiness()[m.id].reason}`);
    const engine = engineOff() ? ['Python engine not running.'] : [];
    return [...own, ...populationSettingIssues(s), ...notReady, ...engine];
  });
  const blockedText = () =>
    running()
      ? 'A run is in progress.'
      : issues().length
        ? `${issues()[0]}${issues().length > 1 ? ` (${issues().length - 1} more)` : ''}`
        : undefined;
  const start = async (scope: 'full' | 'preview') => {
    g.setStage('run');
    const rec = await runAnalysis('population', scope);
    if (rec && rec.status !== 'failed') {
      openRunOf('population', undefined);
      setShowResults(true);
    }
  };

  // Whether the latest run still matches the settings (re-checked when they change).
  const [match] = createResource(
    () => (latest.population ? JSON.stringify([s, prep, [...rejected()]]) : undefined),
    async () => compareToLatest('population'),
  );

  const status = () => {
    const r = running();
    if (r)
      return r.shuffles ? `Shuffles ${r.shuffles[0]} of ${r.shuffles[1]}` : r.message || 'Running…';
    if (!n()) return 'Load deconvolved events';
    if (issues().length) return 'Needs attention';
    return 'Ready to run';
  };
  const last = () => latest.population;
  return (
    <div class="cb-place cb-gs cb-pn" ref={root}>
      <div class="cb-place-head">
        <div>
          <h2>
            Population activity
            <InfoTip label="About the population analyses">
              How neural values across all cells differ between states, and how stable and
              high-dimensional the population pattern is.
            </InfoTip>
            <HowItWorks title="How the population analyses work">
              <div class="cb-muted">
                <HowPopulationWorks />
              </div>
            </HowItWorks>
          </h2>
        </div>
        <div class="cb-place-head__side">
          <span class="cb-place-method__status">
            <i classList={{ 'cb-dot--ok': !!n() && !issues().length && !running() }} /> {status()}
          </span>
          <Show when={n()}>
            <span class="cb-muted">{n()!.kept} cells included</span>
          </Show>
        </div>
        <div class="cb-controls">
          <Show when={last()}>
            <button class="btn-secondary" onClick={() => setShowResults(true)}>
              {match() && !match()!.matches ? 'View results (earlier settings)' : 'View results'}
            </button>
          </Show>
        </div>
      </div>

      <StageBar
        g={g}
        done={{
          configure: SECTIONS.every((id) => g.reviewed(id)),
          review: last()?.scope === 'preview' && last()?.status !== 'failed',
          run: last()?.scope === 'full' && last()?.status !== 'failed',
        }}
      />
      <Show when={!n()}>
        <div class="cb-empty">Load deconvolved events to run this analysis.</div>
      </Show>

      <Show when={g.stage() === 'configure'}>
        <SectionList g={g} label="Population settings" sections={populationSections()}>
          {(id) => (
            <>
              <Show when={id === 'target'}>
                <TargetSection />
              </Show>
              <Show when={id === 'methods'}>
                <MethodsSection />
              </Show>
              <Show when={id === 'stats'}>
                <StatsSection />
              </Show>
            </>
          )}
        </SectionList>
      </Show>

      <Show when={g.stage() === 'review'}>
        <ReviewStage
          g={g}
          engineOff={engineOff()}
          issues={issues()}
          blockedText={blockedText()}
          onStart={(scope) => void start(scope)}
        />
      </Show>

      <Show when={g.stage() === 'run'}>
        <RunStage running={running()} failed={failed()} last={last()} match={match()} />
      </Show>

      <StageFooter
        g={g}
        status={
          <span>
            <i classList={{ 'cb-dot--ok': !!n() && !issues().length && !running() }} /> {status()}
          </span>
        }
        actions={
          <Show when={running()}>
            <button
              class="btn-secondary"
              disabled={!running()!.runId || running()!.phase === 'cancelling'}
              onClick={() => void cancelRun()}
            >
              Cancel
            </button>
          </Show>
        }
      />
    </div>
  );
}

/** The Population page: its guided setup, or after a run its results. The results stay while the settings are edited. */
export function PopulationPanel(): JSX.Element {
  // Saved runs of the project, once the engine is reachable.
  createEffect(() => {
    if (bridgeState().kind === 'ready' && !history().length)
      void refreshHistory().catch(() => undefined);
  });
  // Opening a saved run from the Results page shows its results.
  createEffect(
    on(
      () => openedRun('population'),
      (id) => id && setShowResults(true),
      { defer: true },
    ),
  );
  syncLabels();
  return (
    <>
      <Requirements analysis="population" />
      <Show when={showResults()} fallback={<PopulationSetup />}>
        <PopulationResults
          onSetup={() => {
            setShowResults(false);
            g.setStage('configure');
          }}
        />
      </Show>
    </>
  );
}
