import { createEffect, createMemo, on, Show, type JSX } from 'solid-js';
import { BackToCards } from './AnalysisBack.tsx';
import { ConfigureBody, type ConfigureControl } from '../components/ConfigureBody.tsx';
import { bridgeState } from '../lib/bridge-status.ts';
import { guided } from '../lib/guided.ts';
import {
  POPULATION_METHODS,
  populationSettingIssues,
  populationSettings as s,
} from '../lib/population-settings.ts';
import { openedRun, openRunOf } from '../lib/results-nav.ts';
import { active, blockers, runAnalysis } from '../lib/runs.ts';
import { PopulationResults } from './PopulationResults.tsx';
import { neuralSummary, readiness, syncLabels } from './population/data.ts';
import { METHOD_NAME, MethodsSection } from './population/MethodsSection.tsx';
import { ReviewStage } from './population/ReviewStage.tsx';
import { populationSections } from './population/SetupSummary.tsx';
import { StatsSection } from './population/StatsSection.tsx';
import { TargetSection } from './population/TargetSection.tsx';
import { setShowResults, showResults } from './population/view-store.ts';

const g = guided('population', 'target');

/** The Configure settings groups, or with `review` the Preview window's content. */
export function PopulationSetup(props: {
  configure?: ConfigureControl;
  /** The Preview window's content instead of the setting groups. */
  review?: boolean;
}): JSX.Element {
  syncLabels();
  const n = neuralSummary;
  const engineOff = () => bridgeState().kind !== 'ready';
  const running = () => (active()?.id === 'population' ? active() : undefined);
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
    g.setStage('run'); // the Preview window closes when a run starts
    const rec = await runAnalysis('population', scope);
    if (rec && rec.status !== 'failed') {
      openRunOf('population', undefined);
      setShowResults(true);
    }
  };

  const sectionBody = (id: string) => (
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
  );
  const configureView = (c: () => ConfigureControl) => (
    <Show
      when={n()}
      fallback={<div class="cb-empty">Load deconvolved events to run this analysis.</div>}
    >
      <ConfigureBody
        g={g}
        label="Population settings"
        sections={populationSections()}
        control={c()}
      >
        {sectionBody}
      </ConfigureBody>
    </Show>
  );

  const reviewView = () => (
    <Show
      when={n()}
      fallback={<div class="cb-empty">Load deconvolved events to run this analysis.</div>}
    >
      <ReviewStage
        g={g}
        engineOff={engineOff()}
        issues={issues()}
        blockedText={blockedText()}
        onStart={(scope) => void start(scope)}
      />
    </Show>
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

/** The Population results page. Without a result, setup is in the card's Actions. */
export function PopulationPanel(): JSX.Element {
  // Opening a saved run from the Results page shows its results.
  createEffect(
    on(
      () => openedRun('population'),
      (id) => id && setShowResults(true),
      { defer: true },
    ),
  );
  return (
    <Show when={showResults()} fallback={<BackToCards id="population" />}>
      <PopulationResults onSetup={() => setShowResults(false)} />
    </Show>
  );
}
